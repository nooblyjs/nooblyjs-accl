'use strict';

const express = require('express');
const request = require('supertest');
const customers = require('../..');
const { createServices, createMockRegistry } = require('../helpers/registry');

function host(options = {}, registry = createMockRegistry()) {
  const app = express();
  const eventEmitter = registry.services.eventEmitter;
  return { app, eventEmitter, registry, mount: () => customers.mount(app, eventEmitter, registry, options) };
}

describe('mount', () => {
  test('mounts every module with health, OpenAPI and UI', async () => {
    const h = host({ auth: { roleResolver: () => ['admin'] } });
    const cx = await h.mount();
    expect(Object.keys(cx)).toEqual(expect.arrayContaining(['customer', 'marketing', 'support', 'events', 'audit', 'shutdown']));
    expect(cx.version).toBe(require('../../package.json').version);
    for (const m of ['customer', 'marketing', 'support']) {
      const res = await request(h.app).get(`/applications/${m}/api/v1/health`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', module: m, checks: { dataService: 'ok' } });
      expect(res.headers['x-correlation-id']).toBeDefined();
      const doc = await request(h.app).get(`/applications/${m}/api/v1/openapi.json`);
      expect(doc.body.servers[0].url).toBe(`/applications/${m}/api/v1`);
      const ui = await request(h.app).get(`/applications/${m}/`);
      expect(ui.status).toBe(200);
      expect(ui.text).toMatch(/<html/);
    }
    const missing = await request(h.app).get('/applications/customer/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    await cx.shutdown();
    await cx.shutdown();
  });

  test('uses the requested core providers', async () => {
    const h = host({
      providers: { data: { type: 'file', options: { dataDir: 'x' } }, cache: { type: 'redis' }, search: { type: 'memory' } }
    });
    const cx = await h.mount();
    expect(h.registry.requested.dataService).toEqual({ type: 'file', options: { dataDir: 'x' } });
    expect(h.registry.requested.cache).toEqual({ type: 'redis', options: { instanceName: 'cx' } });
    expect(h.registry.requested.logger.type).toBe('console');
    await cx.shutdown();
  });

  test('honours basePath, module selection, container prefix and ui:false', async () => {
    const h = host({ basePath: '/cx', modules: ['customer'], containerPrefix: 'acme', ui: false });
    const cx = await h.mount();
    expect(cx.marketing).toBeUndefined();
    expect((await request(h.app).get('/cx/customer/api/v1/health')).status).toBe(200);
    expect((await request(h.app).get('/cx/customer/')).status).toBe(404);
    expect((await request(h.app).get('/applications/customer/api/v1/health')).status).toBe(404);
    expect(cx.audit.container).toBe('acme_audit');
    await cx.shutdown();
  });

  test('mounts at the root with an empty basePath', async () => {
    const h = host({ basePath: '', modules: ['customer'] });
    const cx = await h.mount();
    expect((await request(h.app).get('/customer/api/v1/health')).status).toBe(200);
    await cx.shutdown();
  });

  test('reports degraded health when the data service fails', async () => {
    const services = createServices();
    const h = host({}, createMockRegistry(services));
    const cx = await h.mount();
    jest.spyOn(services.dataService, 'count').mockRejectedValue(new Error('db down'));
    const res = await request(h.app).get('/applications/support/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', checks: { dataService: 'failed' } });
    expect(JSON.stringify(res.body)).not.toMatch(/db down/);
    await cx.shutdown();
  });

  test('shutdown removes every listener the accelerator registered', async () => {
    const h = host();
    const before = h.eventEmitter.eventNames().length;
    const cx = await h.mount();
    cx.events.on('customer.created', () => {});
    expect(cx.events.listenerCount()).toBe(1);
    await cx.shutdown();
    expect(cx.events.listenerCount()).toBe(0);
    expect(h.eventEmitter.eventNames().length).toBe(before);
  });

  test.each([
    [{ modules: [] }, /non-empty array/],
    [{ modules: ['crm'] }, /unknown module 'crm'/],
    [{ modules: ['marketing'] }, /requires 'customer'/],
    [{ basePath: '/applications/' }, /basePath/],
    [{ basePath: 'applications' }, /basePath/],
    [{ containerPrefix: 'CX' }, /containerPrefix/]
  ])('rejects invalid options %j', async (options, message) => {
    await expect(host(options).mount()).rejects.toThrow(message);
  });

  test('rejects missing host pieces and an uninitialised registry', async () => {
    const registry = createMockRegistry();
    const app = express();
    await expect(customers.mount(null, registry.services.eventEmitter, registry)).rejects.toThrow(/Express app/);
    await expect(customers.mount(app, null, registry)).rejects.toThrow(/EventEmitter/);
    await expect(customers.mount(app, registry.services.eventEmitter, {})).rejects.toThrow(/ServiceRegistry/);
    await expect(customers.mount(app, registry.services.eventEmitter, { ...registry, initialized: false })).rejects.toThrow(/initialize/);
  });

  test('normaliseOptions orders modules customer-first', () => {
    expect(customers.normaliseOptions({ modules: ['support', 'customer'] }).modules).toEqual(['customer', 'support']);
  });

  test('exports the shared building blocks', () => {
    expect(typeof customers.schema.defineSchema).toBe('function');
    expect(typeof customers.repository.BaseRepository).toBe('function');
    expect(typeof customers.http.parseListQuery).toBe('function');
    expect(customers.rbac.PERMISSIONS).toContain('pii:read');
    expect(customers.context.systemContext().can('x:y')).toBe(true);
  });
});
