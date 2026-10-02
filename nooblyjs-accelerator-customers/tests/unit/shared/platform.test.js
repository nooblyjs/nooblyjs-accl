'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const { DomainEventBus } = require('../../../src/shared/events');
const { AuditService, diff } = require('../../../src/shared/audit');
const { createRbac, defaultRoleResolver, DEFAULT_ROLES } = require('../../../src/shared/rbac');
const { createContext, systemContext, actorId, hasPermission } = require('../../../src/shared/context');
const http = require('../../../src/shared/http');
const { OpenApiBuilder } = require('../../../src/shared/http/openapi');
const errors = require('../../../src/shared/errors');
const { defineSchema } = require('../../../src/shared/schema');
const { createServices, createSilentLogger } = require('../../helpers/registry');

const flush = () => new Promise((r) => setImmediate(r));

describe('context', () => {
  test('defaults, wildcards and actor ids', () => {
    const ctx = createContext();
    expect(ctx).toMatchObject({ tenantId: 'default', actor: { type: 'anonymous' }, roles: [] });
    expect(ctx.correlationId).toEqual(expect.any(String));
    expect(ctx.can('customer:read')).toBe(false);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(createContext({ permissions: ['customer:*'] }).can('customer:merge')).toBe(true);
    expect(systemContext('seed').can('anything:at-all')).toBe(true);
    expect(actorId(systemContext('seed'))).toBe('system:seed');
    expect(actorId(null)).toBe('anonymous');
    expect(hasPermission(new Set(['a:b']), 'a:c')).toBe(false);
  });
});

describe('DomainEventBus', () => {
  test('publishes an envelope on the emitter and the notifying topic', async () => {
    const s = createServices();
    const bus = new DomainEventBus({ eventEmitter: s.eventEmitter, notifying: s.notifying, logger: s.logger });
    const received = [];
    const topic = [];
    await s.notifying.subscribe('cx.customer', (m) => topic.push(m));
    const off = bus.on('customer.created', (e) => received.push(e));
    const ctx = systemContext('t', { correlationId: 'corr-1' });
    const env = bus.publish('customer.created', { module: 'customer', subject: { entity: 'customer', id: '1' }, data: { a: 1 }, changes: [] }, ctx);
    await flush();
    expect(env).toMatchObject({
      type: 'cx.customer.created', specVersion: '1.0', tenantId: 'default', correlationId: 'corr-1',
      actor: { id: 'system:t' }, subject: { id: '1' }, data: { a: 1 }, changes: []
    });
    expect(env.id).toMatch(/^evt_/);
    expect(received).toEqual([env]);
    expect(topic).toEqual([env]);
    off();
    bus.publish('customer.created', { module: 'customer' });
    expect(received).toHaveLength(1);
    expect(bus.publish('x.y', {}).tenantId).toBe('default');
  });

  test('isolates failing handlers and cleans up on close', async () => {
    const eventEmitter = new EventEmitter();
    const logger = createSilentLogger();
    const notifying = { notify: jest.fn().mockRejectedValue(new Error('down')) };
    const bus = new DomainEventBus({ eventEmitter, notifying, logger });
    const ok = jest.fn();
    bus.on('cx.a.b', () => { throw new Error('sync'); });
    bus.on('a.b', async () => { throw new Error('async'); });
    const h = jest.fn();
    bus.on('a.b', ok);
    bus.on('a.c', h);
    expect(() => bus.publish('a.b', { module: 'm' })).not.toThrow();
    await flush();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(logger.calls.filter((c) => c.level === 'error')).toHaveLength(2);
    expect(logger.calls.filter((c) => c.level === 'warn')).toHaveLength(1);
    bus.off('a.c', h);
    bus.off('a.c', h);
    expect(bus.listenerCount()).toBe(3);
    bus.close();
    expect(bus.listenerCount()).toBe(0);
    expect(eventEmitter.listenerCount('cx.a.b')).toBe(0);
    expect(() => new DomainEventBus({})).toThrow(/eventEmitter/);
  });
});

