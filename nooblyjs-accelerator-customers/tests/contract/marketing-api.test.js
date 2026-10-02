'use strict';

const { mountMarketing } = require('../helpers/marketing');

let env;
let admin;

beforeEach(async () => {
  env = await mountMarketing();
  admin = env.asM('admin');
});

afterEach(() => env.cx.shutdown());

const emailTemplate = (key = 'news') => ({ key, name: 'News', channel: 'email', locales: [{ locale: 'en', subject: 'Hi {{customer.givenName}}', bodyHtml: '<p>Hi</p>' }] });

describe('marketing API', () => {
  test('templates: create, list/search/filter, get with ETag, patch, approve, preview, retire', async () => {
    const created = await admin.post('/templates').send(emailTemplate());
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await admin.get('/templates?q=news')).body.total).toBe(1);
    expect((await admin.get('/templates?filter[channel]=sms')).body.total).toBe(0);
    const got = await admin.get(`/templates/${id}`);
    expect(got.headers.etag).toBe('W/"1"');
    expect((await admin.patch(`/templates/${id}`).set('If-Match', 'W/"9"').send({ name: 'x' })).status).toBe(412);
    expect((await admin.patch(`/templates/${id}`).send({ name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await admin.post(`/templates/${id}:approve`)).body.status).toBe('approved');
    const preview = await admin.post(`/templates/${id}:preview`).send({});
    expect(preview.body).toMatchObject({ locale: 'en', subject: 'Hi Ada' });
    const c = await env.customer({ given: 'Grace' });
    expect((await admin.post(`/templates/${id}:preview`).send({ customerId: c.id })).body.subject).toBe('Hi Grace');
    expect((await env.asM('marketer').post(`/templates/${id}:preview`).send({ customerId: c.id })).body.subject).toBe('Hi G***');
    expect((await env.asM('readonly').post(`/templates/${id}:approve`)).status).toBe(403);
    expect((await env.asM('readonly').post(`/templates/${id}:preview`).send({})).status).toBe(200);
    expect((await admin.post(`/templates/${id}:retire`)).body.status).toBe('retired');
    expect((await admin.post('/templates/missing:preview').send({})).status).toBe(404);
    const invalid = await admin.post('/templates').send({ ...emailTemplate('bad'), locales: [{ locale: 'en', subject: '{{nope}}', bodyText: 'x' }] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details[0]).toMatchObject({ path: 'locales[0].subject' });
  });

  test('campaigns and messages: lifecycle over HTTP', async () => {
    const tpl = (await admin.post('/templates').send(emailTemplate())).body;
    await admin.post(`/templates/${tpl.id}:approve`);
    const campaign = (await admin.post('/campaigns').send({ name: 'Spring' })).body;
    expect((await admin.get('/campaigns?q=spring')).body.total).toBe(1);
    expect((await admin.get('/campaigns?filter[status]=draft')).body.total).toBe(1);
    expect((await admin.patch(`/campaigns/${campaign.id}`).send({ description: 'd' })).body.description).toBe('d');
    const c = await env.customer();
    const msg = await admin.post('/messages').send({ campaignId: campaign.id, templateId: tpl.id, name: 'M1', channel: 'email', audience: { customerIds: [c.id] } });
    expect(msg.status).toBe(201);
    expect((await admin.get(`/campaigns/${campaign.id}?expand=messages`)).body.messages).toHaveLength(1);
    expect((await admin.patch(`/messages/${msg.body.id}`).send({ name: 'M2' })).body.name).toBe('M2');
    expect((await admin.get('/messages?filter[campaignId]=' + campaign.id)).body.total).toBe(1);
    expect((await admin.post(`/messages/${msg.body.id}:schedule`)).body.status).toBe('sending');
    await env.mk.drain();
    await env.mk.tick();
    expect((await admin.get(`/messages/${msg.body.id}`)).body.status).toBe('sent');
    const stats = await admin.get(`/messages/${msg.body.id}/stats`);
    expect(stats.body).toMatchObject({ total: 1, sent: 1 });
    expect((await admin.get(`/messages/${msg.body.id}/stats?runId=nope`)).body.total).toBe(0);
    const comms = await admin.get(`/communications?filter[customerId]=${c.id}`);
    expect(comms.body.items[0]).toMatchObject({ status: 'sent', customerId: c.id });
    expect((await admin.get(`/communications/${comms.body.items[0].id}`)).body.id).toBe(comms.body.items[0].id);
    expect((await admin.get(`/communications/${comms.body.items[0].id}/events`)).body.items).toEqual([]);
    expect((await admin.post(`/campaigns/${campaign.id}:status`).send({ status: 'paused' })).body.status).toBe('paused');
    expect((await admin.post(`/campaigns/${campaign.id}:status`).send({})).status).toBe(400);

    const draft = (await admin.post('/messages').send({ campaignId: campaign.id, templateId: tpl.id, name: 'Draft', channel: 'email', audience: { customerIds: [c.id] }, schedule: { type: 'at', at: new Date(Date.now() + 3600000).toISOString() } })).body;
    expect((await admin.post(`/messages/${draft.id}:test-send`).send({ to: 'qa@example.com' })).status).toBe(201);
    expect((await admin.post(`/messages/${draft.id}:schedule`)).body.status).toBe('scheduled');
    expect((await admin.post(`/messages/${draft.id}:pause`)).body.status).toBe('paused');
    expect((await admin.post(`/messages/${draft.id}:resume`)).body.status).toBe('scheduled');
    expect((await admin.post(`/messages/${draft.id}:cancel`)).body.status).toBe('cancelled');
    expect((await admin.delete(`/messages/${draft.id}`)).status).toBe(204);
    expect((await admin.post('/messages:preview-audience').send({ audience: { customerIds: [c.id] } })).body.count).toBe(1);
    expect((await admin.post('/messages:preview-audience').send({})).body.count).toBe(0);
  });

  test('transactional over HTTP: 201 then 200 for the same key', async () => {
    const tpl = (await admin.post('/templates').send({ ...emailTemplate('receipt'), category: 'transactional' })).body;
    await admin.post(`/templates/${tpl.id}:approve`);
    const c = await env.customer({ optIn: false });
    const service = env.asM('service');
    const first = await service.post('/transactional').send({ template: 'receipt', customerId: c.id, idempotencyKey: 'k1' });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('sent');
    const second = await service.post('/transactional').send({ template: 'receipt', customerId: c.id, idempotencyKey: 'k1' });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect((await env.asM('readonly').post('/transactional').send({})).status).toBe(403);
  });

  test('suppressions, topics, channels, reference, OpenAPI', async () => {
    const s = await admin.post('/suppressions').send({ scope: 'global', value: 'Bad@Example.com', reason: 'manual' });
    expect(s.status).toBe(201);
    expect(s.body.value).toBe('bad@example.com');
    expect((await admin.get('/suppressions?q=bad')).body.total).toBe(1);
    expect((await env.asM('marketer').delete(`/suppressions/${s.body.id}`)).status).toBe(403);
    expect((await admin.delete(`/suppressions/${s.body.id}`)).status).toBe(204);
    expect((await admin.post('/suppressions').send({ scope: 'global', value: 'nonsense', reason: 'manual' })).status).toBe(422);

    const topic = await admin.post('/topics').send({ key: 'News', name: 'News' });
    expect(topic.body.key).toBe('news');
    expect((await admin.patch(`/topics/${topic.body.id}`).send({ name: 'Newsletter' })).body.name).toBe('Newsletter');
    expect((await admin.patch(`/topics/${topic.body.id}`).send({ key: 'x' })).status).toBe(400);
    expect((await admin.get('/topics')).body.total).toBe(1);
    expect((await admin.delete(`/topics/${topic.body.id}`)).status).toBe(204);

    expect((await admin.get('/channels')).body.items).toEqual([
      { channel: 'email', adapter: 'console', webhook: 'webhooks/console' },
      { channel: 'sms', adapter: 'console', webhook: 'webhooks/console' }
    ]);
    expect((await admin.get('/reference')).body.skipReasons).toContain('frequency_cap');
    const doc = (await admin.get('/openapi.json')).body;
    expect(doc.paths['/messages/{id}:schedule'].post).toBeDefined();
    expect(doc.paths['/transactional'].post).toBeDefined();
    expect(doc.components.schemas.Communication.properties.to['x-pii']).toBe(true);
  });

  test('permissions: readers cannot write, marketers cannot remove suppressions, no role is 401', async () => {
    expect((await env.asM('').get('/templates')).status).toBe(401);
    expect((await env.asM('agent').get('/templates')).status).toBe(403);
    expect((await env.asM('readonly').get('/templates')).status).toBe(200);
    expect((await env.asM('readonly').post('/templates').send(emailTemplate())).status).toBe(403);
    expect((await env.asM('readonly').post('/messages/x:schedule')).status).toBe(403);
    expect((await env.asM('marketer').post('/templates').send(emailTemplate())).status).toBe(201);
  });

  test('the module UI and shared assets are served', async () => {
    const request = require('supertest');
    expect((await request(env.app).get('/applications/marketing/')).text).toContain('Marketing · Customer Accelerator');
    expect((await request(env.app).get('/applications/_cx/css/styles.css')).status).toBe(200);
    expect((await request(env.app).get('/applications/_cx/js/ui.js')).status).toBe(200);
    expect((await request(env.app).get('/applications/marketing/p/nothing')).status).toBe(404);
  });
});

describe('marketing configuration', () => {
  test('requires a core queue and warns without tracking settings', async () => {
    await env.cx.shutdown();
    const { mountCustomer } = require('../helpers/customer');
    const plain = await mountCustomer({ modules: ['customer', 'marketing'], marketing: { autoStart: false } });
    const warnings = plain.services.logger.calls.filter((c) => c.level === 'warn').map((c) => c.message).join('\n');
    expect(warnings).toMatch(/signingSecret is not set/);
    expect(warnings).toMatch(/baseUrl is not set/);
    await plain.cx.shutdown();
    const express = require('express');
    const customers = require('../..');
    const { createServices, createMockRegistry } = require('../helpers/registry');
    const registry = createMockRegistry(createServices());
    delete registry.queue;
    await expect(customers.mount(express(), registry.services.eventEmitter, registry, { modules: ['customer', 'marketing'] })).rejects.toThrow(/queue/);
    env = await mountMarketing();
  });
});

describe('marketing seed data', () => {
  test('mount with seed creates topics, approved templates and a ready-to-send message', async () => {
    await env.cx.shutdown();
    env = await mountMarketing({}, { seed: { customers: 25, organizations: 2 } });
    const m = env.m;
    expect((await m.repos.topic.list({}, env.sys)).total).toBe(2);
    const templates = (await m.repos.template.list({}, env.sys)).items;
    expect(templates.map((t) => [t.key, t.status]).sort()).toEqual([['monthly-newsletter', 'approved'], ['order-confirmation', 'approved'], ['weekend-offer-sms', 'approved']]);
    const [message] = (await m.repos.message.list({}, env.sys)).items;
    await m.messages.schedule(message.id, env.sys);
    await env.mk.drain();
    await env.mk.tick();
    const stats = await m.communications.stats(message.id, env.sys);
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.pending).toBe(0);
    const [customer] = (await env.cx.customer.list({ limit: 1 })).items;
    const order = await env.mk.sendTransactional({ template: 'order-confirmation', customerId: customer.id, data: { order: { number: 'ORD-9', total: 'R 1', items: [{ name: 'Hat', quantity: 1 }] } } });
    expect(order.rendered.bodyHtml).toContain('1 × Hat');
    // seeding is skipped when templates exist
    const { seedMarketing } = require('../../src/marketing/seed');
    expect(await seedMarketing(m)).toEqual({ skipped: true, templates: 0 });
  });
});
