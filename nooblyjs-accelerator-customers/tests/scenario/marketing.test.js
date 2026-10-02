'use strict';

/**
 * Roadmap Phase 2 exit criteria:
 *  - PRD §8 scenario 2 (marketer sends a newsletter) and scenario 3
 *    (one-click unsubscribe) end to end over HTTP with the console adapter;
 *  - a property-based test: no marketing send ever reaches an opted-out or
 *    suppressed recipient.
 */

const crypto = require('crypto');
const request = require('supertest');
const { mountMarketing } = require('../helpers/marketing');
const { prng } = require('../../src/customer/seed');

describe('scenario 2: a marketer sends a newsletter', () => {
  let env;
  afterEach(() => env.cx.shutdown());

  test('segment → campaign → template → test send → send; non-consenting members are recorded; report shows engagement', async () => {
    env = await mountMarketing({ webhookSecret: 'whsec' });
    const C = '/applications/customer/api/v1';
    const admin = (p) => request(env.app).post(`${C}${p}`).set('x-role', 'admin');
    const marketer = env.asM('marketer');

    // 20 active ZA customers, 19 opted in to email; 3 GB customers; 1 inactive ZA customer
    const za = [];
    for (let i = 0; i < 20; i++) {
      const res = await admin('/customers').send({
        name: { given: `Za${i}`, family: 'Customer' }, email: `za${i}@example.com`,
        addresses: [{ line1: `${i} Long St`, countryCode: 'ZA' }],
        consents: i === 0 ? [] : [{ purpose: 'marketing', channel: 'email', status: 'opt_in' }]
      });
      za.push(res.body);
    }
    for (let i = 0; i < 3; i++) {
      await admin('/customers').send({ name: `Gb ${i}`, email: `gb${i}@example.com`, addresses: [{ line1: 'x', countryCode: 'GB' }], consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in' }] });
    }
    const inactive = await admin('/customers').send({ name: 'Old', email: 'old@example.com', addresses: [{ line1: 'x', countryCode: 'ZA' }], consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in' }] });
    await admin(`/customers/${inactive.body.id}:status`).send({ status: 'inactive' });

    // the marketer builds the send
    const topic = await marketer.post('/topics').send({ key: 'newsletter', name: 'Newsletter' });
    expect(topic.status).toBe(201);
    const tpl = await marketer.post('/templates').send({
      key: 'za-newsletter', name: 'ZA newsletter', channel: 'email',
      locales: [{ locale: 'en', subject: 'Hello {{customer.givenName}}', bodyHtml: '<p>News <a href="https://example.com/news">Read</a> <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>' }]
    });
    expect(tpl.status).toBe(201);
    expect((await marketer.post(`/templates/${tpl.body.id}:approve`)).body.status).toBe('approved');
    const preview = await marketer.post(`/templates/${tpl.body.id}:preview`).send({});
    expect(preview.body.subject).toBe('Hello Ada');
    const campaign = await marketer.post('/campaigns').send({ name: 'ZA newsletter', topicId: 'newsletter', utm: { source: 'newsletter', medium: 'email' } });
    const audience = { rule: { filters: [{ field: 'status', op: 'eq', value: 'active' }, { field: 'countryCode', op: 'eq', value: 'ZA' }] } };
    expect((await marketer.post('/messages:preview-audience').send({ audience })).body.count).toBe(20);
    const message = await marketer.post('/messages').send({ campaignId: campaign.body.id, templateId: tpl.body.id, name: 'October', channel: 'email', audience });
    expect(message.status).toBe(201);

    const test = await marketer.post(`/messages/${message.body.id}:test-send`).send({ to: 'qa@example.com' });
    // marketers have no pii:read, so the address comes back masked
    expect(test.body).toMatchObject({ status: 'sent', to: 'q***@example.com' });

    const scheduled = await marketer.post(`/messages/${message.body.id}:schedule`);
    expect(scheduled.status).toBe(200);
    await env.mk.drain();
    await env.mk.tick();

    let stats = (await marketer.get(`/messages/${message.body.id}/stats`)).body;
    expect(stats).toMatchObject({ total: 20, sent: 19, byStatus: { sent: 19, skipped: 1 }, bySkipReason: { no_consent: 1 }, pending: 0 });
    const skipped = (await marketer.get(`/communications?filter[origin.messageId]=${message.body.id}&filter[status]=skipped`)).body.items;
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ customerId: za[0].id, skipReason: 'no_consent' });
    expect((await marketer.get(`/messages/${message.body.id}`)).body.status).toBe('sent');

    // provider webhooks and opens/clicks arrive
    const sent = (await marketer.get(`/communications?filter[origin.messageId]=${message.body.id}&filter[status]=sent&limit=200`)).body.items;
    const events = sent.slice(0, 15).map((c) => ({ providerMessageId: c.providerMessageId, type: 'delivered' }));
    const raw = JSON.stringify({ events });
    const hook = await request(env.app).post('/applications/marketing/p/webhooks/console').set('Content-Type', 'application/json')
      .set('X-CX-Signature', `sha256=${crypto.createHmac('sha256', 'whsec').update(raw).digest('hex')}`).send(raw);
    expect(hook.body.processed).toBe(15);
    for (const out of env.outbox().filter((o) => o.to !== 'qa@example.com').slice(0, 5)) {
      await request(env.app).get(env.local(out.html.match(/src="([^"]+\/p\/o\/[^"]+)"/)[1])).set('User-Agent', 'Mozilla/5.0 (iPhone)');
    }
    const click = env.outbox().find((o) => o.to === 'za1@example.com').html.match(/href="([^"]+\/p\/c\/[^"]+)"/)[1];
    expect((await request(env.app).get(env.local(click))).headers.location).toBe('https://example.com/news?utm_source=newsletter&utm_medium=email');

    stats = (await marketer.get(`/messages/${message.body.id}/stats`)).body;
    // za1 both opened and clicked: 5 unique opens
    expect(stats).toMatchObject({ delivered: 15, opened: 5, clicked: 1 });
    expect(stats.openRate).toBeCloseTo((5 / 19) * 100, 1);
    // the report counts the test send separately: it is origin "test"
    expect((await marketer.get(`/communications?filter[origin.type]=test`)).body.total).toBe(1);
  });
});

describe('scenario 3: one-click unsubscribe', () => {
  let env;
  afterEach(() => env.cx.shutdown());

  test('RFC 8058 POST writes an opt-out with evidence and a suppression; the next send skips them', async () => {
    env = await mountMarketing();
    const c = await env.customer({ given: 'Thabo' });
    await env.m.repos.topic.create({ key: 'offers', name: 'Offers' }, env.sys);
    const first = await env.message({ topicId: 'offers', audience: { customerIds: [c.id] } });
    await env.m.messages.schedule(first.id, env.sys);
    await env.mk.drain();
    const mail = env.outbox()[0];
    const url = mail.headers['List-Unsubscribe'].slice(1, -1);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const res = await request(env.app).post(env.local(url)).type('form').set('User-Agent', 'Gmail-OneClick/1.0').send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);

    const ledger = await env.cx.customer.services.consents.history(c.id, env.sys);
    expect(ledger[0]).toMatchObject({ status: 'opt_out', purpose: 'marketing', channel: 'email', topicId: 'offers', source: 'unsubscribe_link' });
    expect(ledger[0].evidence).toMatchObject({ userAgent: 'Gmail-OneClick/1.0', communicationId: expect.any(String) });
    expect(ledger[0].evidence.ip).toBeDefined();
    expect(await env.m.suppressions.check({ channel: 'email', value: c.emails[0].address, topicId: 'offers', purpose: 'marketing' }, env.sys)).toMatchObject({ scope: 'topic', reason: 'unsubscribe' });

    // next send on the same topic: skipped; other topics still allowed by consent
    const next = await env.message({ topicId: 'offers', audience: { customerIds: [c.id] } });
    await env.m.messages.schedule(next.id, env.sys);
    await env.mk.drain();
    const [comm] = await env.m.repos.communication.findByIndex('message', next.id, env.sys);
    expect(comm.status).toBe('suppressed');
    expect(env.outbox()).toHaveLength(1);
    expect(await env.cx.customer.canContact(c.id, { purpose: 'marketing', channel: 'email', topicId: 'news' })).toMatchObject({ allowed: true });
  });
});

describe('property: no marketing send to opted-out or suppressed recipients', () => {
  let env;
  afterEach(() => env.cx.shutdown());

  test.each([1, 2, 3])('random population and actions (seed %i)', async (seed) => {
    env = await mountMarketing();
    const rand = prng(seed * 7919);
    const pick = (l) => l[Math.floor(rand() * l.length)];
    const sys = env.sys;
    await env.m.repos.topic.create({ key: 'news', name: 'News' }, sys);
    const people = [];
    for (let i = 0; i < 40; i++) {
      const consents = [];
      const n = Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        consents.push({
          purpose: 'marketing', channel: pick(['email', 'any', 'sms']), topicId: rand() < 0.3 ? 'news' : undefined,
          status: pick(['opt_in', 'opt_in', 'opt_out', 'pending']), capturedAt: new Date(Date.now() - (100 - i - k * 3) * 3600000).toISOString()
        });
      }
      const c = await env.cx.customer.create({ name: `P${i}`, email: `p${i}@example.com`, consents });
      if (rand() < 0.15) await env.m.suppressions.add({ scope: pick(['global', 'channel', 'topic']), channel: 'email', topicId: 'news', value: `p${i}@example.com`, reason: pick(['unsubscribe', 'hard_bounce', 'manual']) }, sys);
      if (rand() < 0.1) await env.cx.customer.setStatus(c.id, 'blocked');
      people.push(c);
    }
    for (let round = 0; round < 3; round++) {
      const msg = await env.message({ topicId: rand() < 0.5 ? 'news' : undefined, respectFrequencyCap: false });
      await env.m.messages.schedule(msg.id, sys);
      await env.mk.drain();
      // some recipients unsubscribe between rounds
      for (const out of env.outbox().slice(-5)) {
        if (rand() < 0.5) await request(env.app).post(env.local(out.headers['List-Unsubscribe'].slice(1, -1))).type('form').send('List-Unsubscribe=One-Click');
      }
    }
    // every marketing send must have been allowed at the moment it was made
    const comms = await env.m.repos.communication.list({ limit: 10000 }, sys);
    for (const comm of comms.items.filter((c) => c.status === 'sent' && c.purpose === 'marketing')) {
      const sentAt = new Date(comm.sentAt);
      const decision = await env.cx.customer.services.consents.canContact(comm.customerId, { purpose: 'marketing', channel: 'email', topicId: comm.topicId || undefined }, sys, { at: new Date(sentAt.getTime() - 1) });
      const customer = await env.cx.customer.get(comm.customerId);
      if (customer.status !== 'blocked') expect(decision.allowed).toBe(true);
      const suppressions = (await env.m.repos.suppression.findByIndex('value', comm.to, sys)).filter((s) => new Date(s.createdAt) < sentAt);
      const blocking = suppressions.filter((s) => s.scope !== 'topic' || s.topicId === comm.topicId);
      expect(blocking).toEqual([]);
      expect(customer.status === 'blocked' && new Date(customer.updatedAt) < sentAt).toBe(false);
    }
    expect(comms.items.filter((c) => c.status === 'sent').length).toBeGreaterThan(0);
  }, 30000);
});