describe('AuditService', () => {
  const schema = defineSchema({ name: 'thing', fields: { name: { type: 'string', pii: true }, contact: { type: 'object', fields: { email: { type: 'string', pii: true }, kind: { type: 'string' } } }, n: { type: 'integer' } } });

  test('diff redacts PII and ignores bookkeeping fields', () => {
    const changes = diff(
      { id: '1', version: 1, name: 'A', contact: { email: 'a@x', kind: 'w' }, n: 1, gone: 'x' },
      { id: '1', version: 2, name: 'B', contact: { email: 'b@x', kind: 'h' }, n: 1, added: { deep: 1 }, empty: {} },
      new Set(['name', 'contact.email'])
    );
    expect(changes).toEqual(expect.arrayContaining([
      { op: 'replace', path: '/name', from: '[REDACTED]', value: '[REDACTED]' },
      { op: 'replace', path: '/contact/email', from: '[REDACTED]', value: '[REDACTED]' },
      { op: 'replace', path: '/contact/kind', from: 'w', value: 'h' },
      { op: 'remove', path: '/gone', from: 'x' },
      { op: 'add', path: '/added/deep', value: 1 },
      { op: 'add', path: '/empty', value: {} }
    ]));
    expect(changes).toHaveLength(6);
    expect(diff(null, null)).toEqual([]);
    expect(diff({ name: null }, { name: 'x' }, new Set(['name']))).toEqual([{ op: 'replace', path: '/name', from: null, value: '[REDACTED]' }]);
  });

  test('records and lists entries per tenant, newest first', async () => {
    const s = createServices();
    const audit = new AuditService({ dataService: s.dataService, containerPrefix: 'zz' });
    const ctx = systemContext('t');
    const first = await audit.record({ schema, entityId: '1', action: 'create', before: null, after: { name: 'A' }, ctx });
    await new Promise((r) => setTimeout(r, 5));
    await audit.record({ schema, entityId: '1', action: 'export', before: null, after: null, ctx, meta: { format: 'csv' } });
    await audit.record({ schema, entityId: '2', action: 'create', before: null, after: {}, ctx: systemContext('t', { tenantId: 'other' }) });
    expect(audit.container).toBe('zz_audit');
    expect(first).toMatchObject({ entity: 'thing', entityId: '1', action: 'create', actor: { id: 'system:t' }, tenantId: 'default' });
    const page = await audit.list({ entity: 'thing', entityId: '1' }, ctx);
    expect(page.items.map((e) => e.action)).toEqual(['export', 'create']);
    expect(page.items[0].meta).toEqual({ format: 'csv' });
    expect((await audit.list({ action: 'create' }, ctx)).total).toBe(1);
    expect((await audit.list(undefined, ctx)).total).toBe(2);
    await expect(audit.record({ schema, entityId: '1', action: 'hack', ctx })).rejects.toThrow(/unknown action/);
  });
});

