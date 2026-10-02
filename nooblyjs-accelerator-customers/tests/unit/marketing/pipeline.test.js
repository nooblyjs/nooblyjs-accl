'use strict';

const { mountMarketing } = require('../../helpers/marketing');
const { systemContext } = require('../../../src/shared/context');

let env;
let m;
let sys;

beforeEach(async () => {
  env = await mountMarketing();
  m = env.m;
  sys = env.sys;
});

afterEach(async () => {
  await env.cx.shutdown();
});

async function sendNow(message) {
  await m.messages.schedule(message.id, sys);
  await env.mk.drain();
  await env.mk.tick();
  return m.repos.message.get(message.id, sys);
}

const byCustomer = async (messageId) => {
  const comms = await m.repos.communication.findByIndex('message', messageId, sys);
  return Object.fromEntries(comms.map((c) => [c.customerId, c]));
};

describe('send pipeline policies', () => {
  test('consent: opted-in customers get the message, others are skipped with a reason', async () => {
    const yes = await env.customer({ optIn: true, given: 'Yes' });
    const no = await env.customer({ optIn: false });
    const none = await env.customer({ optIn: null });
    const msg = await env.message();
    const done = await sendNow(msg);
    expect(done.status).toBe('sent');
    const comms = await byCustomer(msg.id);
    expect(comms[yes.id]).toMatchObject({ status: 'sent', to: yes.emails[0].address, provider: 'console', templateRevision: 1 });
    expect(comms[yes.id].rendered.subject).toBe('Hi Yes');
    expect(comms[no.id]).toMatchObject({ status: 'skipped', skipReason: 'opted_out' });
    expect(comms[none.id]).toMatchObject({ status: 'skipped', skipReason: 'no_consent' });
    expect(env.outbox()).toHaveLength(1);
    const sent = env.outbox()[0];
    expect(sent.headers['List-Unsubscribe']).toMatch(/^<https:\/\/shop\.example\.com\/applications\/marketing\/p\/u\/.+>$/);
    expect(sent.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(sent.html).toMatch(/href="https:\/\/shop\.example\.com\/applications\/marketing\/p\/c\//);
    expect(sent.html).toContain('/p/o/');
    expect(sent.text).toMatch(/\/p\/c\//);
    const stats = await m.communications.stats(msg.id, sys);
    expect(stats).toMatchObject({ total: 3, sent: 1, bySkipReason: { opted_out: 1, no_consent: 1 }, pending: 0 });
  });

  test('suppression blocks marketing; unsubscribe-only suppressions do not block transactional', async () => {
    const a = await env.customer();
    const b = await env.customer();
    await m.suppressions.add({ scope: 'global', value: a.emails[0].address.toUpperCase(), reason: 'manual' }, sys);
    await m.suppressions.add({ scope: 'channel', channel: 'email', value: b.emails[0].address, reason: 'unsubscribe' }, sys);
    const msg = await env.message();
    await sendNow(msg);
    const comms = await byCustomer(msg.id);
    expect(comms[a.id]).toMatchObject({ status: 'suppressed', skipReason: 'suppressed' });
    expect(comms[b.id]).toMatchObject({ status: 'suppressed' });
    const tpl = await env.template({ key: 'receipt', category: 'transactional' });
    const toB = await env.mk.sendTransactional({ template: 'receipt', customerId: b.id });
    expect(toB.status).toBe('sent');
    const toA = await env.mk.sendTransactional({ template: tpl.id, customerId: a.id });
    expect(toA).toMatchObject({ status: 'suppressed' });
  });

  test('topic suppressions and expiry', async () => {
    await m.repos.topic.create({ key: 'news', name: 'News' }, sys);
    const c = await env.customer();
    await m.suppressions.add({ scope: 'topic', topicId: 'news', channel: 'email', value: c.emails[0].address, reason: 'unsubscribe' }, sys);
    expect(await m.suppressions.check({ channel: 'email', value: c.emails[0].address, topicId: 'news', purpose: 'marketing' }, sys)).not.toBeNull();
    expect(await m.suppressions.check({ channel: 'email', value: c.emails[0].address, topicId: 'other', purpose: 'marketing' }, sys)).toBeNull();
    expect(await m.suppressions.check({ channel: 'sms', value: c.emails[0].address, topicId: 'news', purpose: 'marketing' }, sys)).toBeNull();
    await m.suppressions.add({ scope: 'channel', channel: 'sms', value: '082 555 0000', reason: 'legal', expiresAt: new Date(Date.now() + 1000).toISOString() }, sys);
    expect(await m.suppressions.check({ channel: 'sms', value: '+27825550000', purpose: 'service' }, sys)).not.toBeNull();
    expect(await m.suppressions.check({ channel: 'sms', value: '+27825550000', purpose: 'service' }, sys, new Date(Date.now() + 5000))).toBeNull();
    expect(await m.suppressions.check({ channel: 'sms', value: 'garbage', purpose: 'service' }, sys)).toBeNull();
    expect(await m.suppressions.check({ channel: 'sms', value: '', purpose: 'service' }, sys)).toBeNull();
    const again = await m.suppressions.add({ scope: 'topic', topicId: 'news', channel: 'email', value: c.emails[0].address, reason: 'unsubscribe' }, sys);
    expect((await m.repos.suppression.list({}, sys)).total).toBe(2);
    await m.suppressions.remove(again.id, sys);
    expect((await m.repos.suppression.list({}, sys)).total).toBe(1);
    await expect(m.suppressions.add({ scope: 'channel', value: 'a@b.co', reason: 'manual' }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(m.suppressions.add({ scope: 'topic', channel: 'email', value: 'a@b.co', reason: 'manual' }, sys)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('frequency cap counts recent marketing sends', async () => {
    await env.cx.shutdown();
    env = await mountMarketing({ defaults: { frequencyCap: { count: 1, perDays: 7 } } });
    m = env.m;
    const c = await env.customer();
    const first = await env.message();
    await sendNow(first);
    const second = await env.message();
    await sendNow(second);
    expect((await byCustomer(second.id))[c.id]).toMatchObject({ status: 'skipped', skipReason: 'frequency_cap' });
    const third = await env.message({ respectFrequencyCap: false });
    await sendNow(third);
    expect((await byCustomer(third.id))[c.id].status).toBe('sent');
  });

  test('quiet hours defer in the customer time zone; the scheduler re-queues when due', async () => {
    await env.cx.shutdown();
    // a quiet window that always contains "now" in UTC
    const now = new Date();
    const hh = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    env = await mountMarketing({ defaults: { quietHours: { start: hh(new Date(now.getTime() - 3600000)), end: hh(new Date(now.getTime() + 3600000)) } } });
    m = env.m;
    const c = await env.customer({ timezone: 'UTC' });
    const msg = await env.message();
    await m.messages.schedule(msg.id, sys);
    await env.mk.drain();
    const comm = (await byCustomer(msg.id))[c.id];
    expect(comm).toMatchObject({ status: 'deferred', deferReason: 'quiet_hours', attempts: 0 });
    expect(new Date(comm.deferUntil).getTime()).toBeGreaterThan(Date.now() + 50 * 60000);
    const tick = await env.mk.tick();
    expect(tick.requeued).toBe(0);
    expect((await m.repos.message.get(msg.id, sys)).status).toBe('sending');
    const later = await env.mk.tick(new Date(Date.now() + 2 * 3600000));
    expect(later.requeued).toBe(1);
    const noQuiet = await env.message({ respectQuietHours: false });
    await sendNow(noQuiet);
    expect((await byCustomer(noQuiet.id))[c.id].status).toBe('sent');
    expect(env.mk.services.dispatcher.quietHoursEnd_({ timezone: 'Not/AZone' })).toBeNull();
    expect(env.mk.services.dispatcher.quietHoursEnd_({ timezone: 'UTC' }, new Date(now.getTime() + 3 * 3600000))).toBeNull();
  });

  test('throttle defers beyond the per-minute limit', async () => {
    for (let i = 0; i < 3; i++) await env.customer();
    const msg = await env.message({ throttle: { perMinute: 2 } });
    await m.messages.schedule(msg.id, sys);
    await env.mk.drain();
    const comms = Object.values(await byCustomer(msg.id));
    expect(comms.filter((c) => c.status === 'sent')).toHaveLength(2);
    expect(comms.filter((c) => c.status === 'deferred' && c.deferReason === 'throttled')).toHaveLength(1);
  });

  test('provider failures retry, then fail with a sanitised error', async () => {
    await env.cx.shutdown();
    const { ConsoleAdapter } = require('../../../src/marketing/channels');
    const flaky = new ConsoleAdapter({ fail: () => true });
    env = await mountMarketing({ channels: { email: flaky }, dispatch: { maxAttempts: 2, retryDelayMs: 1 } });
    m = env.m;
    const c = await env.customer();
    const msg = await env.message();
    await m.messages.schedule(msg.id, sys);
    await env.mk.drain();
    let comm = (await byCustomer(msg.id))[c.id];
    expect(comm).toMatchObject({ status: 'deferred', deferReason: 'retry', attempts: 1, error: 'simulated_failure' });
    await new Promise((r) => setTimeout(r, 5));
    await env.mk.tick();
    await env.mk.drain();
    comm = (await byCustomer(msg.id))[c.id];
    expect(comm).toMatchObject({ status: 'failed', attempts: 2, error: 'simulated_failure' });
    await env.mk.tick();
    expect((await m.repos.message.get(msg.id, sys)).status).toBe('sent');
  });

  test('recipient problems: missing address, blocked, erased, missing customer, missing template', async () => {
    const noEmail = await env.cx.customer.create({ name: 'No Email', consents: [{ purpose: 'marketing', channel: 'any', status: 'opt_in' }] });
    const bounced = await env.customer();
    await env.cx.customer.services.repos.email.update(bounced.emails[0].id, { deliverability: 'hard_bounce' }, sys);
    const blocked = await env.customer();
    await env.cx.customer.setStatus(blocked.id, 'blocked');
    const erased = await env.customer();
    await env.cx.customer.services.repos.customer.update(erased.id, {}, sys, { system: { status: 'erased' } });
    const msg = await env.message({ audience: { customerIds: [noEmail.id, bounced.id, blocked.id, erased.id] } });
    await sendNow(msg);
    const comms = await byCustomer(msg.id);
    expect(comms[noEmail.id].skipReason).toBe('invalid_address');
    expect(comms[bounced.id].skipReason).toBe('invalid_address');
    expect(comms[blocked.id].skipReason).toBe('customer_blocked');
    expect(comms[erased.id].skipReason).toBe('customer_erased');

    const gone = await env.customer();
    const { communication } = await m.communications.create({ customerId: gone.id, channel: 'email', purpose: 'transactional', origin: { type: 'transactional' }, templateId: 'missing' }, sys, { enqueue: false });
    expect((await m.dispatcher.process(communication.id, 'default')).skipReason).toBe('render_failed');
    await env.cx.customer.remove(gone.id);
    const second = await m.communications.create({ customerId: gone.id, channel: 'email', purpose: 'transactional', origin: { type: 'transactional' }, templateId: 'x' }, sys, { enqueue: false });
    expect((await m.dispatcher.process(second.communication.id, 'default')).skipReason).toBe('customer_missing');
    expect(await m.dispatcher.process('nope', 'default')).toBeNull();
  });

  test('sms: picks a mobile with SMS capability and renders smsText', async () => {
    const c = await env.cx.customer.create({
      name: 'Sam', phones: [{ raw: '021 555 0100', type: 'home' }, { raw: '082 555 0101', type: 'mobile' }],
      consents: [{ purpose: 'marketing', channel: 'sms', status: 'opt_in' }]
    });
    const noSms = await env.cx.customer.create({ name: 'Nos', phones: [{ raw: '082 555 0102', capabilities: { sms: false } }], consents: [{ purpose: 'marketing', channel: 'sms', status: 'opt_in' }] });
    const t = await m.templates.create({ key: 'sms-1', name: 'SMS', channel: 'sms', locales: [{ locale: 'en', smsText: 'Hi {{customer.givenName}} https://example.com/x' }] }, sys);
    await m.templates.approve(t.id, sys);
    const msg = await env.message({ channel: 'sms', templateId: t.id, audience: { customerIds: [c.id, noSms.id] } });
    await sendNow(msg);
    const comms = await byCustomer(msg.id);
    expect(comms[c.id]).toMatchObject({ status: 'sent', to: '+27825550101' });
    expect(comms[c.id].rendered.bodyText).toMatch(/^Hi  https:\/\/shop\.example\.com\/applications\/marketing\/p\/c\//);
    expect(comms[noSms.id].skipReason).toBe('invalid_address');
    expect(env.mk.channels.sms.outbox).toHaveLength(1);
  });

  test('a channel without an adapter fails the communication', async () => {
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] } });
    delete m.dispatcher.channels.email;
    await sendNow(msg);
    expect((await byCustomer(msg.id))[c.id]).toMatchObject({ status: 'failed', error: 'no_adapter_for_email' });
  });

  test('a communication is never processed twice', async () => {
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] } });
    await m.messages.schedule(msg.id, sys);
    const comm = Object.values(await byCustomer(msg.id))[0];
    const results = await Promise.all([m.dispatcher.process(comm.id, 'default'), m.dispatcher.process(comm.id, 'default'), env.mk.drain()]);
    expect(results.filter((r) => r && r.status === 'sent')).toHaveLength(1);
    expect(env.outbox()).toHaveLength(1);
    expect(await m.dispatcher.process(comm.id, 'default')).toBeNull();
  });

  test('render errors are recorded as skips', async () => {
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] } });
    jest.spyOn(m.templates, 'renderParts').mockImplementationOnce(() => { throw new Error('boom'); });
    await sendNow(msg);
    expect((await byCustomer(msg.id))[c.id]).toMatchObject({ status: 'skipped', skipReason: 'render_failed' });
  });

  test('unexpected pipeline errors retry', async () => {
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] } });
    jest.spyOn(m.suppressions, 'check').mockRejectedValueOnce(new Error('db down'));
    await m.messages.schedule(msg.id, sys);
    await env.mk.drain();
    expect((await byCustomer(msg.id))[c.id]).toMatchObject({ status: 'deferred', deferReason: 'retry', error: 'pipeline_error' });
  });
});

