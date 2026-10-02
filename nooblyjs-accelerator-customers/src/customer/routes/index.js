/**
 * @fileoverview Customer module REST API (`{basePath}/customer/api/v1`).
 *
 * Routes only translate HTTP to service calls: they parse input, check
 * permissions and shape responses. Domain rules live in the services.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const {
  asyncHandler, parseListQuery, sendDoc, expectedVersion
} = require('../../shared/http');
const { badRequest } = require('../../shared/errors');
const schemas = require('../schemas');

const CONTACT_KINDS = Object.freeze({ addresses: 'address', phones: 'phone', emails: 'email' });

/**
 * Registers every customer-module route on the module router.
 *
 * @param {Object} params
 * @param {Object} params.router - Module API router
 * @param {Object} params.rbac - RBAC helpers (`requirePermission`)
 * @param {Object} params.services - Customer-module services
 * @param {Object} params.audit - AuditService
 * @param {Object} params.openapi - OpenApiBuilder
 * @return {void}
 */
function registerRoutes({ router, rbac, services, audit, openapi }) {
  const can = rbac.requirePermission;
  const read = can('customer:read');
  const write = can('customer:write');
  const remove = can('customer:delete');
  const list = (req) => parseListQuery(req.query);
  const expandOf = (req) => parseListQuery({ expand: req.query.expand }).expand;
  const fieldsOf = (req) => parseListQuery({ fields: req.query.fields }).fields;

  // ---- customers ----------------------------------------------------------
  router.get('/customers', read, asyncHandler(async (req, res) => {
    res.json(await services.customers.list(list(req), req.cx));
  }));

  router.post('/customers', write, asyncHandler(async (req, res) => {
    sendDoc(res, await services.customers.create(req.body, req.cx), 201);
  }));

  router.post(/^\/customers:upsert$/, write, asyncHandler(async (req, res) => {
    const { identity, profile } = req.body || {};
    if (!identity || typeof identity !== 'object') throw badRequest('identity { namespace, value } is required');
    const result = await services.customers.upsertByIdentity(identity, profile || {}, req.cx);
    res.status(result.created ? 201 : 200).json(result);
  }));

  router.get('/customers/lookup', read, asyncHandler(async (req, res) => {
    const { email, phone, identity, number, q } = req.query;
    for (const [k, v] of Object.entries({ email, phone, identity, number, q })) {
      if (v !== undefined && typeof v !== 'string') throw badRequest(`${k} must be a single value`);
    }
    if (q !== undefined && email === undefined && phone === undefined && identity === undefined && number === undefined) {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 50);
      return res.json({ items: await services.customers.typeahead(q, req.cx, { limit }) });
    }
    return res.json({ items: await services.customers.lookup({ email, phone, identity, number }, req.cx) });
  }));

  router.get('/customers/:id', read, asyncHandler(async (req, res) => {
    sendDoc(res, await services.customers.get(req.params.id, req.cx, { expand: expandOf(req), fields: fieldsOf(req) }));
  }));

  router.patch('/customers/:id', write, asyncHandler(async (req, res) => {
    sendDoc(res, await services.customers.update(req.params.id, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
  }));

  router.delete('/customers/:id', remove, asyncHandler(async (req, res) => {
    await services.customers.remove(req.params.id, req.cx, { expectedVersion: expectedVersion(req) });
    res.status(204).end();
  }));

  router.post(/^\/customers\/([^/:]+):status$/, write, asyncHandler(async (req, res) => {
    const { status, reason } = req.body || {};
    if (typeof status !== 'string') throw badRequest('status is required');
    sendDoc(res, await services.customers.setStatus(req.params[0], status, req.cx, { reason, expectedVersion: expectedVersion(req) }));
  }));

  registerContactPoints('customers', 'customer');

  // identities
  router.get('/customers/:id/identities', read, asyncHandler(async (req, res) => {
    await services.customers.get(req.params.id, req.cx, { fields: ['id'] });
    res.json({ items: await services.identities.list(req.params.id, req.cx) });
  }));
  router.post('/customers/:id/identities', write, asyncHandler(async (req, res) => {
    sendDoc(res, await services.identities.link(req.params.id, req.body || {}, req.cx), 201);
  }));
  router.delete('/customers/:id/identities/:identityId', write, asyncHandler(async (req, res) => {
    await services.identities.unlink(req.params.id, req.params.identityId, req.cx);
    res.status(204).end();
  }));

  // consent ledger
  router.get('/customers/:id/consents', read, asyncHandler(async (req, res) => {
    const { purpose, channel } = req.query;
    res.json({ items: await services.consents.history(req.params.id, req.cx, { purpose, channel }) });
  }));
  router.post('/customers/:id/consents', can('consent:write'), asyncHandler(async (req, res) => {
    const body = { ...(req.body || {}) };
    if (body.evidence === undefined && ['form', 'preference_centre'].includes(body.source)) {
      body.evidence = { ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 500) };
    }
    sendDoc(res, await services.consents.record(req.params.id, body, req.cx), 201);
  }));
  router.get('/customers/:id/consents/state', read, asyncHandler(async (req, res) => {
    await services.customers.get(req.params.id, req.cx, { fields: ['id'] });
    res.json({ items: await services.consents.getConsentState(req.params.id, req.cx) });
  }));
  router.get('/customers/:id/consents/check', read, asyncHandler(async (req, res) => {
    const { purpose, channel, topicId } = req.query;
    res.json(await services.consents.canContact(req.params.id, { purpose, channel, topicId }, req.cx));
  }));

  registerNotes('customers', 'customer');

  router.get('/customers/:id/timeline', read, asyncHandler(async (req, res) => {
    const types = parseListQuery({ expand: req.query.types }).expand;
    res.json(await services.timeline.list(req.params.id, req.cx, {
      limit: req.query.limit, before: req.query.before, types
    }));
  }));

  router.get('/customers/:id/audit', can('audit:read'), asyncHandler(async (req, res) => {
    const q = list(req);
    res.json(await audit.list({ entityId: req.params.id, limit: q.limit, offset: q.offset }, req.cx));
  }));

  // ---- organizations ------------------------------------------------------
  router.get('/organizations', read, asyncHandler(async (req, res) => {
    res.json(await services.organizations.list(list(req), req.cx));
  }));
  router.post('/organizations', write, asyncHandler(async (req, res) => {
    sendDoc(res, await services.organizations.create(req.body, req.cx), 201);
  }));
  router.get('/organizations/:id', read, asyncHandler(async (req, res) => {
    sendDoc(res, await services.organizations.get(req.params.id, req.cx, { expand: expandOf(req), fields: fieldsOf(req) }));
  }));
  router.patch('/organizations/:id', write, asyncHandler(async (req, res) => {
    sendDoc(res, await services.organizations.update(req.params.id, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
  }));
  router.delete('/organizations/:id', remove, asyncHandler(async (req, res) => {
    await services.organizations.remove(req.params.id, req.cx, { expectedVersion: expectedVersion(req) });
    res.status(204).end();
  }));
  registerContactPoints('organizations', 'organization');
  registerNotes('organizations', 'organization');

  // ---- audit --------------------------------------------------------------
  router.get('/audit', can('audit:read'), asyncHandler(async (req, res) => {
    const q = list(req);
    const { entity, entityId, action } = req.query;
    res.json(await audit.list({ entity, entityId, action, limit: q.limit, offset: q.offset }, req.cx));
  }));

  // ---- reference data -----------------------------------------------------
  router.get('/reference', read, (req, res) => {
    res.json({
      customerStatuses: schemas.CUSTOMER_STATUSES,
      lifecycleStages: schemas.LIFECYCLE_STAGES,
      consentPurposes: schemas.CONSENT_PURPOSES,
      consentChannels: schemas.CONSENT_CHANNELS,
      consentStatuses: schemas.CONSENT_STATUSES,
      lawfulBases: schemas.LAWFUL_BASES,
      consentSources: schemas.CONSENT_SOURCES,
      addressTypes: schemas.address.fields.type.values,
      phoneTypes: schemas.phone.fields.type.values,
      emailTypes: schemas.email.fields.type.values,
      employeeBands: schemas.organization.fields.employeeBand.values,
      countries: Object.values(require('../../shared/reference/countries').COUNTRIES).map(({ code, name }) => ({ code, name }))
    });
  });

  function registerContactPoints(base, partyType) {
    for (const [segment, kind] of Object.entries(CONTACT_KINDS)) {
      const svc = services.contactPoints[kind];
      router.get(`/${base}/:id/${segment}`, read, asyncHandler(async (req, res) => {
        res.json({ items: await svc.list(partyType, req.params.id, req.cx) });
      }));
      router.post(`/${base}/:id/${segment}`, write, asyncHandler(async (req, res) => {
        sendDoc(res, await svc.add(partyType, req.params.id, req.body || {}, req.cx), 201);
      }));
      router.get(`/${base}/:id/${segment}/:cpId`, read, asyncHandler(async (req, res) => {
        sendDoc(res, await svc.get(partyType, req.params.id, req.params.cpId, req.cx));
      }));
      router.patch(`/${base}/:id/${segment}/:cpId`, write, asyncHandler(async (req, res) => {
        sendDoc(res, await svc.update(partyType, req.params.id, req.params.cpId, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
      }));
      router.delete(`/${base}/:id/${segment}/:cpId`, write, asyncHandler(async (req, res) => {
        await svc.remove(partyType, req.params.id, req.params.cpId, req.cx);
        res.status(204).end();
      }));
    }
  }

  function registerNotes(base, subjectType) {
    router.get(`/${base}/:id/notes`, read, asyncHandler(async (req, res) => {
      res.json({ items: await services.notes.list(subjectType, req.params.id, req.cx) });
    }));
    router.post(`/${base}/:id/notes`, write, asyncHandler(async (req, res) => {
      sendDoc(res, await services.notes.add(subjectType, req.params.id, req.body || {}, req.cx), 201);
    }));
    router.patch(`/${base}/:id/notes/:noteId`, write, asyncHandler(async (req, res) => {
      sendDoc(res, await services.notes.update(subjectType, req.params.id, req.params.noteId, req.body, req.cx, { expectedVersion: expectedVersion(req) }));
    }));
    router.delete(`/${base}/:id/notes/:noteId`, write, asyncHandler(async (req, res) => {
      await services.notes.remove(subjectType, req.params.id, req.params.noteId, req.cx);
      res.status(204).end();
    }));
  }

  documentRoutes(openapi);
}

/** Adds the module's operations to the OpenAPI document. */
function documentRoutes(openapi) {
  for (const s of [schemas.customer, schemas.organization, schemas.address, schemas.phone, schemas.email, schemas.identity, schemas.consent, schemas.note]) {
    openapi.addSchema(s);
  }
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const json = (schema) => ({ content: { 'application/json': { schema } } });
  const page = (name) => json({ type: 'object', properties: { items: { type: 'array', items: ref(name) }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' }, nextCursor: { type: 'string', nullable: true } } });
  const items = (name) => json({ type: 'object', properties: { items: { type: 'array', items: ref(name) } } });
  const errors = { 400: { description: 'Bad request', ...json(ref('Error')) }, 401: { description: 'Unauthenticated' }, 403: { description: 'Forbidden' }, 404: { description: 'Not found' }, 409: { description: 'Conflict' }, 412: { description: 'Version conflict (If-Match)' }, 422: { description: 'Validation failed', ...json(ref('Error')) } };
  const listParams = [
    { name: 'filter', in: 'query', style: 'deepObject', explode: true, schema: { type: 'object' }, description: 'filter[field]=v or filter[field][op]=v' },
    { name: 'sort', in: 'query', schema: { type: 'string' }, example: '-createdAt' },
    { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } },
    { name: 'fields', in: 'query', schema: { type: 'string' } },
    { name: 'q', in: 'query', schema: { type: 'string' } }
  ];
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  const ifMatch = { name: 'If-Match', in: 'header', schema: { type: 'string' }, example: 'W/"3"' };
  const expand = { name: 'expand', in: 'query', schema: { type: 'string' }, example: 'emails,phones,addresses,identities,consentState' };

  openapi
    .addPath('get', '/customers', { tags: ['customers'], summary: 'List customers', parameters: [...listParams, expand], responses: { 200: { description: 'Page', ...page('Customer') }, ...errors } })
    .addPath('post', '/customers', { tags: ['customers'], summary: 'Create a customer (with optional nested emails, phones, addresses, identities, consents)', requestBody: json(ref('CustomerInput')), responses: { 201: { description: 'Created', ...json(ref('Customer')) }, ...errors } })
    .addPath('post', '/customers:upsert', { tags: ['customers'], summary: 'Find or create a customer by external identity', requestBody: json({ type: 'object', properties: { identity: { type: 'object', properties: { namespace: { type: 'string' }, value: { type: 'string' } } }, profile: ref('CustomerInput') } }), responses: { 200: { description: 'Matched' }, 201: { description: 'Created' }, ...errors } })
    .addPath('get', '/customers/lookup', { tags: ['customers'], summary: 'Exact lookup (email, phone, identity=ns:value, number) or typeahead (q)', parameters: ['email', 'phone', 'identity', 'number', 'q', 'limit'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })), responses: { 200: { description: 'Matches', ...items('Customer') }, ...errors } })
    .addPath('get', '/customers/{id}', { tags: ['customers'], summary: 'Get a customer', parameters: [id, expand], responses: { 200: { description: 'Customer', ...json(ref('Customer')) }, ...errors } })
    .addPath('patch', '/customers/{id}', { tags: ['customers'], summary: 'Update a customer (JSON merge patch)', parameters: [id, ifMatch], requestBody: json(ref('CustomerInput')), responses: { 200: { description: 'Updated', ...json(ref('Customer')) }, ...errors } })
    .addPath('delete', '/customers/{id}', { tags: ['customers'], summary: 'Delete a customer (soft)', parameters: [id, ifMatch], responses: { 204: { description: 'Deleted' }, ...errors } })
    .addPath('post', '/customers/{id}:status', { tags: ['customers'], summary: 'Change status (active, inactive, blocked)', parameters: [id, ifMatch], requestBody: json({ type: 'object', properties: { status: { type: 'string' }, reason: { type: 'string' } } }), responses: { 200: { description: 'Updated' }, ...errors } })
    .addPath('get', '/customers/{id}/timeline', { tags: ['customers'], summary: 'Customer 360 timeline', parameters: [id, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'types', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Entries' }, ...errors } })
    .addPath('get', '/customers/{id}/audit', { tags: ['audit'], summary: 'Audit log of a customer', parameters: [id], responses: { 200: { description: 'Entries' }, ...errors } })
    .addPath('get', '/customers/{id}/identities', { tags: ['identities'], summary: 'List identities', parameters: [id], responses: { 200: { description: 'Identities', ...items('Identity') }, ...errors } })
    .addPath('post', '/customers/{id}/identities', { tags: ['identities'], summary: 'Link an identity', parameters: [id], requestBody: json(ref('IdentityInput')), responses: { 201: { description: 'Linked' }, ...errors } })
    .addPath('delete', '/customers/{id}/identities/{identityId}', { tags: ['identities'], summary: 'Unlink an identity', parameters: [id, { name: 'identityId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Unlinked' }, ...errors } })
    .addPath('get', '/customers/{id}/consents', { tags: ['consent'], summary: 'Consent ledger, newest first', parameters: [id], responses: { 200: { description: 'Records', ...items('Consent') }, ...errors } })
    .addPath('post', '/customers/{id}/consents', { tags: ['consent'], summary: 'Record consent (append-only)', parameters: [id], requestBody: json(ref('ConsentInput')), responses: { 201: { description: 'Recorded' }, ...errors } })
    .addPath('get', '/customers/{id}/consents/state', { tags: ['consent'], summary: 'Current consent per purpose and channel', parameters: [id], responses: { 200: { description: 'State' }, ...errors } })
    .addPath('get', '/customers/{id}/consents/check', { tags: ['consent'], summary: 'May this customer be contacted?', parameters: [id, ...['purpose', 'channel', 'topicId'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } }))], responses: { 200: { description: '{ allowed, reason, consentId }' }, ...errors } })
    .addPath('get', '/organizations', { tags: ['organizations'], summary: 'List organizations', parameters: listParams, responses: { 200: { description: 'Page', ...page('Organization') }, ...errors } })
    .addPath('post', '/organizations', { tags: ['organizations'], summary: 'Create an organization', requestBody: json(ref('OrganizationInput')), responses: { 201: { description: 'Created' }, ...errors } })
    .addPath('get', '/organizations/{id}', { tags: ['organizations'], summary: 'Get an organization', parameters: [id, { ...expand, example: 'emails,phones,addresses,members' }], responses: { 200: { description: 'Organization' }, ...errors } })
    .addPath('patch', '/organizations/{id}', { tags: ['organizations'], summary: 'Update an organization', parameters: [id, ifMatch], requestBody: json(ref('OrganizationInput')), responses: { 200: { description: 'Updated' }, ...errors } })
    .addPath('delete', '/organizations/{id}', { tags: ['organizations'], summary: 'Delete an organization (soft)', parameters: [id, ifMatch], responses: { 204: { description: 'Deleted' }, ...errors } })
    .addPath('get', '/audit', { tags: ['audit'], summary: 'Audit log', parameters: ['entity', 'entityId', 'action', 'limit', 'offset'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })), responses: { 200: { description: 'Entries' }, ...errors } })
    .addPath('get', '/reference', { tags: ['reference'], summary: 'Enumerations and countries for forms', responses: { 200: { description: 'Reference data' } } });

  for (const base of ['customers', 'organizations']) {
    for (const [segment, kind] of Object.entries(CONTACT_KINDS)) {
      const name = kind[0].toUpperCase() + kind.slice(1);
      const cp = { name: 'cpId', in: 'path', required: true, schema: { type: 'string' } };
      openapi
        .addPath('get', `/${base}/{id}/${segment}`, { tags: [segment], summary: `List ${segment}`, parameters: [id], responses: { 200: { description: 'Items', ...items(name) }, ...errors } })
        .addPath('post', `/${base}/{id}/${segment}`, { tags: [segment], summary: `Add ${kind === 'address' ? 'an' : 'a'} ${kind}`, parameters: [id], requestBody: json(ref(`${name}Input`)), responses: { 201: { description: 'Added' }, ...errors } })
        .addPath('get', `/${base}/{id}/${segment}/{cpId}`, { tags: [segment], summary: `Get ${kind}`, parameters: [id, cp], responses: { 200: { description: name }, ...errors } })
        .addPath('patch', `/${base}/{id}/${segment}/{cpId}`, { tags: [segment], summary: `Update ${kind} (isPrimary: true promotes it)`, parameters: [id, cp, ifMatch], requestBody: json(ref(`${name}Input`)), responses: { 200: { description: 'Updated' }, ...errors } })
        .addPath('delete', `/${base}/{id}/${segment}/{cpId}`, { tags: [segment], summary: `Remove ${kind}`, parameters: [id, cp], responses: { 204: { description: 'Removed' }, ...errors } });
    }
    openapi
      .addPath('get', `/${base}/{id}/notes`, { tags: ['notes'], summary: 'List notes', parameters: [id], responses: { 200: { description: 'Notes', ...items('Note') }, ...errors } })
      .addPath('post', `/${base}/{id}/notes`, { tags: ['notes'], summary: 'Add a note', parameters: [id], requestBody: json(ref('NoteInput')), responses: { 201: { description: 'Added' }, ...errors } });
  }
}

module.exports = { registerRoutes };