describe('rbac', () => {
  const run = (rbac, req, perms = ['customer:read']) => new Promise((resolve) => {
    const r = { headers: {}, ...req };
    const res = { setHeader: jest.fn() };
    rbac.requirePermission(...perms)(r, res, (err) => resolve({ err, req: r }));
  });

  test('default resolver reads session users, core tokens and API keys', () => {
    expect(defaultRoleResolver({ user: { roles: ['agent'] } })).toEqual(['agent']);
    expect(defaultRoleResolver({ user: { role: 'admin' } })).toEqual(['admin']);
    expect(defaultRoleResolver({ user: {}, userRoles: ['marketer'] })).toEqual(['marketer']);
    expect(defaultRoleResolver({ apiKey: 'k' })).toEqual(['service']);
    expect(defaultRoleResolver({})).toEqual([]);
    expect(DEFAULT_ROLES.admin).toEqual(['*']);
  });

  test('requirePermission gives 401 / 403 / pass', async () => {
    const rbac = createRbac();
    expect((await run(rbac, {})).err.statusCode).toBe(401);
    expect((await run(rbac, { user: { id: 'u', roles: ['marketer'] } }, ['support:read'])).err.statusCode).toBe(403);
    const ok = await run(rbac, { user: { id: 'u', roles: ['agent'] } }, ['customer:read', 'support:write']);
    expect(ok.err).toBeUndefined();
    expect(ok.req.cx.actor).toEqual({ type: 'user', id: 'u' });
    expect(ok.req.cx.can('pii:read')).toBe(false);
    const key = await run(rbac, { apiKey: 'abcdefghijkl' });
    expect(key.req.cx.actor).toEqual({ type: 'api_key', id: 'apikey:abcdefgh' });
  });

  test('custom roles, resolver, tenancy and correlation ids', async () => {
    const rbac = createRbac({ roles: { auditor: ['audit:read'] }, roleResolver: (req) => req.headers['x-role'], tenancy: { enabled: true } });
    expect(rbac.permissionsFor(['auditor', 'unknown'])).toEqual(new Set(['audit:read']));
    const noTenant = await run(rbac, { headers: { 'x-role': 'auditor' } }, ['audit:read']);
    expect(noTenant.err.statusCode).toBe(400);
    const ok = await run(rbac, { headers: { 'x-role': 'auditor', 'x-tenant-id': 'acme', 'x-correlation-id': 'abc-123' } }, ['audit:read']);
    expect(ok.err).toBeUndefined();
    expect(ok.req.cx).toMatchObject({ tenantId: 'acme', correlationId: 'abc-123' });
    const bad = rbac.contextFromRequest({ headers: { 'x-role': 'auditor', 'x-tenant-id': 't', 'x-correlation-id': 'bad id!' } });
    expect(bad.correlationId).not.toBe('bad id!');
    const resolved = createRbac({ tenancy: { enabled: true, resolve: () => 'fixed' }, roleResolver: () => null });
    expect(resolved.contextFromRequest({ headers: {} })).toMatchObject({ tenantId: 'fixed', roles: [] });
  });

  test('attachContext sets req.cx and the correlation header, or forwards errors', () => {
    const rbac = createRbac({ tenancy: { enabled: true } });
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    const req = { headers: { 'x-tenant-id': 't1' } };
    rbac.attachContext(req, res, next);
    expect(req.cx.tenantId).toBe('t1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-Id', req.cx.correlationId);
    rbac.attachContext({ headers: {} }, res, next);
    expect(next.mock.calls[1][0].statusCode).toBe(400);
  });
});

