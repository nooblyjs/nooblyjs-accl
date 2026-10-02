'use strict';

/**
 * Mounts customer + marketing with the dispatcher and scheduler stopped
 * (`drain()` / `tick()` drive them) and the console adapter for every channel.
 */

const { mountCustomer } = require('./customer');

const SECRET = 'test-signing-secret-0123456789';
const BASE_URL = 'https://shop.example.com';

async function mountMarketing(marketing = {}, extra = {}, servicesOpts = {}) {
  const env = await mountCustomer({
    modules: ['customer', 'marketing'],
    customer: { defaultCountry: 'ZA' },
    marketing: { autoStart: false, tracking: { baseUrl: BASE_URL, signingSecret: SECRET }, ...marketing },
    ...extra
  }, servicesOpts);
  const mk = env.cx.marketing;
  const m = mk.services;
  const request = require('supertest');
  const asM = (role) => {
    const call = (method) => (p) => request(env.app)[method](`/applications/marketing/api/v1${p}`).set('x-role', role);
    return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
  };
  /** Path of a tracking URL relative to the app. */
  const local = (url) => url.replace(BASE_URL, '');

  /** Creates and approves an email template. */
  async function template(fields = {}) {
    const t = await m.templates.create({
      key: `t-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Newsletter',
      channel: 'email',
      locales: [{ locale: 'en', subject: 'Hi {{customer.givenName}}', bodyHtml: '<p>Hello {{customer.givenName}} <a href="https://example.com/sale">Sale</a> <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>', bodyText: 'Hello https://example.com/sale' }],
      ...fields
    }, env.sys);
    return m.templates.approve(t.id, env.sys);
  }

  /** A customer with an email, optionally opted in to marketing email. */
  async function customer({ optIn = true, email, given, ...rest } = {}) {
    const c = await env.cx.customer.create({
      name: { given: given || 'Ada', family: 'Lovelace' },
      email: email || `c${Math.random().toString(36).slice(2, 10)}@example.com`,
      consents: optIn === null ? [] : [{ purpose: 'marketing', channel: 'email', status: optIn ? 'opt_in' : 'opt_out', capturedAt: new Date(Date.now() - 86400000).toISOString() }],
      ...rest
    });
    return env.cx.customer.get(c.id, { expand: ['emails'] });
  }

  async function message(fields = {}) {
    const tpl = fields.templateId ? null : await template();
    const campaign = fields.campaignId ? null : await m.campaigns.create({ name: 'Campaign' }, env.sys);
    return m.messages.create({
      campaignId: campaign && campaign.id,
      templateId: tpl && tpl.id,
      name: 'Message',
      channel: 'email',
      audience: { rule: { filters: [{ field: 'status', op: 'eq', value: 'active' }] } },
      ...fields
    }, env.sys);
  }

  return { ...env, mk, m, asM, local, template, customer, message, outbox: () => mk.channels.email.outbox, SECRET, BASE_URL };
}

module.exports = { mountMarketing, SECRET, BASE_URL };
