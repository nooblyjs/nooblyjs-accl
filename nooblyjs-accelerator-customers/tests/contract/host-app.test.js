'use strict';

/**
 * Phase 0 exit criteria against the real nooblyjs-core registry:
 * test/app/index.js boots, the health endpoints answer, and mount() +
 * shutdown() leave no open handles (Jest runs with detectOpenHandles).
 */

const request = require('supertest');
const serviceRegistry = require('nooblyjs-core');
const { createHostApp } = require('../../test/app');

describe('demo host on nooblyjs-core', () => {
  let host;

  beforeAll(async () => {
    process.env.CX_LOG_PROVIDER = 'memory';
    host = await createHostApp({ seed: false });
  });

  afterAll(async () => {
    await host.cx.shutdown();
    serviceRegistry.reset();
    delete process.env.CX_LOG_PROVIDER;
  });

  test.each(['customer', 'marketing', 'support'])('GET /applications/%s/api/v1/health is OK', async (m) => {
    const res = await request(host.app).get(`/applications/${m}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', module: m, checks: { dataService: 'ok' } });
  });

  test('the root redirects to the customer UI', async () => {
    const res = await request(host.app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/applications/customer/');
  });

  test('domain events reach core notifying under cx.{module}', async () => {
    const notifying = serviceRegistry.notifying('memory');
    const got = [];
    const handler = (m) => got.push(m);
    await notifying.subscribe('cx.customer', handler);
    host.cx.events.publish('customer.created', { module: 'customer', subject: { entity: 'customer', id: '1' } });
    await new Promise((r) => setImmediate(r));
    notifying.unsubscribe('cx.customer', handler);
    expect(got[0]).toMatchObject({ type: 'cx.customer.created' });
  });
});
