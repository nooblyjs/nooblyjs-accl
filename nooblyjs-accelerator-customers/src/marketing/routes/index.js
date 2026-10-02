/**
 * @fileoverview Marketing module REST API (`{basePath}/marketing/api/v1`).
 *
 * Permissions: `marketing:read` for reads, `marketing:write` for content and
 * configuration, `marketing:send` for scheduling, test and transactional
 * sends, `marketing:admin` to remove suppressions.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { asyncHandler, parseListQuery, sendDoc, expectedVersion } = require('../../shared/http');
const { badRequest } = require('../../shared/errors');
const { sampleData } = require('../templating/renderer');
const schemas = require('../schemas');

/** Matches `/{collection}/{id}:{action}`. */
const action = (collection, actions) => new RegExp(`^/${collection}/([^/:]+):(${actions.join('|')})$`);

/**
 * @param {Object} params
 * @param {Object} params.router - Module API router
 * @param {Object} params.rbac - RBAC helpers
 * @param {Object} params.services - Marketing services
 * @param {Object} params.customer - Customer module services
 * @param {Object<string, Object>} params.channels - Adapter per channel
 * @param {Object} params.openapi - OpenApiBuilder
 * @return {void}
 */
function registerRoutes({ router, rbac, services, customer, channels, openapi }) {
  const can = rbac.requirePermission;
  const read = can('marketing:read');
  const write = can('marketing:write');
  const send = can('marketing:send');
  const list = (req) => parseListQuery(req.query);
  const { templates, campaigns, messages, communications, suppressions, topics, repos } = services;

  // ---- templates ----------------------------------------------------------
  router.get('/templates', read, asyncHandler(async (req, res) => {
    const q = list(req);
    if (q.q) q.filters.push({ field: 'id', op: 'in', value: (await repos.template.searchText(q.q, req.cx, { limit: 100 })).map((t) => t.id).concat('-') });
    res.json(await repos.template.list(q, req.cx));
  }));
  router.post('/templates', write, asyncHandler(async (req, res) => sendDoc(res, await templates.create(req.body, req.cx), 201)));
  router.get('/templates/:id', read, asyncHandler(async (req, res) => sendDoc(res, await repos.template.get(req.params.id, req.cx))));
  router.patch('/templates/:id', write, asyncHandler(async (req, res) => {
    sendDoc(res, await templates.update(req.params.id, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
  }));
  router.post(action('templates', ['approve', 'retire', 'preview']), asyncHandler(async (req, res, next) => {
    const [id, verb] = [req.params[0], req.params[1]];
    const perm = verb === 'preview' ? 'marketing:read' : 'marketing:write';
    return can(perm)(req, res, async (err) => {
      if (err) return next(err);
      try {
        if (verb === 'approve') return sendDoc(res, await templates.approve(id, req.cx));
        if (verb === 'retire') return sendDoc(res, await templates.retire(id, req.cx));
        const template = await repos.template.get(id, req.cx);
        const body = req.body || {};
        const c = body.customerId ? await customer.customers.get(body.customerId, req.cx) : null;
        const context = {
          ...sampleData(template.variables),
          ...(body.data && typeof body.data === 'object' ? body.data : {}),
          customer: c ? { givenName: c.name && c.name.given, familyName: c.name && c.name.family, fullName: c.name && c.name.full, preferredName: c.name && (c.name.preferred || c.name.given), number: c.number }
            : { givenName: 'Ada', familyName: 'Lovelace', fullName: 'Ada Lovelace', preferredName: 'Ada', number: 'CUS-000000' },
          campaign: { name: 'Preview campaign' },
          message: { name: 'Preview message' },
          unsubscribeUrl: '#unsubscribe',
          now: new Date().toISOString()
        };
        return res.json(templates.renderParts(template, context, body.locale));
      } catch (e) {
        return next(e);
      }
    });
  }));

  // ---- campaigns ----------------------------------------------------------
  router.get('/campaigns', read, asyncHandler(async (req, res) => {
    const q = list(req);
    if (q.q) q.filters.push({ field: 'id', op: 'in', value: (await repos.campaign.searchText(q.q, req.cx, { limit: 100 })).map((t) => t.id).concat('-') });
    res.json(await repos.campaign.list(q, req.cx));
  }));
  router.post('/campaigns', write, asyncHandler(async (req, res) => sendDoc(res, await campaigns.create(req.body, req.cx), 201)));
  router.get('/campaigns/:id', read, asyncHandler(async (req, res) => {
    const campaign = await repos.campaign.get(req.params.id, req.cx);
    const expand = parseListQuery({ expand: req.query.expand }).expand;
    if (expand.includes('messages')) campaign.messages = await repos.message.findByIndex('campaign', campaign.id, req.cx);
    sendDoc(res, campaign);
  }));
  router.patch('/campaigns/:id', write, asyncHandler(async (req, res) => {
    sendDoc(res, await campaigns.update(req.params.id, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
  }));
  router.post(action('campaigns', ['status']), write, asyncHandler(async (req, res) => {
    if (!req.body || typeof req.body.status !== 'string') throw badRequest('status is required');
    sendDoc(res, await campaigns.setStatus(req.params[0], req.body.status, req.cx));
  }));

  // ---- messages -----------------------------------------------------------
  router.get('/messages', read, asyncHandler(async (req, res) => res.json(await repos.message.list(list(req), req.cx))));
  router.post('/messages', write, asyncHandler(async (req, res) => sendDoc(res, await messages.create(req.body, req.cx), 201)));
  router.post(/^\/messages:preview-audience$/, read, asyncHandler(async (req, res) => {
    res.json(await messages.previewAudience((req.body && req.body.audience) || {}, req.cx));
  }));
  router.get('/messages/:id', read, asyncHandler(async (req, res) => sendDoc(res, await repos.message.get(req.params.id, req.cx))));
  router.patch('/messages/:id', write, asyncHandler(async (req, res) => {
    sendDoc(res, await messages.update(req.params.id, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
  }));
  router.delete('/messages/:id', write, asyncHandler(async (req, res) => {
    await messages.remove(req.params.id, req.cx);
    res.status(204).end();
  }));
  router.get('/messages/:id/stats', read, asyncHandler(async (req, res) => {
    await repos.message.get(req.params.id, req.cx);
    res.json(await communications.stats(req.params.id, req.cx, { runId: typeof req.query.runId === 'string' ? req.query.runId : undefined }));
  }));
  router.post(action('messages', ['schedule', 'pause', 'resume', 'cancel']), send, asyncHandler(async (req, res) => {
    sendDoc(res, await messages[req.params[1]](req.params[0], req.cx));
  }));
  router.post(action('messages', ['test-send']), send, asyncHandler(async (req, res) => {
    const { customerId, to } = req.body || {};
    sendDoc(res, await messages.testSend(req.params[0], { customerId, to }, req.cx), 201);
  }));

  // ---- communications -----------------------------------------------------
  router.get('/communications', read, asyncHandler(async (req, res) => res.json(await communications.list(list(req), req.cx))));
  router.get('/communications/:id', read, asyncHandler(async (req, res) => sendDoc(res, await communications.get(req.params.id, req.cx))));
  router.get('/communications/:id/events', read, asyncHandler(async (req, res) => {
    res.json({ items: await communications.engagement(req.params.id, req.cx) });
  }));

  router.post('/transactional', send, asyncHandler(async (req, res) => {
    const result = await messages.sendTransactional(req.body, req.cx);
    res.status(result.created ? 201 : 200).json(result.communication);
  }));

  // ---- suppressions, topics, channels ----------------------------------
  router.get('/suppressions', read, asyncHandler(async (req, res) => {
    const q = list(req);
    if (q.q) q.filters.push({ field: 'id', op: 'in', value: (await repos.suppression.searchText(q.q, req.cx, { limit: 200 })).map((t) => t.id).concat('-') });
    res.json(await repos.suppression.list(q, req.cx));
  }));
  router.post('/suppressions', write, asyncHandler(async (req, res) => sendDoc(res, await suppressions.add(req.body || {}, req.cx), 201)));
  router.delete('/suppressions/:id', can('marketing:admin'), asyncHandler(async (req, res) => {
    await suppressions.remove(req.params.id, req.cx);
    res.status(204).end();
  }));

  router.get('/topics', read, asyncHandler(async (req, res) => res.json(await repos.topic.list(list(req), req.cx))));
  router.post('/topics', write, asyncHandler(async (req, res) => sendDoc(res, await repos.topic.create(req.body, req.cx), 201)));
  router.patch('/topics/:id', write, asyncHandler(async (req, res) => {
    if (req.body && req.body.key !== undefined) throw badRequest('A topic key cannot change');
    sendDoc(res, await repos.topic.update(req.params.id, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
  }));
  router.delete('/topics/:id', write, asyncHandler(async (req, res) => {
    await repos.topic.softDelete(req.params.id, req.cx);
    res.status(204).end();
  }));

  router.get('/channels', read, (req, res) => {
    res.json({ items: Object.entries(channels).map(([channel, adapter]) => ({ channel, adapter: adapter.name, webhook: `webhooks/${adapter.name}` })) });
  });

  router.get('/reference', read, (req, res) => {
    res.json({
      channels: schemas.CHANNELS,
      templateStatuses: schemas.TEMPLATE_STATUSES,
      templateCategories: schemas.TEMPLATE_CATEGORIES,
      campaignStatuses: schemas.CAMPAIGN_STATUSES,
      campaignObjectives: schemas.CAMPAIGN_OBJECTIVES,
      campaignTypes: schemas.CAMPAIGN_TYPES,
      messageStatuses: schemas.MESSAGE_STATUSES,
      communicationStatuses: schemas.COMMUNICATION_STATUSES,
      skipReasons: schemas.SKIP_REASONS,
      suppressionScopes: schemas.SUPPRESSION_SCOPES,
      suppressionReasons: schemas.SUPPRESSION_REASONS,
      audienceFields: ['email', 'phone', 'countryCode', 'status', 'lifecycleStage', 'language', 'timezone', 'currency', 'tags', 'organizationId', 'createdAt', 'source.channel']
    });
  });

  documentRoutes(openapi);
}

function documentRoutes(openapi) {
  for (const s of [schemas.template, schemas.campaign, schemas.message, schemas.communication, schemas.engagement, schemas.suppression, schemas.topic]) {
    openapi.addSchema(s);
  }
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const json = (schema) => ({ content: { 'application/json': { schema } } });
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  const ok = (description) => ({ 200: { description } });
  const crud = (path, name, tag) => {
    openapi
      .addPath('get', `/${path}`, { tags: [tag], summary: `List ${path}`, responses: ok('Page') })
      .addPath('post', `/${path}`, { tags: [tag], summary: `Create ${name.toLowerCase()}`, requestBody: json(ref(`${name}Input`)), responses: { 201: { description: 'Created' } } })
      .addPath('get', `/${path}/{id}`, { tags: [tag], summary: `Get ${name.toLowerCase()}`, parameters: [id], responses: ok(name) })
      .addPath('patch', `/${path}/{id}`, { tags: [tag], summary: `Update ${name.toLowerCase()}`, parameters: [id], requestBody: json(ref(`${name}Input`)), responses: ok('Updated') });
  };
  crud('templates', 'Template', 'templates');
  crud('campaigns', 'Campaign', 'campaigns');
  crud('messages', 'Message', 'messages');
  crud('topics', 'Topic', 'topics');
  openapi
    .addPath('post', '/templates/{id}:approve', { tags: ['templates'], summary: 'Approve for sending', parameters: [id], responses: ok('Approved') })
    .addPath('post', '/templates/{id}:retire', { tags: ['templates'], summary: 'Retire', parameters: [id], responses: ok('Retired') })
    .addPath('post', '/templates/{id}:preview', { tags: ['templates'], summary: 'Render with sample data or a customer', parameters: [id], requestBody: json({ type: 'object', properties: { customerId: { type: 'string' }, data: { type: 'object' }, locale: { type: 'string' } } }), responses: ok('{ subject, bodyHtml, bodyText }') })
    .addPath('post', '/campaigns/{id}:status', { tags: ['campaigns'], summary: 'Change status', parameters: [id], requestBody: json({ type: 'object', properties: { status: { type: 'string' } } }), responses: ok('Updated') })
    .addPath('post', '/messages:preview-audience', { tags: ['messages'], summary: 'Count and sample an audience', requestBody: json({ type: 'object', properties: { audience: { type: 'object' } } }), responses: ok('{ count, sample }') })
    .addPath('delete', '/messages/{id}', { tags: ['messages'], summary: 'Delete a draft or cancelled message', parameters: [id], responses: { 204: { description: 'Deleted' } } })
    .addPath('get', '/messages/{id}/stats', { tags: ['messages'], summary: 'Delivery and engagement counts', parameters: [id], responses: ok('Stats') });
  for (const verb of ['schedule', 'pause', 'resume', 'cancel']) {
    openapi.addPath('post', `/messages/{id}:${verb}`, { tags: ['messages'], summary: `${verb[0].toUpperCase()}${verb.slice(1)} a message`, parameters: [id], responses: ok('Message') });
  }
  openapi
    .addPath('post', '/messages/{id}:test-send', { tags: ['messages'], summary: 'Send one test copy', parameters: [id], requestBody: json({ type: 'object', properties: { customerId: { type: 'string' }, to: { type: 'string' } } }), responses: { 201: { description: 'Test communication' } } })
    .addPath('get', '/communications', { tags: ['communications'], summary: 'Communications sent (filter[customerId], filter[status], filter[origin.messageId], …)', responses: ok('Page') })
    .addPath('get', '/communications/{id}', { tags: ['communications'], summary: 'One communication', parameters: [id], responses: ok('Communication') })
    .addPath('get', '/communications/{id}/events', { tags: ['communications'], summary: 'Engagement events', parameters: [id], responses: ok('Events') })
    .addPath('post', '/transactional', { tags: ['transactional'], summary: 'Send a transactional or service message now', requestBody: json({ type: 'object', required: ['template'], properties: { template: { type: 'string' }, customerId: { type: 'string' }, to: { type: 'string' }, data: { type: 'object' }, purpose: { type: 'string', enum: ['transactional', 'service'] }, idempotencyKey: { type: 'string' }, locale: { type: 'string' } } }), responses: { 201: { description: 'Sent (or skipped with a reason)' }, 200: { description: 'Same idempotency key: existing communication' } } })
    .addPath('get', '/suppressions', { tags: ['suppressions'], summary: 'List suppressions', responses: ok('Page') })
    .addPath('post', '/suppressions', { tags: ['suppressions'], summary: 'Add a suppression', requestBody: json(ref('SuppressionInput')), responses: { 201: { description: 'Added' } } })
    .addPath('delete', '/suppressions/{id}', { tags: ['suppressions'], summary: 'Remove a suppression (marketing:admin)', parameters: [id], responses: { 204: { description: 'Removed' } } })
    .addPath('get', '/channels', { tags: ['channels'], summary: 'Configured channel adapters', responses: ok('Channels') })
    .addPath('get', '/reference', { tags: ['reference'], summary: 'Enumerations for forms', responses: ok('Reference data') });
}

module.exports = { registerRoutes };