describe('message lifecycle', () => {
  test('validation on create and schedule', async () => {
    const t = await env.template();
    const sms = await m.templates.create({ key: 'sms-x', name: 'S', channel: 'sms', locales: [{ locale: 'en', smsText: 'x' }] }, sys);
    const campaign = await m.campaigns.create({ name: 'C' }, sys);
    const base = { campaignId: campaign.id, templateId: t.id, name: 'M', channel: 'email', audience: { customerIds: ['x'] } };
    await expect(m.messages.create({ ...base, templateId: sms.id }, sys)).rejects.toThrow(/channel does not match|Template is for sms/);
    await expect(m.messages.create({ ...base, campaignId: 'missing' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(m.messages.create({ ...base, topicId: 'nope' }, sys)).rejects.toThrow(/Unknown topic/);
    await expect(m.messages.create({ ...base, audience: { rule: { filters: [{ field: 'nope', value: 1 }] } } }, sys)).rejects.toThrow(/Unknown audience field/);
    await expect(m.messages.create({ ...base, audience: { rule: { filters: [{ value: 1 }] } } }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(m.messages.create({ ...base, schedule: { type: 'recurring', cron: 'nope' } }, sys)).rejects.toThrow(/cron/);
    await expect(m.messages.create({ ...base, schedule: { type: 'at' } }, sys)).rejects.toThrow(/schedule.at/);
    const draftTpl = await m.templates.create({ key: 'draft-only', name: 'D', channel: 'email', locales: [{ locale: 'en', subject: 's', bodyText: 'b' }] }, sys);
    const notApproved = await m.messages.create({ ...base, templateId: draftTpl.id }, sys);
    await expect(m.messages.schedule(notApproved.id, sys)).rejects.toThrow(/approved/);
    const empty = await m.messages.create({ ...base, audience: {} }, sys);
    await expect(m.messages.schedule(empty.id, sys)).rejects.toThrow(/audience is empty/);
    const past = await m.messages.create({ ...base, schedule: { type: 'at', at: new Date(Date.now() - 3600000).toISOString() } }, sys);
    await expect(m.messages.schedule(past.id, sys)).rejects.toThrow(/in the past/);
    await m.templates.retire(t.id, sys);
    await expect(m.messages.create(base, sys)).rejects.toThrow(/retired/);
  });

  test('scheduled at a time: starts on the tick, campaign starts running', async () => {
    const c = await env.customer();
    const at = new Date(Date.now() + 3600000).toISOString();
    const msg = await env.message({ audience: { customerIds: [c.id] }, schedule: { type: 'at', at } });
    const scheduled = await m.messages.schedule(msg.id, sys);
    expect(scheduled).toMatchObject({ status: 'scheduled', nextRunAt: at });
    expect((await m.repos.campaign.get(msg.campaignId, sys)).status).toBe('running');
    expect((await env.mk.tick()).started).toBe(0);
    expect((await env.mk.tick(new Date(Date.now() + 2 * 3600000))).started).toBe(1);
    await env.mk.drain();
    await env.mk.tick();
    expect((await m.repos.message.get(msg.id, sys)).status).toBe('sent');
    await expect(m.messages.update(msg.id, { name: 'x' }, sys)).rejects.toMatchObject({ statusCode: 409 });
    await expect(m.messages.schedule(msg.id, sys)).rejects.toMatchObject({ statusCode: 409 });
    await expect(m.messages.remove(msg.id, sys)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('recurring messages run again with a new run id and re-send', async () => {
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] }, schedule: { type: 'recurring', cron: '0 9 * * *' }, respectFrequencyCap: false });
    const scheduled = await m.messages.schedule(msg.id, sys);
    expect(scheduled.status).toBe('scheduled');
    const next = new Date(scheduled.nextRunAt);
    expect(next.getMinutes()).toBe(0);
    await env.mk.tick(new Date(next.getTime() + 1000));
    await env.mk.drain();
    await env.mk.tick(new Date(next.getTime() + 2000));
    const afterFirst = await m.repos.message.get(msg.id, sys);
    expect(afterFirst).toMatchObject({ status: 'scheduled', runCount: 1 });
    expect(new Date(afterFirst.nextRunAt).getTime()).toBeGreaterThan(next.getTime());
    await env.mk.tick(new Date(new Date(afterFirst.nextRunAt).getTime() + 1000));
    await env.mk.drain();
    expect(Object.keys(await m.repos.communication.findByIndex('message', msg.id, sys))).toHaveLength(2);
    expect(env.outbox()).toHaveLength(2);
  });

  test('pause defers, resume continues, cancel skips the rest', async () => {
    const people = [];
    for (let i = 0; i < 3; i++) people.push(await env.customer());
    const msg = await env.message({ audience: { customerIds: people.map((p) => p.id) } });
    await m.messages.schedule(msg.id, sys);
    expect((await m.messages.pause(msg.id, sys)).status).toBe('paused');
    await env.mk.drain();
    let comms = Object.values(await byCustomer(msg.id));
    expect(comms.every((c) => c.status === 'deferred' && c.deferReason === 'message_paused')).toBe(true);
    await expect(m.messages.pause(msg.id, sys)).rejects.toMatchObject({ statusCode: 409 });
    expect((await m.messages.resume(msg.id, sys)).status).toBe('sending');
    await expect(m.messages.resume(msg.id, sys)).rejects.toMatchObject({ statusCode: 409 });
    expect((await m.messages.cancel(msg.id, sys)).status).toBe('cancelled');
    comms = Object.values(await byCustomer(msg.id));
    expect(comms.every((c) => c.status === 'skipped' && c.skipReason === 'cancelled')).toBe(true);
    await expect(m.messages.cancel(msg.id, sys)).rejects.toMatchObject({ statusCode: 409 });
    await m.messages.remove(msg.id, sys);
    expect(env.outbox()).toHaveLength(0);
  });

  test('paused draft can be edited and rescheduled; paused campaign defers sends', async () => {
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] }, schedule: { type: 'at', at: new Date(Date.now() + 3600000).toISOString() } });
    await m.messages.schedule(msg.id, sys);
    await m.messages.pause(msg.id, sys);
    expect((await m.messages.update(msg.id, { schedule: { type: 'immediate' } }, sys)).schedule.type).toBe('immediate');
    await m.campaigns.setStatus(msg.campaignId, 'paused', sys);
    expect((await m.messages.resume(msg.id, sys)).status).toBe('sending');
    await env.mk.drain();
    expect((await byCustomer(msg.id))[c.id]).toMatchObject({ status: 'deferred', deferReason: 'campaign_paused' });
    await m.campaigns.setStatus(msg.campaignId, 'running', sys);
    await env.mk.tick(new Date(Date.now() + 120000));
    await env.mk.drain();
    expect((await byCustomer(msg.id))[c.id].status).toBe('sent');
  });

  test('an empty audience completes at once; cancelled messages skip queued work', async () => {
    const msg = await env.message({ audience: { rule: { filters: [{ field: 'status', op: 'eq', value: 'blocked' }] } } });
    expect((await m.messages.schedule(msg.id, sys)).status).toBe('sent');
    const c = await env.customer();
    const other = await env.message({ audience: { customerIds: [c.id] } });
    await m.messages.schedule(other.id, sys);
    await m.repos.message.update(other.id, {}, sys, { system: { status: 'cancelled' } });
    await env.mk.drain();
    expect((await byCustomer(other.id))[c.id].skipReason).toBe('cancelled');
  });

  test('audience rules with computed fields, explicit ids and exclusions', async () => {
    const za = await env.customer({ addresses: [{ line1: '1 Long St', countryCode: 'ZA' }] });
    const gb = await env.customer({ addresses: [{ line1: '1 High St', countryCode: 'GB' }] });
    const lead = await env.customer({ lifecycleStage: 'lead' });
    const resolve = (audience) => m.messages.resolveAudience(audience, sys);
    expect(await resolve({ rule: { filters: [{ field: 'countryCode', value: 'ZA' }] } })).toEqual([za.id]);
    expect((await resolve({ rule: { filters: [{ field: 'countryCode', op: 'in', value: ['ZA', 'GB'] }] } })).sort()).toEqual([za.id, gb.id].sort());
    expect(await resolve({ rule: { filters: [{ field: 'lifecycleStage', value: 'lead' }] } })).toEqual([lead.id]);
    expect(await resolve({ rule: { filters: [{ field: 'email', op: 'contains', value: lead.emails[0].address.slice(0, 6) }] } })).toEqual([lead.id]);
    expect((await resolve({ customerIds: [za.id, 'missing'], rule: { filters: [{ field: 'lifecycleStage', value: 'lead' }] }, excludeCustomerIds: [lead.id] }))).toEqual([za.id]);
    const preview = await m.messages.previewAudience({ rule: { filters: [{ field: 'status', value: 'active' }] } }, sys);
    expect(preview.count).toBe(3);
    expect(preview.sample).toHaveLength(3);
  });

  test('test sends bypass policy and tracking', async () => {
    const c = await env.customer({ optIn: false });
    const msg = await env.message();
    const comm = await m.messages.testSend(msg.id, { customerId: c.id }, sys);
    expect(comm).toMatchObject({ status: 'sent', origin: { type: 'test' } });
    expect(env.outbox()[0].html).not.toContain('/p/c/');
    expect(env.outbox()[0].headers['List-Unsubscribe']).toBeUndefined();
    const raw = await m.messages.testSend(msg.id, { to: 'qa@example.com' }, sys);
    expect(raw).toMatchObject({ status: 'sent', to: 'qa@example.com' });
    await expect(m.messages.testSend(msg.id, {}, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(m.messages.testSend(msg.id, { customerId: 'missing' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    expect((await m.communications.stats(msg.id, sys)).total).toBe(0);
  });
});

describe('transactional sends', () => {
  test('renders data, is idempotent, ignores marketing consent', async () => {
    const c = await env.customer({ optIn: false });
    await env.template({
      key: 'order-confirmation', category: 'transactional',
      variables: [{ name: 'order.number', required: true }, { name: 'order.items' }],
      locales: [{ locale: 'en', subject: 'Order {{order.number}}', bodyHtml: '<p>{{#order.items}}{{name}};{{/order.items}}</p>' }, { locale: 'af', subject: 'Bestelling {{order.number}}', bodyHtml: '<p>Dankie</p>' }]
    });
    const events = [];
    env.cx.events.on('communication.sent', (e) => events.push(e));
    const input = { template: 'order-confirmation', customerId: c.id, data: { order: { number: 'ORD-1', items: [{ name: '<Hat>' }] } }, idempotencyKey: 'order-1' };
    const first = await env.mk.sendTransactional(input);
    expect(first).toMatchObject({ status: 'sent', purpose: 'transactional', origin: { type: 'transactional' }, locale: 'en' });
    expect(first.rendered.subject).toBe('Order ORD-1');
    expect(first.rendered.bodyHtml).toContain('&lt;Hat&gt;;');
    expect(env.outbox()[0].headers['List-Unsubscribe']).toBeUndefined();
    const again = await m.messages.sendTransactional(input, sys);
    expect(again.created).toBe(false);
    expect(again.communication.id).toBe(first.id);
    expect(env.outbox()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ customerId: c.id, purpose: 'transactional' });
    const af = await env.mk.sendTransactional({ ...input, idempotencyKey: 'order-1-af', locale: 'af-ZA' });
    expect(af.rendered.subject).toBe('Bestelling ORD-1');
    const toAddress = await env.mk.sendTransactional({ template: 'order-confirmation', to: 'guest@example.com', data: { order: { number: 'G1' } } });
    expect(toAddress).toMatchObject({ status: 'sent', to: 'guest@example.com' });
  });

  test('input validation', async () => {
    const c = await env.customer();
    await env.template({ key: 'needs-data', variables: [{ name: 'code', required: true }], locales: [{ locale: 'en', subject: '{{code}}', bodyText: 'x' }] });
    await expect(env.mk.sendTransactional({ template: 'needs-data', customerId: c.id })).rejects.toMatchObject({ statusCode: 422, details: [{ path: 'data.code', message: 'is required by the template' }] });
    await expect(env.mk.sendTransactional({ template: 'needs-data' })).rejects.toThrow(/customerId or to/);
    await expect(env.mk.sendTransactional({ template: 'needs-data', customerId: 'missing' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(env.mk.sendTransactional({ template: 'nope', customerId: c.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(env.mk.sendTransactional({ template: 'needs-data', customerId: c.id, purpose: 'marketing' })).rejects.toMatchObject({ statusCode: 422 });
    await expect(env.mk.sendTransactional({ template: 'needs-data', customerId: c.id, data: { code: 1 }, idempotencyKey: 5 })).rejects.toMatchObject({ statusCode: 422 });
    await expect(env.mk.sendTransactional(null)).rejects.toMatchObject({ statusCode: 400 });
    const draft = await m.templates.create({ key: 'not-approved', name: 'x', channel: 'email', locales: [{ locale: 'en', subject: 's', bodyText: 'b' }] }, sys);
    await expect(env.mk.sendTransactional({ template: draft.id, customerId: c.id })).rejects.toThrow(/approved/);
    const service = await env.mk.sendTransactional({ template: 'needs-data', customerId: c.id, data: { code: 'X' }, purpose: 'service' });
    expect(service.purpose).toBe('service');
  });
});

describe('templates and campaigns', () => {
  test('content checks, sanitising, revisions and approval', async () => {
    await expect(m.templates.create({ key: 'a', name: 'A', channel: 'email', locales: [{ locale: 'en', subject: '{{undeclared}}', bodyText: 'x' }] }, sys)).rejects.toThrow(/undeclared variable/);
    await expect(m.templates.create({ key: 'a', name: 'A', channel: 'email', locales: [{ locale: 'en', bodyText: 'x' }] }, sys)).rejects.toThrow(/subject is required/);
    await expect(m.templates.create({ key: 'a', name: 'A', channel: 'email', locales: [{ locale: 'en', subject: 's' }] }, sys)).rejects.toThrow(/bodyHtml or bodyText/);
    await expect(m.templates.create({ key: 'a', name: 'A', channel: 'sms', locales: [{ locale: 'en' }] }, sys)).rejects.toThrow(/smsText/);
    await expect(m.templates.create({ key: 'a', name: 'A', channel: 'email', locales: [] }, sys)).rejects.toThrow(/at least one locale/);
    await expect(m.templates.create({ key: 'a', name: 'A', channel: 'email', locales: [{ locale: 'en', subject: 's', bodyText: 'b' }, { locale: 'EN', subject: 's', bodyText: 'b' }] }, sys)).rejects.toThrow(/duplicated/);
    const t = await m.templates.create({ key: 'Promo', name: 'Promo', channel: 'email', locales: [{ locale: 'en', subject: 's', bodyHtml: '<p onclick="x()">Hi</p><script>bad()</script>' }] }, sys);
    expect(t).toMatchObject({ key: 'promo', status: 'draft', revision: 1 });
    expect(t.locales[0].bodyHtml).toBe('<p>Hi</p>');
    const approved = await m.templates.approve(t.id, sys);
    expect(approved).toMatchObject({ status: 'approved', approvedBy: 'system:test' });
    expect((await m.templates.approve(t.id, sys)).version).toBe(approved.version);
    const renamed = await m.templates.update(t.id, { name: 'Promo 2' }, sys);
    expect(renamed).toMatchObject({ status: 'approved', revision: 1 });
    const edited = await m.templates.update(t.id, { locales: [{ locale: 'en', subject: 'new', bodyText: 'b' }] }, sys);
    expect(edited).toMatchObject({ status: 'draft', revision: 2 });
    expect(edited.approvedBy).toBeUndefined();
    await expect(m.templates.update(t.id, { key: 'other' }, sys)).rejects.toThrow(/cannot change/);
    await expect(m.templates.create({ key: 'promo', name: 'Dup', channel: 'email', locales: [{ locale: 'en', subject: 's', bodyText: 'b' }] }, sys)).rejects.toMatchObject({ statusCode: 409 });
    await m.templates.retire(t.id, sys);
    await expect(m.templates.update(t.id, { name: 'x' }, sys)).rejects.toMatchObject({ statusCode: 409 });
    await expect(m.templates.approve(t.id, sys)).rejects.toMatchObject({ statusCode: 409 });
    expect((await m.templates.resolve('PROMO', sys)).id).toBe(t.id);
  });

  test('locale fallback', () => {
    const tpl = { defaultLocale: 'en', locales: [{ locale: 'en', subject: 'en' }, { locale: 'af-ZA', subject: 'af' }, { locale: 'de', subject: 'de' }] };
    expect(m.templates.localeFor(tpl, 'af-ZA').subject).toBe('af');
    expect(m.templates.localeFor(tpl, 'de-CH').subject).toBe('de');
    expect(m.templates.localeFor(tpl, 'fr').subject).toBe('en');
    expect(m.templates.localeFor({ locales: [{ locale: 'x', subject: 'x' }] }).subject).toBe('x');
    expect(() => m.templates.renderParts({ locales: [] }, {})).toThrow(/no content/);
  });

  test('campaign status transitions and validation', async () => {
    const events = [];
    env.cx.events.on('campaign.status.changed', (e) => events.push(e.data));
    const c = await m.campaigns.create({ name: 'Spring', startAt: '2026-01-01T00:00:00Z', endAt: '2026-02-01T00:00:00Z' }, sys);
    expect(c).toMatchObject({ status: 'draft', number: 'CMP-000001' });
    await expect(m.campaigns.create({ name: 'Bad', startAt: '2026-02-01T00:00:00Z', endAt: '2026-01-01T00:00:00Z' }, sys)).rejects.toThrow(/endAt/);
    await m.campaigns.setStatus(c.id, 'running', sys);
    expect((await m.campaigns.setStatus(c.id, 'running', sys)).status).toBe('running');
    await expect(m.campaigns.setStatus(c.id, 'archived', sys)).rejects.toMatchObject({ statusCode: 409 });
    await expect(m.campaigns.setStatus(c.id, 'bogus', sys)).rejects.toMatchObject({ statusCode: 422 });
    expect((await m.campaigns.update(c.id, { description: 'x' }, sys)).description).toBe('x');
    await m.campaigns.setStatus(c.id, 'completed', sys);
    await expect(m.campaigns.update(c.id, { name: 'x' }, sys)).rejects.toMatchObject({ statusCode: 409 });
    const msg = await env.message({ campaignId: c.id, templateId: (await env.template()).id, audience: { customerIds: ['x'] } });
    await expect(m.messages.schedule(msg.id, sys)).rejects.toThrow(/completed/);
    expect(events).toEqual([{ from: 'draft', to: 'running' }, { from: 'running', to: 'completed' }]);
  });
});

describe('engagement, webhooks and recovery', () => {
  async function sentTo(customer) {
    const msg = await env.message({ audience: { customerIds: [customer.id] } });
    await sendNow(msg);
    return (await byCustomer(msg.id))[customer.id];
  }

  test('opens, clicks and unsubscribe through the public routes', async () => {
    const c = await env.customer();
    const comm = await sentTo(c);
    const sent = env.outbox()[0];
    const pixel = sent.html.match(/src="([^"]+\/p\/o\/[^"]+)"/)[1];
    const link = sent.html.match(/href="([^"]+\/p\/c\/[^"]+)"/)[1];
    const unsub = sent.headers['List-Unsubscribe'].slice(1, -1);
    const request = require('supertest');
    const machine = await request(env.app).get(env.local(pixel)).set('User-Agent', 'Mozilla/5.0 (Windows) GoogleImageProxy');
    expect(machine.status).toBe(200);
    expect(machine.headers['content-type']).toBe('image/gif');
    expect((await m.repos.communication.get(comm.id, sys)).firstOpenedAt).toBeUndefined();
    await request(env.app).get(env.local(pixel)).set('User-Agent', 'Mozilla/5.0 (iPhone)');
    const click = await request(env.app).get(env.local(link));
    expect(click.status).toBe(302);
    expect(click.headers.location).toBe('https://example.com/sale');
    expect((await request(env.app).get(`${env.local(link)}x`)).status).toBe(404);
    expect((await request(env.app).get('/applications/marketing/p/o/garbage.gif')).status).toBe(200);
    const page = await request(env.app).get(env.local(unsub));
    expect(page.text).toContain('<form method="post">');
    const done = await request(env.app).post(env.local(unsub)).type('form').send({});
    expect(done.text).toContain('You are unsubscribed');
    expect((await request(env.app).post(env.local(unsub)).type('form').send({ 'List-Unsubscribe': 'One-Click' })).text).toBe('Unsubscribed');
    expect((await request(env.app).get('/applications/marketing/p/u/bad.token')).status).toBe(404);
    expect((await request(env.app).post('/applications/marketing/p/u/bad.token')).status).toBe(404);

    const after = await m.repos.communication.get(comm.id, sys);
    expect(after).toMatchObject({ openCount: 2, clickCount: 1 });
    expect(after.firstOpenedAt).toBeDefined();
    expect(after.unsubscribedAt).toBeDefined();
    const events = (await m.communications.engagement(comm.id, sys)).map((e) => e.type);
    expect(events).toEqual(['open', 'open', 'click', 'unsubscribe']);
    const consent = await env.cx.customer.canContact(c.id, { purpose: 'marketing', channel: 'email' });
    expect(consent).toMatchObject({ allowed: false, reason: 'opted_out' });
    const ledger = await env.cx.customer.services.consents.history(c.id, sys);
    expect(ledger[0]).toMatchObject({ status: 'opt_out', source: 'unsubscribe_link', evidence: { communicationId: comm.id } });
    expect(ledger.filter((r) => r.status === 'opt_out')).toHaveLength(1);
    expect(await m.suppressions.check({ channel: 'email', value: c.emails[0].address, purpose: 'marketing' }, sys)).toMatchObject({ reason: 'unsubscribe' });
    const stats = await m.communications.stats(comm.origin.messageId, sys);
    expect(stats).toMatchObject({ opened: 1, clicked: 1, unsubscribed: 1, openRate: 100 });
    const timeline = (await env.cx.customer.timeline(c.id)).items.map((e) => e.title);
    expect(timeline).toEqual(expect.arrayContaining(['Unsubscribed', 'Clicked a link', 'Email sent: Hi Ada']));
  });

  test('a click without an open counts as an open', async () => {
    const c = await env.customer();
    const comm = await sentTo(c);
    const link = env.outbox()[0].html.match(/href="([^"]+\/p\/c\/[^"]+)"/)[1];
    await require('supertest')(env.app).get(env.local(link));
    expect((await m.repos.communication.get(comm.id, sys)).firstOpenedAt).toBeDefined();
  });

  test('webhooks: signature, delivery, bounce → suppression and deliverability, complaint, failure', async () => {
    await env.cx.shutdown();
    env = await mountMarketing({ webhookSecret: 'whsec_test' });
    m = env.m;
    const crypto = require('crypto');
    const request = require('supertest');
    const post = (events, secret = 'whsec_test', tenant) => {
      const raw = JSON.stringify({ events });
      return request(env.app).post(`/applications/marketing/p/webhooks/console${tenant ? `?tenant=${tenant}` : ''}`)
        .set('Content-Type', 'application/json')
        .set('X-CX-Signature', `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`)
        .send(raw);
    };
    const a = await env.customer();
    const b = await env.customer();
    const commA = await sentTo(a);
    const commB = await sentTo(b);
    expect((await post([{ providerMessageId: commA.providerMessageId, type: 'delivered' }], 'wrong')).status).toBe(401);
    expect((await request(env.app).post('/applications/marketing/p/webhooks/nope').send({})).status).toBe(404);
    let res = await post([
      { providerMessageId: commA.providerMessageId, type: 'delivered' },
      { providerMessageId: commA.providerMessageId, type: 'open' },
      { providerMessageId: commA.providerMessageId, type: 'click', url: 'https://x.example' },
      { providerMessageId: 'unknown', type: 'delivered' }
    ]);
    expect(res.body).toEqual({ processed: 3 });
    expect(await m.repos.communication.get(commA.id, sys)).toMatchObject({ status: 'delivered', clickCount: 1 });
    res = await post([{ providerMessageId: commB.providerMessageId, type: 'bounce_soft' }, { providerMessageId: commB.providerMessageId, type: 'bounce_hard', error: '550' }]);
    expect(res.body.processed).toBe(2);
    expect(await m.repos.communication.get(commB.id, sys)).toMatchObject({ status: 'bounced', error: '550' });
    expect((await env.cx.customer.services.repos.email.get(b.emails[0].id, sys)).deliverability).toBe('hard_bounce');
    expect(await m.suppressions.check({ channel: 'email', value: b.emails[0].address, purpose: 'transactional' }, sys)).toMatchObject({ reason: 'hard_bounce' });
    await post([{ providerMessageId: commA.providerMessageId, type: 'complaint' }]);
    expect((await m.repos.communication.get(commA.id, sys)).status).toBe('delivered');
    expect((await env.cx.customer.services.repos.email.get(a.emails[0].id, sys)).deliverability).toBe('complaint');
    const c = await env.customer();
    const commC = await sentTo(c);
    await post([{ providerMessageId: commC.providerMessageId, type: 'failed', error: 'rejected' }]);
    expect(await m.repos.communication.get(commC.id, sys)).toMatchObject({ status: 'failed', error: 'rejected' });
    expect((await post([{ providerMessageId: commC.providerMessageId, type: 'delivered' }], 'whsec_test', 'other')).body.processed).toBe(0);
    expect(await m.communications.applyWebhookEvent('console', { providerMessageId: commC.providerMessageId, type: 'weird' }, 'default')).toBe(false);
    // the next send to the bounced address is blocked
    await sentTo(b);
    expect(env.outbox().filter((o) => o.to === b.emails[0].address)).toHaveLength(1);
  });

  test('restart recovery re-queues queued work and fails interrupted sends', async () => {
    const a = await env.customer();
    const b = await env.customer();
    const msg = await env.message({ audience: { customerIds: [a.id, b.id] } });
    await m.messages.schedule(msg.id, sys);
    const comms = await byCustomer(msg.id);
    await m.repos.communication.update(comms[b.id].id, {}, sys, { system: { status: 'sending' } });
    // what a new process does: empty queue, recover from storage
    await m.repos.communication.findByIndex('status', 'queued', sys);
    while (await env.services.queue.dequeue(m.communications.queueName)) { /* empty the queue */ }
    expect(await m.scheduler.recover('cx')).toBe(1);
    await env.mk.drain();
    const after = await byCustomer(msg.id);
    expect(after[a.id].status).toBe('sent');
    expect(after[b.id]).toMatchObject({ status: 'failed', error: 'interrupted' });
  });

  test('background loops start and stop with mount/shutdown', async () => {
    await env.cx.shutdown();
    env = await mountMarketing({ autoStart: true, dispatch: { pollMs: 5 }, scheduler: { tickMs: 20 } });
    m = env.m;
    const c = await env.customer();
    const msg = await env.message({ audience: { customerIds: [c.id] } });
    await m.messages.schedule(msg.id, sys);
    for (let i = 0; i < 100 && (await m.repos.message.get(msg.id, sys)).status !== 'sent'; i++) await new Promise((r) => setTimeout(r, 10));
    expect((await m.repos.message.get(msg.id, sys)).status).toBe('sent');
    m.dispatcher.start();
    m.scheduler.start();
  });

  test('scheduler tolerates failing runs', async () => {
    const msg = await env.message({ audience: { customerIds: ['x'] }, schedule: { type: 'at', at: new Date(Date.now() + 1000).toISOString() } });
    await m.messages.schedule(msg.id, sys);
    jest.spyOn(m.messages, 'run').mockRejectedValueOnce(new Error('boom'));
    expect((await env.mk.tick(new Date(Date.now() + 5000))).started).toBe(0);
    const [a, b] = [env.mk.tick(), env.mk.tick()];
    expect(a).toBe(b);
    await a;
  });

  test('tenants are isolated in the pipeline and tracking', async () => {
    await env.cx.shutdown();
    env = await mountMarketing({}, { tenancy: { enabled: true } });
    m = env.m;
    const acme = systemContext('t', { tenantId: 'acme' });
    const cust = await env.cx.customer.create({ name: 'Acme Person', email: 'p@acme.example', consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in' }] }, acme);
    const tpl = await m.templates.create({ key: 'k', name: 'n', channel: 'email', locales: [{ locale: 'en', subject: 's', bodyHtml: '<a href="https://acme.example">x</a>' }] }, acme);
    await m.templates.approve(tpl.id, acme);
    const camp = await m.campaigns.create({ name: 'c' }, acme);
    const msg = await m.messages.create({ campaignId: camp.id, templateId: tpl.id, name: 'm', channel: 'email', audience: { customerIds: [cust.id] } }, acme);
    await m.messages.schedule(msg.id, acme);
    await env.mk.drain();
    expect(env.outbox()).toHaveLength(1);
    const link = env.outbox()[0].html.match(/href="([^"]+\/p\/c\/[^"]+)"/)[1];
    expect((await require('supertest')(env.app).get(env.local(link))).headers.location).toBe('https://acme.example');
    expect((await m.repos.communication.list({}, sys)).total).toBe(0);
  });
});