describe('http helpers', () => {
  test('parseListQuery parses filters, sort, paging, fields and expand', () => {
    const q = http.parseListQuery({
      filter: { status: 'open', priority: { in: 'p1,p2' }, 'name.family': { prefix: 'sm' }, tags: ['a', 'b'] },
      sort: '-createdAt,+name', limit: '500', offset: '20', fields: 'id,name', expand: 'addresses', q: 'ada', includeDeleted: 'true'
    });
    expect(q.filters).toEqual([
      { field: 'status', op: 'eq', value: 'open' },
      { field: 'priority', op: 'in', value: ['p1', 'p2'] },
      { field: 'name.family', op: 'prefix', value: 'sm' },
      { field: 'tags', op: 'in', value: ['a', 'b'] }
    ]);
    expect(q.sort).toEqual([{ field: 'createdAt', dir: -1 }, { field: 'name', dir: 1 }]);
    expect(q).toMatchObject({ limit: 200, offset: 20, fields: ['id', 'name'], expand: ['addresses'], q: 'ada', includeDeleted: true });
    expect(http.parseListQuery({ cursor: '5' })).toMatchObject({ limit: 50, offset: 5, fields: undefined, expand: [], filters: [], sort: [] });
    expect(http.parseListQuery()).toMatchObject({ limit: 50, offset: 0 });
  });

  test.each([
    [{ filter: 'x' }],
    [{ filter: { 'bad field': 'x' } }],
    [{ filter: { a: { zz: '1' } } }],
    [{ filter: { a: { eq: ['1', '2'] } } }],
    [{ sort: '-1bad' }],
    [{ fields: 'a,$b' }],
    [{ expand: 'x y' }],
    [{ q: ['a', 'b'] }],
    [{ q: 'x'.repeat(201) }]
  ])('parseListQuery rejects %j', (query) => {
    expect(() => http.parseListQuery(query)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('ETag helpers', () => {
    expect(http.etagFor({ version: 3 })).toBe('W/"3"');
    expect(http.expectedVersion({ headers: {} })).toBeUndefined();
    expect(http.expectedVersion({ headers: { 'if-match': '*' } })).toBeUndefined();
    expect(http.expectedVersion({ headers: { 'if-match': 'W/"7"' } })).toBe(7);
    expect(http.expectedVersion({ headers: { 'if-match': '"8"' } })).toBe(8);
    expect(() => http.expectedVersion({ headers: { 'if-match': 'abc' } })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('error mapping through a router', async () => {
    const app = express();
    const logger = createSilentLogger();
    const eventEmitter = new EventEmitter();
    const emitted = [];
    eventEmitter.on('error-response', (e) => emitted.push(e));
    app.use(express.json());
    app.get('/doc', http.asyncHandler(async (req, res) => http.sendDoc(res, { id: '1', version: 2 }, 201)));
    app.get('/plain', (req, res) => http.sendDoc(res, { ok: true }));
    app.get('/422', http.asyncHandler(async () => { throw errors.validationError('bad', [{ path: 'a', message: 'x' }]); }));
    app.get('/404', http.asyncHandler(async () => { throw errors.notFound('customer', '9'); }));
    app.get('/409', http.asyncHandler(async () => { throw errors.conflict('dup', { index: 'email' }); }));
    app.get('/412', http.asyncHandler(async () => { throw errors.versionConflict(1, 2); }));
    app.get('/429', http.asyncHandler(async () => { throw new errors.ClientError(429, 'slow down'); }));
    app.get('/418', http.asyncHandler(async () => { throw new errors.ClientError(418, 'teapot'); }));
    app.get('/500', http.asyncHandler(async () => { throw new Error('secret db detail'); }));
    app.get('/sent', (req, res, next) => { res.status(200).json({}); next(new Error('late')); });
    app.post('/json', (req, res) => res.json(req.body));
    app.use(http.notFoundHandler());
    app.use(http.errorMiddleware({ logger, eventEmitter }));

    const doc = await request(app).get('/doc');
    expect(doc.status).toBe(201);
    expect(doc.headers.etag).toBe('W/"2"');
    expect((await request(app).get('/plain')).headers.etag).not.toMatch(/^W\/"\d+"$/);
    expect((await request(app).get('/422')).body).toEqual({ error: { code: 'validation_failed', message: 'bad', details: [{ path: 'a', message: 'x' }] } });
    expect((await request(app).get('/404')).body.error.code).toBe('not_found');
    expect((await request(app).get('/409')).body.error.code).toBe('conflict');
    expect((await request(app).get('/412')).status).toBe(412);
    expect((await request(app).get('/429')).body.error.code).toBe('rate_limited');
    expect((await request(app).get('/418')).body.error.code).toBe('error');
    const fail = await request(app).get('/500');
    expect(fail.status).toBe(500);
    expect(fail.body.error.message).toBe('Internal Server Error');
    expect(JSON.stringify(fail.body)).not.toMatch(/secret/);
    expect(logger.calls[0].meta.error).toBe('secret db detail');
    expect(emitted[0].status).toBe(500);
    expect((await request(app).get('/sent')).status).toBe(200);
    const malformed = await request(app).post('/json').set('Content-Type', 'application/json').send('{bad');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.message).toBe('Malformed JSON body');
    const big = await request(app).post('/json').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'y'.repeat(200000) }));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('payload_too_large');
    expect((await request(app).get('/missing')).status).toBe(404);
    expect(http.toErrorResponse({ type: 'x', status: 415 }).body.error.message).toBe('Bad request');
  });

  test('OpenApiBuilder', () => {
    const b = new OpenApiBuilder({ title: 'T', version: '1', serverUrl: '/api' });
    b.addSchema(defineSchema({ name: 'thing', fields: { a: { type: 'string', required: true } } }))
      .addPath('get', '/things', { summary: 'list' })
      .addPath('post', '/things', { summary: 'create' });
    const doc = b.build();
    expect(Object.keys(doc.paths['/things'])).toEqual(['get', 'post']);
    expect(doc.components.schemas.Thing.properties.id).toBeDefined();
    expect(doc.components.schemas.ThingInput.properties.id).toBeUndefined();
    expect(doc.components.schemas.Error).toBeDefined();
  });

  test('badRequest carries details', () => {
    expect(errors.badRequest('x', ['d'])).toMatchObject({ statusCode: 400, code: 'bad_request', details: ['d'] });
  });
});
