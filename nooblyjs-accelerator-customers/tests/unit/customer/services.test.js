'use strict';

const { mountCustomer, roleContext } = require('../../helpers/customer');
const { systemContext } = require('../../../src/shared/context');
const { seedCustomers, prng } = require('../../../src/customer/seed');

let env;
let svc;
let sys;

beforeEach(async () => {
  env = await mountCustomer({ customer: { defaultCountry: 'ZA' } });
  svc = env.svc;
  sys = env.sys;
});

afterEach(async () => {
  await env.cx.shutdown();
});

const newCustomer = (extra = {}) => svc.customers.create({ name: { given: 'Ada', family: 'Lovelace' }, ...extra }, sys);

describe('CustomerService', () => {
  test('create derives the full name, defaults status and lifecycle, and nests children', async () => {
    const events = [];
    env.cx.events.on('customer.created', (e) => events.push(e));
    const c = await newCustomer({
      email: 'ADA@example.com',
      phone: '082 123 4567',
      emails: [{ address: 'ada@work.example.com', type: 'work' }, 'ada@example.com'],
      addresses: [{ line1: '1 Main Road', countryCode: 'za', postalCode: '8001' }],
      identities: [{ namespace: 'Commerce', value: ' 123 ' }],
      consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in' }],
      language: 'en-za', timezone: 'Africa/Johannesburg', currency: 'zar'
    });
    expect(c).toMatchObject({
      number: 'CUS-000001', status: 'active', lifecycleStage: 'subscriber', type: 'individual',
      name: { given: 'Ada', family: 'Lovelace', full: 'Ada Lovelace' }, language: 'en-ZA', currency: 'ZAR'
    });
    expect(c.emails.map((e) => [e.address, e.isPrimary])).toEqual([['ada@example.com', true], ['ada@work.example.com', false]]);
    expect(c.phones[0]).toMatchObject({ e164: '+27821234567', countryCode: 'ZA', isPrimary: true });
    expect(c.addresses[0]).toMatchObject({ countryCode: 'ZA', isPrimary: true });
    expect(c.identities[0]).toMatchObject({ namespace: 'commerce', value: '123' });
    expect(c.consentState[0]).toMatchObject({ purpose: 'marketing', status: 'opt_in' });
    const stored = await svc.customers.get(c.id, sys);
    expect(stored.primaryEmailId).toBe(c.emails[0].id);
    expect(stored.primaryPhoneId).toBe(c.phones[0].id);
    expect(stored.primaryAddressId).toBe(c.addresses[0].id);
    expect(events).toHaveLength(1);
  });

  test('create validates names, nested items and organization references before writing', async () => {
    await expect(svc.customers.create({}, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(svc.customers.create({ name: {} }, sys)).rejects.toThrow(/needs a name/);
    await expect(svc.customers.create({ name: [] }, sys)).rejects.toThrow(/must be an object/);
    await expect(svc.customers.create(null, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(newCustomer({ emails: 'x' })).rejects.toThrow(/emails must be an array/);
    await expect(newCustomer({ emails: Array(21).fill('a@example.com') })).rejects.toThrow(/too many/);
    await expect(newCustomer({ emails: ['bad'] })).rejects.toMatchObject({ details: [expect.objectContaining({ path: 'emails[0].address' })] });
    await expect(newCustomer({ phones: [{ raw: 'abc' }] })).rejects.toMatchObject({ statusCode: 422 });
    await expect(newCustomer({ addresses: [null] })).rejects.toMatchObject({ details: [{ path: 'addresses[0]', message: 'must be an object' }] });
    await expect(newCustomer({ addresses: [{ countryCode: 'ZA' }] })).rejects.toMatchObject({ details: [expect.objectContaining({ path: 'addresses[0].line1' })] });
    await expect(newCustomer({ identities: [{ namespace: '1bad', value: 'x' }] })).rejects.toMatchObject({ details: [expect.objectContaining({ path: 'identities[0].namespace' })] });
    await expect(newCustomer({ consents: ['x'] })).rejects.toThrow(/consents\[0\] must be an object/);
    await expect(newCustomer({ consents: [{ purpose: 'nope' }] })).rejects.toMatchObject({ details: expect.arrayContaining([expect.objectContaining({ path: 'consents[0].purpose' })]) });
    await expect(newCustomer({ organizationId: 'missing' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(newCustomer({ timezone: 'Mars/Base' })).rejects.toMatchObject({ statusCode: 422 });
    expect(await svc.customers.repo.count(sys)).toBe(0);
  });

  test('create refuses an identity owned by someone else, and rolls back when a later write fails', async () => {
    const a = await newCustomer({ identities: [{ namespace: 'crm', value: '1' }] });
    await expect(newCustomer({ identities: [{ namespace: 'crm', value: '1' }] }))
      .rejects.toMatchObject({ statusCode: 409, existingCustomerId: a.id });
    jest.spyOn(svc.consents, 'record').mockRejectedValueOnce(new Error('boom'));
    await expect(newCustomer({ email: 'x@example.com', phone: '+27821234567', addresses: [{ line1: 'a', countryCode: 'ZA' }], identities: [{ namespace: 'crm', value: '2' }], consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in' }] }))
      .rejects.toThrow('boom');
    expect(await svc.customers.repo.count(sys)).toBe(1);
    expect(await svc.customers.lookup({ email: 'x@example.com' }, sys)).toEqual([]);
    expect(await svc.identities.resolve('crm', '2', sys)).toBeNull();
  });

  test('duplicate nested emails/phones are collapsed; a string name becomes full', async () => {
    const c = await svc.customers.create({ name: 'Grace Hopper', emails: ['g@example.com', 'G@example.com'], phones: ['+27821234567', '082 123 4567'] }, sys);
    expect(c.name).toEqual({ full: 'Grace Hopper' });
    expect(c.emails).toHaveLength(1);
    expect(c.phones).toHaveLength(1);
  });

  test('update re-derives the full name and normalises locale fields; rejects nested and status changes', async () => {
    const c = await newCustomer();
    const u = await svc.customers.update(c.id, { name: { given: 'Augusta', middle: 'Ada' }, currency: 'eur' }, sys);
    expect(u.name).toMatchObject({ given: 'Augusta', middle: 'Ada', full: 'Augusta Ada Lovelace' });
    expect(u.currency).toBe('EUR');
    const cleared = await svc.customers.update(c.id, { name: { middle: null } }, sys);
    expect(cleared.name.middle).toBeUndefined();
    expect(cleared.name.full).toBe('Augusta Lovelace');
    const explicit = await svc.customers.update(c.id, { name: { full: 'Countess of Lovelace' } }, sys);
    expect(explicit.name.full).toBe('Countess of Lovelace');
    await expect(svc.customers.update(c.id, { emails: [] }, sys)).rejects.toThrow(/use the customer's emails endpoint/);
    await expect(svc.customers.update(c.id, { status: 'blocked' }, sys)).rejects.toThrow(/:status/);
    await expect(svc.customers.update(c.id, [], sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(svc.customers.update(c.id, { lifecycleStage: 'customer' }, sys, { expectedVersion: 1 })).rejects.toMatchObject({ statusCode: 412 });
    await expect(svc.customers.update(c.id, { name: { given: null, family: null, full: null } }, sys)).rejects.toThrow(/needs a name/);
  });

  test('setStatus follows the transition table and emits an event', async () => {
    const c = await newCustomer();
    const events = [];
    env.cx.events.on('customer.status.changed', (e) => events.push(e.data));
    expect((await svc.customers.setStatus(c.id, 'blocked', sys, { reason: 'fraud' })).status).toBe('blocked');
    expect((await svc.customers.setStatus(c.id, 'blocked', sys)).status).toBe('blocked');
    expect((await svc.customers.setStatus(c.id, 'inactive', sys)).status).toBe('inactive');
    expect(events).toEqual([{ from: 'active', to: 'blocked', reason: 'fraud' }, { from: 'blocked', to: 'inactive', reason: null }]);
    await expect(svc.customers.setStatus(c.id, 'merged', sys)).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.customers.setStatus(c.id, 'gone', sys)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('remove soft-deletes the customer, contact points and identities', async () => {
    const c = await newCustomer({ email: 'a@example.com', identities: [{ namespace: 'crm', value: '9' }] });
    await svc.customers.remove(c.id, sys);
    await expect(svc.customers.get(c.id, sys)).rejects.toMatchObject({ statusCode: 404 });
    expect(await svc.customers.lookup({ email: 'a@example.com' }, sys)).toEqual([]);
    const again = await newCustomer({ identities: [{ namespace: 'crm', value: '9' }] });
    expect(again.identities).toHaveLength(1);
  });

  test('lookup by email, phone, identity and number', async () => {
    const c = await newCustomer({ email: 'ada@example.com', phone: '082 123 4567', identities: [{ namespace: 'loyalty', value: 'L1' }] });
    await env.svc.organizations.create({ name: 'Org' }, sys).then((o) => svc.contactPoints.email.add('organization', o.id, { address: 'ada@example.com' }, sys));
    const ids = async (p) => (await svc.customers.lookup(p, sys)).map((x) => x.id);
    expect(await ids({ email: ' ADA@example.com' })).toEqual([c.id]);
    expect(await ids({ phone: '+27 82 123 4567' })).toEqual([c.id]);
    expect(await ids({ identity: 'loyalty:L1' })).toEqual([c.id]);
    expect(await ids({ number: c.number })).toEqual([c.id]);
    expect(await ids({ identity: 'loyalty:none' })).toEqual([]);
    await expect(svc.customers.lookup({}, sys)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.customers.lookup({ identity: 'nocolon' }, sys)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('typeahead matches names, numbers, emails, phones and identities', async () => {
    const a = await newCustomer({ email: 'countess@example.com', phone: '+27821112222', identities: [{ namespace: 'crm', value: 'zx-991' }] });
    const b = await svc.customers.create({ name: { given: 'Charles', family: 'Babbage' } }, sys);
    const first = async (q) => (await svc.customers.typeahead(q, sys)).map((x) => x.id);
    expect(await first('lovelace')).toEqual([a.id]);
    expect(await first('babb')).toEqual([b.id]);
    expect(await first(b.number.toLowerCase())).toContain(b.id);
    expect(await first('countess@example.com')).toEqual([a.id]);
    expect(await first('countess')).toEqual([a.id]);
    expect(await first('082 111 2222')).toEqual([a.id]);
    expect(await first('zx-991')).toContain(a.id);
    expect(await first('a')).toEqual([]);
    expect(await first('@@nope')).toEqual([]);
    expect(await first('+99 1')).toEqual([]);
  });

  test('list supports q, filters and expand', async () => {
    await newCustomer({ email: 'ada@example.com' });
    await svc.customers.create({ name: { given: 'Charles', family: 'Babbage' }, lifecycleStage: 'customer' }, sys);
    const byQ = await svc.customers.list({ q: 'lovelace', expand: ['emails'] }, sys);
    expect(byQ.total).toBe(1);
    expect(byQ.items[0].emails[0].address).toBe('ada@example.com');
    expect((await svc.customers.list({ q: 'nobody' }, sys)).total).toBe(0);
    expect((await svc.customers.list({ filters: [{ field: 'lifecycleStage', op: 'eq', value: 'customer' }] }, sys)).total).toBe(1);
    await expect(svc.customers.list({ expand: ['bogus'] }, sys)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('get expands organization and notes; viewers see masked PII', async () => {
    const org = await svc.organizations.create({ name: 'Analytical Engines' }, sys);
    const c = await newCustomer({ organizationId: org.id, email: 'ada@example.com' });
    await svc.notes.add('customer', c.id, { body: 'Prefers email' }, sys);
    const full = await svc.customers.get(c.id, sys, { expand: ['organization', 'notes', 'emails'] });
    expect(full.organization.name).toBe('Analytical Engines');
    expect(full.notes[0].body).toBe('Prefers email');
    const agent = roleContext('agent');
    const masked = await svc.customers.get(c.id, agent, { expand: ['emails', 'notes'] });
    expect(masked.name.given).toBe('A***');
    expect(masked.emails[0].address).toBe('a***@example.com');
    expect(masked.notes[0].body).toBe('P***');
    expect((await svc.customers.get(c.id, roleContext('supervisor'))).name.given).toBe('Ada');
    const noOrg = await svc.customers.get((await newCustomer()).id, sys, { expand: ['organization'] });
    expect(noOrg.organization).toBeNull();
  });
});

describe('ContactPointService', () => {
  test('keeps one primary per kind and the party pointer in sync', async () => {
    const c = await newCustomer();
    const email = svc.contactPoints.email;
    const a = await email.add('customer', c.id, { address: 'a@example.com' }, sys);
    const b = await email.add('customer', c.id, { address: 'b@example.com', isPrimary: true }, sys);
    expect(a.isPrimary).toBe(true);
    expect(b.isPrimary).toBe(true);
    let list = await email.list('customer', c.id, sys);
    expect(list.map((e) => [e.address, e.isPrimary])).toEqual([['b@example.com', true], ['a@example.com', false]]);
    expect((await svc.customers.get(c.id, sys)).primaryEmailId).toBe(b.id);

    await email.update('customer', c.id, a.id, { isPrimary: true }, sys);
    expect((await svc.customers.get(c.id, sys)).primaryEmailId).toBe(a.id);
    await expect(email.update('customer', c.id, a.id, { isPrimary: false }, sys)).rejects.toMatchObject({ statusCode: 422 });

    await email.remove('customer', c.id, a.id, sys);
    list = await email.list('customer', c.id, sys);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: b.id, isPrimary: true });
    expect((await svc.customers.get(c.id, sys)).primaryEmailId).toBe(b.id);
    await email.remove('customer', c.id, b.id, sys);
    expect((await svc.customers.get(c.id, sys)).primaryEmailId).toBeUndefined();
  });

  test('rejects duplicates, foreign items and party moves', async () => {
    const c = await newCustomer();
    const other = await newCustomer();
    const phone = svc.contactPoints.phone;
    const p = await phone.add('customer', c.id, { raw: '082 123 4567' }, sys);
    await expect(phone.add('customer', c.id, { raw: '+27821234567' }, sys)).rejects.toMatchObject({ statusCode: 409 });
    const q = await phone.add('customer', c.id, { raw: '+27831234567' }, sys);
    await expect(phone.update('customer', c.id, q.id, { raw: '0821234567' }, sys)).rejects.toMatchObject({ statusCode: 409 });
    await expect(phone.get('customer', other.id, p.id, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(phone.update('customer', other.id, p.id, { type: 'work' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(phone.remove('customer', other.id, p.id, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(phone.update('customer', c.id, p.id, { partyId: other.id }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(phone.add('customer', 'missing', { raw: '+27821234567' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(phone.list('nope', c.id, sys)).rejects.toMatchObject({ statusCode: 404 });
    expect(() => new (require('../../../src/customer/services/contactPointService').ContactPointService)('fax', { repos: {} })).toThrow(/unknown kind/);
  });

  test('phones re-normalise on update and split extensions', async () => {
    const c = await newCustomer();
    const phone = svc.contactPoints.phone;
    const p = await phone.add('customer', c.id, { raw: '021 555 0100 ext 12' }, sys);
    expect(p).toMatchObject({ e164: '+27215550100', extension: '12', raw: '021 555 0100', countryCode: 'ZA' });
    const moved = await phone.update('customer', c.id, p.id, { raw: '020 7946 0958', countryCode: 'GB' }, sys);
    expect(moved).toMatchObject({ e164: '+442079460958', countryCode: 'GB' });
    expect((await phone.get('customer', c.id, p.id, sys)).e164).toBe('+442079460958');
  });

  test('addresses validate countries and validity ranges', async () => {
    const c = await newCustomer();
    const address = svc.contactPoints.address;
    await expect(address.add('customer', c.id, { line1: 'x', countryCode: 'QQ' }, sys)).rejects.toThrow(/Unknown country/);
    await expect(address.add('customer', c.id, { line1: 'x', countryCode: 'ZA', validFrom: '2026-02-01', validTo: '2026-01-01' }, sys)).rejects.toThrow(/validTo/);
    const a = await address.add('customer', c.id, { line1: 'x', countryCode: 'na' }, sys);
    expect(a.countryCode).toBe('NA');
    await address.add('customer', c.id, { line1: 'x', countryCode: 'NA' }, sys);
  });
});

describe('IdentityService', () => {
  test('links, refreshes, resolves, conflicts and unlinks', async () => {
    const c = await newCustomer();
    const other = await newCustomer();
    const ids = svc.identities;
    const first = await ids.link(c.id, { namespace: 'email', value: ' ADA@Example.com ', source: 'web' }, sys);
    expect(first).toMatchObject({ namespace: 'email', value: 'ada@example.com', source: 'web' });
    const again = await ids.link(c.id, { namespace: 'email', value: 'ada@example.com' }, sys);
    expect(again.id).toBe(first.id);
    expect(again.version).toBe(2);
    await expect(ids.link(other.id, { namespace: 'email', value: 'ada@example.com' }, sys)).rejects.toMatchObject({ statusCode: 409 });
    const phone = await ids.link(c.id, { namespace: 'phone', value: '0821234567' }, sys);
    expect(phone.value).toBe('+27821234567');
    expect(await ids.resolve('phone', '+27 82 123 4567', sys)).toBe(c.id);
    await expect(ids.link(c.id, { namespace: 'crm' }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(ids.link(c.id, { namespace: 'crm', value: '  ' }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(ids.unlink(other.id, first.id, sys)).rejects.toMatchObject({ statusCode: 404 });
    await ids.unlink(c.id, first.id, sys);
    expect(await ids.resolve('email', 'ada@example.com', sys)).toBeNull();
    expect(await ids.list(c.id, sys)).toHaveLength(1);
    expect(() => ids.parse(':x')).toThrow(/namespace:value/);
    expect(ids.parse('crm:a:b')).toEqual({ namespace: 'crm', value: 'a:b' });
  });
});

describe('ConsentService', () => {
  const marketingEmail = { purpose: 'marketing', channel: 'email' };
  const at = (days) => new Date(Date.now() - days * 86400000).toISOString();

  test('no record: marketing denied, service messages allowed', async () => {
    const c = await newCustomer();
    expect(await svc.consents.canContact(c.id, marketingEmail, sys)).toEqual({ allowed: false, reason: 'no_consent', consentId: null });
    expect(await svc.consents.canContact(c.id, { purpose: 'service_messages', channel: 'sms' }, sys))
      .toMatchObject({ allowed: true, reason: 'service_default' });
    await expect(svc.consents.canContact(c.id, {}, sys)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('latest record per key wins; changes emit consent.changed', async () => {
    const c = await newCustomer();
    const changes = [];
    env.cx.events.on('consent.changed', (e) => changes.push(e.data));
    await svc.consents.record(c.id, { ...marketingEmail, status: 'opt_in', capturedAt: at(10) }, sys);
    await svc.consents.record(c.id, { ...marketingEmail, status: 'opt_in', capturedAt: at(9) }, sys);
    await svc.consents.record(c.id, { ...marketingEmail, status: 'opt_out', capturedAt: at(5) }, sys);
    // a back-dated import does not change the current state
    await svc.consents.record(c.id, { ...marketingEmail, status: 'opt_in', capturedAt: at(20), source: 'import' }, sys);
    expect(changes.map((x) => [x.from, x.to])).toEqual([[null, 'opt_in'], ['opt_in', 'opt_out']]);
    expect(await svc.consents.canContact(c.id, marketingEmail, sys)).toMatchObject({ allowed: false, reason: 'opted_out' });
    const state = await svc.consents.getConsentState(c.id, sys);
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('opt_out');
    expect((await svc.consents.history(c.id, sys)).map((r) => r.status)).toEqual(['opt_out', 'opt_in', 'opt_in', 'opt_in']);
    expect(await svc.consents.history(c.id, sys, { channel: 'sms' })).toEqual([]);
  });

  test('specific beats general, but a newer general opt-out wins', async () => {
    const c = await newCustomer();
    await svc.consents.record(c.id, { purpose: 'marketing', channel: 'any', status: 'opt_in', capturedAt: at(30) }, sys);
    expect(await svc.consents.canContact(c.id, { purpose: 'marketing', channel: 'sms' }, sys)).toMatchObject({ allowed: true });
    await svc.consents.record(c.id, { ...marketingEmail, topicId: 'news', status: 'opt_in', capturedAt: at(10) }, sys);
    await svc.consents.record(c.id, { ...marketingEmail, status: 'opt_out', capturedAt: at(20) }, sys);
    expect(await svc.consents.canContact(c.id, { ...marketingEmail, topicId: 'news' }, sys)).toMatchObject({ allowed: true, reason: 'opted_in' });
    expect(await svc.consents.canContact(c.id, { ...marketingEmail, topicId: 'offers' }, sys)).toMatchObject({ allowed: false });
    await svc.consents.record(c.id, { ...marketingEmail, status: 'opt_out', capturedAt: at(1) }, sys);
    expect(await svc.consents.canContact(c.id, { ...marketingEmail, topicId: 'news' }, sys)).toMatchObject({ allowed: false, reason: 'opted_out' });
  });

  test('pending, expiry, blocked customers and input checks', async () => {
    const c = await newCustomer();
    await svc.consents.record(c.id, { ...marketingEmail, status: 'pending' }, sys);
    expect(await svc.consents.canContact(c.id, marketingEmail, sys)).toMatchObject({ allowed: false, reason: 'consent_pending' });
    await svc.consents.record(c.id, { purpose: 'marketing', channel: 'sms', status: 'opt_in', capturedAt: at(10), expiresAt: at(1) }, sys);
    expect(await svc.consents.canContact(c.id, { purpose: 'marketing', channel: 'sms' }, sys)).toMatchObject({ reason: 'no_consent' });
    expect(await svc.consents.canContact(c.id, { purpose: 'marketing', channel: 'sms' }, sys, { at: new Date(Date.now() - 5 * 86400000) })).toMatchObject({ allowed: true });
    await svc.customers.setStatus(c.id, 'blocked', sys);
    expect(await svc.consents.canContact(c.id, { purpose: 'service_messages', channel: 'sms' }, sys)).toMatchObject({ allowed: false, reason: 'customer_blocked' });
    await expect(svc.consents.record(c.id, { ...marketingEmail, status: 'opt_in', capturedAt: 'nope' }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(svc.consents.record(c.id, { ...marketingEmail, status: 'opt_in', capturedAt: new Date(Date.now() + 3600000).toISOString() }, sys)).rejects.toThrow(/future/);
    await expect(svc.consents.record(c.id, { ...marketingEmail, status: 'opt_in', expiresAt: at(1) }, sys)).rejects.toThrow(/expiresAt/);
    await expect(svc.consents.record('missing', { ...marketingEmail, status: 'opt_in' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.consents.repo.update((await svc.consents.history(c.id, sys))[0].id, { status: 'opt_in' }, sys)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('property: canContact never allows marketing when the newest applicable record is an opt-out', async () => {
    const rand = prng(7);
    const pick = (l) => l[Math.floor(rand() * l.length)];
    const c = await newCustomer();
    const records = [];
    for (let i = 0; i < 60; i++) {
      const r = { purpose: 'marketing', channel: pick(['email', 'any']), topicId: rand() < 0.3 ? 'news' : undefined, status: pick(['opt_in', 'opt_out']), capturedAt: at(60 - i + rand()) };
      records.push(r);
      await svc.consents.record(c.id, r, sys);
      for (const topicId of [undefined, 'news']) {
        const applicable = records.filter((x) => (x.channel === 'email' || x.channel === 'any') && (!x.topicId || x.topicId === topicId));
        const newest = applicable.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).pop();
        const decision = await svc.consents.canContact(c.id, { purpose: 'marketing', channel: 'email', topicId }, sys);
        if (newest && newest.status === 'opt_out') expect(decision.allowed).toBe(false);
      }
    }
  }, 30000); // the file data provider rewrites its file on every write
});

describe('OrganizationService, NoteService and timeline', () => {
  test('organizations: CRUD, cycles, members and protected delete', async () => {
    const parent = await svc.organizations.create({ name: 'Parent Co', website: 'https://parent.example.com' }, sys);
    const child = await svc.organizations.create({ name: 'Child Co', parentOrganizationId: parent.id }, sys);
    expect(child.number).toBe('ORG-000002');
    await expect(svc.organizations.create({ name: 'X', parentOrganizationId: 'missing' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.organizations.create({ name: 'X', website: 'javascript:alert(1)' }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(svc.organizations.update(parent.id, { parentOrganizationId: child.id }, sys)).rejects.toThrow(/cycle/);
    await expect(svc.organizations.update(parent.id, { parentOrganizationId: parent.id }, sys)).rejects.toThrow(/own parent/);
    expect((await svc.organizations.update(child.id, { industry: 'Retail' }, sys)).industry).toBe('Retail');
    const member = await newCustomer({ organizationId: child.id });
    await svc.contactPoints.email.add('organization', child.id, { address: 'info@child.example.com' }, sys);
    const full = await svc.organizations.get(child.id, sys, { expand: ['members', 'emails', 'phones', 'addresses'] });
    expect(full.members.map((m) => m.id)).toEqual([member.id]);
    expect(full.emails).toHaveLength(1);
    await expect(svc.organizations.get(child.id, sys, { expand: ['bogus'] })).rejects.toMatchObject({ statusCode: 422 });
    expect((await svc.organizations.list({ q: 'child' }, sys)).total).toBe(1);
    expect((await svc.organizations.list({ q: 'zzz' }, sys)).total).toBe(0);
    expect((await svc.organizations.list({}, sys)).total).toBe(2);
    await expect(svc.organizations.remove(child.id, sys)).rejects.toMatchObject({ statusCode: 409 });
    await svc.customers.update(member.id, { organizationId: null }, sys);
    await svc.organizations.remove(child.id, sys);
    expect(await svc.contactPoints.email.listUnchecked('organization', child.id, sys)).toEqual([]);
  });

  test('notes: ordering, ownership and immutability', async () => {
    const c = await newCustomer();
    const other = await newCustomer();
    const a = await svc.notes.add('customer', c.id, { body: 'first' }, sys);
    await new Promise((r) => setTimeout(r, 5));
    await svc.notes.add('customer', c.id, { body: 'second' }, sys);
    await svc.notes.update('customer', c.id, a.id, { pinned: true }, sys);
    expect((await svc.notes.list('customer', c.id, sys)).map((n) => n.body)).toEqual(['first', 'second']);
    await expect(svc.notes.add('customer', c.id, { body: '  ' }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await expect(svc.notes.update('customer', other.id, a.id, { body: 'x' }, sys)).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.notes.update('customer', c.id, a.id, { subjectId: other.id }, sys)).rejects.toMatchObject({ statusCode: 422 });
    await svc.notes.remove('customer', c.id, a.id, sys);
    expect(await svc.notes.list('customer', c.id, sys)).toHaveLength(1);
  });

  test('timeline merges providers, filters, pages and accepts registered providers', async () => {
    const c = await newCustomer({ email: 'a@example.com', consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in', capturedAt: new Date(Date.now() - 86400000).toISOString() }] });
    await svc.notes.add('customer', c.id, { body: 'hello', pinned: true }, sys);
    await svc.customers.update(c.id, { lifecycleStage: 'lead' }, sys);
    await svc.contactPoints.email.add('customer', c.id, { address: 'b@example.com', isPrimary: true }, sys);
    const page = await svc.timeline.list(c.id, sys);
    const titles = page.items.map((e) => e.title);
    expect(titles).toEqual(expect.arrayContaining(['Pinned note', 'Customer updated', 'Customer added', 'Email added', 'Opted in to marketing (email)']));
    expect(titles.filter((t) => t === 'Email updated')).toHaveLength(0);
    expect(page.items.find((e) => e.title === 'Customer updated').summary).toBe('Fields: lifecycleStage');
    const sorted = [...page.items].sort((a, b) => b.at.localeCompare(a.at));
    expect(page.items.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
    expect((await svc.timeline.list(c.id, sys, { types: ['note'] })).items).toHaveLength(1);
    const first = await svc.timeline.list(c.id, sys, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = await svc.timeline.list(c.id, sys, { limit: 200, before: first.nextBefore });
    expect(second.items.every((e) => e.at < first.nextBefore)).toBe(true);
    await expect(svc.timeline.list(c.id, sys, { before: 'nope' })).rejects.toMatchObject({ statusCode: 422 });
    const off = env.cx.customer.registerTimelineProvider('order', async (id) => [{ id: `order:${id}`, type: 'order', at: new Date().toISOString(), title: 'Order placed' }]);
    env.cx.customer.registerTimelineProvider('broken', async () => { throw new Error('down'); });
    expect((await svc.timeline.list(c.id, sys)).items[0].title).toBe('Order placed');
    off();
    expect(() => svc.timeline.register('x', null)).toThrow(/function/);
  });
});

describe('in-process API and seed', () => {
  test('cx.customer methods default to a system context', async () => {
    const api = env.cx.customer;
    const c = await api.create({ name: 'Ada', email: 'ada@example.com' });
    expect((await api.get(c.id, { expand: ['emails'] })).emails).toHaveLength(1);
    expect((await api.update(c.id, { lifecycleStage: 'lead' })).lifecycleStage).toBe('lead');
    expect((await api.list()).total).toBe(1);
    expect((await api.lookup({ email: 'ada@example.com' }))[0].id).toBe(c.id);
    expect((await api.typeahead('ada'))[0].id).toBe(c.id);
    await api.recordConsent(c.id, { purpose: 'marketing', channel: 'email', status: 'opt_in' });
    expect(await api.getConsentState(c.id)).toHaveLength(1);
    expect((await api.canContact(c.id, { purpose: 'marketing', channel: 'email' })).allowed).toBe(true);
    expect((await api.timeline(c.id)).items.length).toBeGreaterThan(0);
    expect((await api.setStatus(c.id, 'inactive')).status).toBe('inactive');
    expect((await api.upsertByIdentity({ namespace: 'crm', value: '1' }, { email: 'ada@example.com' })).matchedBy).toBe('email');
    await api.remove(c.id);
    expect((await api.list()).total).toBe(0);
    expect(api.schemas.customer.name).toBe('customer');
  });

  test('seed creates deterministic data once', async () => {
    const result = await seedCustomers(svc, { customers: 30, organizations: 5 });
    expect(result).toEqual({ customers: 30, organizations: 5, skipped: false });
    expect(await svc.customers.repo.count(sys)).toBe(30);
    expect(await svc.organizations.repo.count(sys)).toBe(5);
    expect((await seedCustomers(svc, { customers: 5 })).skipped).toBe(true);
    expect((await svc.customers.lookup({ identity: 'commerce:C100000' }, sys))).toHaveLength(1);
    const again = await mountCustomer();
    await seedCustomers(again.svc, { customers: 30, organizations: 5 });
    const names = async (s) => (await s.customers.list({ sort: [{ field: 'number', dir: 1 }], limit: 30 }, systemContext('t'))).items.map((c) => c.name.full);
    expect(await names(again.svc)).toEqual(await names(svc));
    await again.cx.shutdown();
  }, 30000); // the file data provider rewrites its file on every write

  test('mount option seed runs on init', async () => {
    const seeded = await mountCustomer({ seed: { customers: 3, organizations: 1 } });
    expect(await seeded.svc.customers.repo.count(seeded.sys)).toBe(3);
    await seeded.cx.shutdown();
  });
});
