'use strict';

/**
 * PRD §8 scenario 1, "Commerce checkout creates a customer", run on the
 * memory and the file data providers (roadmap Phase 1 exit criterion).
 * The order-confirmation email arrives with the marketing module (Phase 2).
 */

const { mountCustomer } = require('../helpers/customer');

describe.each(['memory', 'file'])('commerce upsert on the %s data provider', (data) => {
  let env;

  beforeEach(async () => {
    env = await mountCustomer({}, { data });
  });

  afterEach(async () => {
    await env.cx.shutdown();
  });

  test('first checkout creates the customer with identity, email and consent', async () => {
    const created = [];
    env.cx.events.on('customer.created', (e) => created.push(e));
    const result = await env.cx.customer.upsertByIdentity({ namespace: 'commerce', value: '123', source: 'checkout' }, {
      name: { given: 'Thabo', family: 'Nkosi' },
      email: 'thabo@example.com',
      phone: '+27 82 555 0101',
      addresses: [{ type: 'shipping', line1: '10 Long Street', locality: 'Cape Town', postalCode: '8001', countryCode: 'ZA' }],
      consents: [{ purpose: 'marketing', channel: 'email', status: 'opt_in', source: 'form', evidence: { text: 'Send me offers' } }]
    });
    expect(result).toMatchObject({ created: true, matchedBy: null });
    expect(created).toHaveLength(1);
    expect(created[0].data.name.given).toBe('T***');
    const c = await env.cx.customer.get(result.customer.id, { expand: ['identities', 'emails', 'addresses', 'consentState'] });
    expect(c.identities[0]).toMatchObject({ namespace: 'commerce', value: '123', source: 'checkout' });
    expect(c.emails[0]).toMatchObject({ address: 'thabo@example.com', isPrimary: true });
    expect(c.addresses[0].type).toBe('shipping');
    expect((await env.cx.customer.canContact(c.id, { purpose: 'marketing', channel: 'email' })).allowed).toBe(true);
  });

  test('a known identity updates the same customer', async () => {
    const first = await env.cx.customer.upsertByIdentity({ namespace: 'commerce', value: '123' }, { name: 'Thabo Nkosi', email: 'thabo@example.com' });
    const second = await env.cx.customer.upsertByIdentity({ namespace: 'commerce', value: '123' }, {
      lifecycleStage: 'customer', email: 'thabo@example.com', phone: '+27825550101'
    });
    expect(second).toMatchObject({ created: false, matchedBy: 'identity' });
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.customer.lifecycleStage).toBe('customer');
    expect(second.customer.emails).toHaveLength(1);
    expect(second.customer.phones).toHaveLength(1);
    expect((await env.cx.customer.list()).total).toBe(1);
  });

  test('a new identity with a known email links to the existing customer', async () => {
    const existing = await env.cx.customer.create({ name: 'Thabo Nkosi', email: 'thabo@example.com' });
    const result = await env.cx.customer.upsertByIdentity({ namespace: 'commerce', value: '999' }, { email: 'THABO@example.com', emails: [{ address: 'thabo@work.example.com', type: 'work' }] });
    expect(result).toMatchObject({ created: false, matchedBy: 'email' });
    expect(result.customer.id).toBe(existing.id);
    expect(result.customer.identities.map((i) => i.value)).toEqual(['999']);
    expect(result.customer.emails.map((e) => e.address).sort()).toEqual(['thabo@example.com', 'thabo@work.example.com']);
    expect((await env.cx.customer.lookup({ identity: 'commerce:999' }))[0].id).toBe(existing.id);
  });

  test('concurrent checkouts for the same identity create one customer', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => env.cx.customer.upsertByIdentity({ namespace: 'commerce', value: '555' }, { name: 'Same Person' })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.customer.id)).size).toBe(1);
    expect((await env.cx.customer.list()).total).toBe(1);
  });

  test('state survives a restart (indexes rebuilt from storage)', async () => {
    const result = await env.cx.customer.upsertByIdentity({ namespace: 'commerce', value: '321' }, { name: 'Persisted', email: 'p@example.com' });
    const { BaseRepository } = require('../../src/shared/repository');
    const { createServices } = require('../helpers/registry');
    const fresh = createServices();
    // same stored documents, empty cache and search: what a new process sees
    const repo = new BaseRepository(env.svc.repos.identity.schema, { ...env.cx.customer.services.repos.identity, dataService: env.services.dataService, cache: fresh.cache, search: fresh.search, counter: null });
    expect(await repo.findByIndex('key', ['commerce', '321'], env.sys)).toEqual([]);
    await repo.init();
    expect((await repo.findByIndex('key', ['commerce', '321'], env.sys))[0].customerId).toBe(result.customer.id);
  });

  test('upsert rejects an invalid identity', async () => {
    await expect(env.cx.customer.upsertByIdentity({ namespace: '', value: '1' }, {})).rejects.toMatchObject({ statusCode: 422 });
    await expect(env.cx.customer.upsertByIdentity(null, {})).rejects.toMatchObject({ statusCode: 422 });
  });
});
