/**
 * @fileoverview Marketing demo data: topics, approved templates (newsletter
 * email, SMS offer, order confirmation) and a draft campaign with a message
 * targeting opted-in South African customers. Nothing is sent.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { systemContext } = require('../shared/context');

const NEWSLETTER_HTML = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#241C1A">
<h1>Hello {{customer.preferredName}},</h1>
<p>Here is what is new this month at Acme.</p>
<p><a href="https://example.com/new-arrivals">See the new arrivals</a></p>
{{#unsubscribeUrl}}<p style="font-size:12px;color:#6B605A">Don't want these emails? <a href="{{unsubscribeUrl}}">Unsubscribe</a>.</p>{{/unsubscribeUrl}}
</body></html>`;

const ORDER_HTML = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#241C1A">
<h1>Thanks for your order, {{customer.preferredName}}</h1>
<p>Order <strong>{{order.number}}</strong> totalling {{order.total}} is confirmed.</p>
<ul>{{#order.items}}<li>{{quantity}} × {{name}}</li>{{/order.items}}</ul>
<p><a href="https://example.com/orders/{{order.number}}">Track your order</a></p>
</body></html>`;

/**
 * Seeds marketing demo content into an empty template store.
 *
 * @param {Object} services - Marketing services
 * @param {Object} [opts] - `{ ctx, force }`
 * @return {Promise<{skipped: boolean, templates: number}>} Result
 */
async function seedMarketing(services, { ctx = systemContext('seed'), force = false } = {}) {
  if (!force && (await services.repos.template.count(ctx)) > 0) return { skipped: true, templates: 0 };
  await services.repos.topic.create({ key: 'newsletter', name: 'Monthly newsletter', channel: 'email', description: 'News and new arrivals, once a month' }, ctx);
  await services.repos.topic.create({ key: 'offers', name: 'Offers and promotions', description: 'Sales and discount codes' }, ctx);

  const newsletter = await services.templates.create({
    key: 'monthly-newsletter',
    name: 'Monthly newsletter',
    channel: 'email',
    category: 'marketing',
    locales: [{ locale: 'en', subject: '{{customer.preferredName}}, this month at Acme', preheader: 'New arrivals inside', bodyHtml: NEWSLETTER_HTML, bodyText: 'Hello {{customer.preferredName}}, see the new arrivals: https://example.com/new-arrivals\n\nUnsubscribe: {{unsubscribeUrl}}' }]
  }, ctx);
  await services.templates.approve(newsletter.id, ctx);

  const sms = await services.templates.create({
    key: 'weekend-offer-sms',
    name: 'Weekend offer (SMS)',
    channel: 'sms',
    category: 'marketing',
    locales: [{ locale: 'en', smsText: 'Hi {{customer.givenName}}, 20% off this weekend with code WKND20: https://example.com/offers Reply STOP to opt out' }]
  }, ctx);
  await services.templates.approve(sms.id, ctx);

  const order = await services.templates.create({
    key: 'order-confirmation',
    name: 'Order confirmation',
    channel: 'email',
    category: 'transactional',
    variables: [
      { name: 'order.number', type: 'string', required: true, sample: 'ORD-1001' },
      { name: 'order.total', type: 'string', required: true, sample: 'R 1 299.00' },
      { name: 'order.items', type: 'json', sample: [{ name: 'Canvas sneakers', quantity: 1 }, { name: 'Socks', quantity: 2 }] }
    ],
    locales: [{ locale: 'en', subject: 'Order {{order.number}} confirmed', bodyHtml: ORDER_HTML, bodyText: 'Order {{order.number}} ({{order.total}}) is confirmed.' }]
  }, ctx);
  await services.templates.approve(order.id, ctx);

  const campaign = await services.campaigns.create({
    name: 'Spring newsletter', objective: 'retention', topicId: 'newsletter',
    utm: { source: 'newsletter', medium: 'email', campaign: 'spring' }
  }, ctx);
  await services.messages.create({
    campaignId: campaign.id,
    name: 'Spring newsletter: South Africa',
    channel: 'email',
    templateId: newsletter.id,
    audience: { rule: { filters: [{ field: 'status', op: 'eq', value: 'active' }, { field: 'countryCode', op: 'eq', value: 'ZA' }] } },
    schedule: { type: 'immediate' },
    throttle: { perMinute: 600 }
  }, ctx);
  return { skipped: false, templates: 3 };
}

module.exports = { seedMarketing };
