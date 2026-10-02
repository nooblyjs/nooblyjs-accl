'use strict';

const { mountCustomer } = require('../helpers/customer');

let env;

beforeEach(async () => {
  env = await mountCustomer({ customer: { defaultCountry: 'ZA' } });
});

afterEach(async () => {
  await env.cx.shutdown();
});

async function createCustomer(body = {}) {
  const res = await env.admin.post('/customers').send({ name: { given: 'Ada', family: 'Lovelace' }, email: 'ada@example.com', phone: '082 123 4567', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

describe('customers', () => {
  test('create, get with expand, ETag, patch with If-Match, delete', async () => {
    const c = await createCustomer({ identities: [{ namespace: 'commerce', value: '42' }] });
    expect(c).toMatchObject({ number: 'CUS-000001', status: 'active', emails: [{ address: 'ada@example.com' }] });

    const got = await env.admin.get(`/customers/${c.id}?expand=emails,phones,identities,consentState&fields=number,name`);
    expect(got.status).toBe(200);
    expect(got.headers.etag).toBe(`W/"${got.body.version}"`);
    expect(got.body.number).toBe('CUS-000001');
    expect(got.body.phones[0].e164).toBe('+27821234567');

    const stale = await env.admin.patch(`/customers/${c.id}`).set('If-Match', 'W/"1"').send({ lifecycleStage: 'lead' });
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe('version_conflict');
    const ok = await env.admin.patch(`/customers/${c.id}`).set('If-Match', got.headers.etag).send({ lifecycleStage: 'lead' });
    expect(ok.status).toBe(200);
    expect(ok.body.lifecycleStage).toBe('lead');

    expect((await env.admin.delete(`/customers/${c.id}`)).status).toBe(204);
    expect((await env.admin.get(`/customers/${c.id}`)).status).toBe(404);
  });

  test('list with filters, sort, paging, q and expand', async () => {
    for (const [given, stage] of [['Ada', 'lead'], ['Grace', 'customer'], ['Alan', 'customer']]) {
      await env.admin.post('/customers').send({ name: { given, family: 'Test' }, lifecycleStage: stage });
    }
    const page = await env.admin.get('/customers?filter[lifecycleStage]=customer&sort=name.given&limit=1&expand=emails');
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 0, nextCursor: '1' });
    expect(page.body.items[0].name.given).toBe('Alan');
    expect(page.body.items[0].emails).toEqual([]);
    expect((await env.admin.get('/customers?q=grace')).body.total).toBe(1);
    expect((await env.admin.get('/customers?filter[nope]=1')).status).toBe(400);
    expect((await env.admin.get('/customers?expand=bogus')).status).toBe(400);
  });

  test('validation errors carry details', async () => {
    const res = await env.admin.post('/customers').send({ name: { given: 'Ada' }, lifecycleStage: 'nope', email: 'bad' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect((await env.admin.post('/customers').set('Content-Type', 'application/json').send('{oops')).status).toBe(400);
  });

  test(':status action and :upsert', async () => {
    const c = await createCustomer();
    const blocked = await env.admin.post(`/customers/${c.id}:status`).send({ status: 'blocked', reason: 'chargeback' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.status).toBe('blocked');
    expect((await env.admin.post(`/customers/${c.id}:status`).send({})).status).toBe(400);
    expect((await env.admin.post(`/customers/${c.id}:status`).send({ status: 'erased' })).status).toBe(409);

    const created = await env.admin.post('/customers:upsert').send({ identity: { namespace: 'commerce', value: '777' }, profile: { name: 'Grace Hopper', email: 'grace@example.com' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ created: true, matchedBy: null });
    const matched = await env.admin.post('/customers:upsert').send({ identity: { namespace: 'commerce', value: '777' }, profile: { lifecycleStage: 'customer' } });
    expect(matched.status).toBe(200);
    expect(matched.body).toMatchObject({ created: false, matchedBy: 'identity', customer: { lifecycleStage: 'customer' } });
    expect((await env.admin.post('/customers:upsert').send({})).status).toBe(400);
  });

  test('lookup and typeahead', async () => {
    const c = await createCustomer({ identities: [{ namespace: 'loyalty', value: 'L-9' }] });
    for (const qs of ['email=ADA@example.com', 'phone=%2B27821234567', 'identity=loyalty:L-9', `number=${c.number}`]) {
      const res = await env.admin.get(`/customers/lookup?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((x) => x.id)).toEqual([c.id]);
    }
    expect((await env.admin.get('/customers/lookup?q=lovel&limit=5')).body.items[0].id).toBe(c.id);
    expect((await env.admin.get('/customers/lookup')).status).toBe(400);
    expect((await env.admin.get('/customers/lookup?email=a&email=b')).status).toBe(400);
  });

  test('contact points, identities, consents, notes, timeline and audit', async () => {
    const c = await createCustomer();
    const base = `/customers/${c.id}`;
    const added = await env.admin.post(`${base}/addresses`).send({ line1: '1 Long St', countryCode: 'ZA', type: 'billing' });
    expect(added.status).toBe(201);
    expect(added.body.isPrimary).toBe(true);
    expect((await env.admin.get(`${base}/addresses/${added.body.id}`)).body.line1).toBe('1 Long St');
    const second = await env.admin.post(`${base}/addresses`).send({ line1: '2 Short St', countryCode: 'ZA' });
    const promoted = await env.admin.patch(`${base}/addresses/${second.body.id}`).send({ isPrimary: true });
    expect(promoted.body.isPrimary).toBe(true);
    expect((await env.admin.get(`${base}/addresses`)).body.items[0].id).toBe(second.body.id);
    expect((await env.admin.delete(`${base}/addresses/${added.body.id}`)).status).toBe(204);
    expect((await env.admin.post(`${base}/emails`).send({ address: 'ada@example.com' })).status).toBe(409);
    expect((await env.admin.get(`${base}/phones`)).body.items).toHaveLength(1);

    const identity = await env.admin.post(`${base}/identities`).send({ namespace: 'crm', value: 'X1' });
    expect(identity.status).toBe(201);
    expect((await env.admin.get(`${base}/identities`)).body.items).toHaveLength(1);
    expect((await env.admin.delete(`${base}/identities/${identity.body.id}`)).status).toBe(204);

    const consent = await env.admin.post(`${base}/consents`).set('User-Agent', 'jest').send({ purpose: 'marketing', channel: 'email', status: 'opt_in', source: 'form' });
    expect(consent.status).toBe(201);
    expect(consent.body.evidence.userAgent).toBe('jest');
    expect((await env.admin.get(`${base}/consents`)).body.items).toHaveLength(1);
    expect((await env.admin.get(`${base}/consents/state`)).body.items[0].status).toBe('opt_in');
    expect((await env.admin.get(`${base}/consents/check?purpose=marketing&channel=email`)).body).toMatchObject({ allowed: true });
    expect((await env.admin.get(`${base}/consents/check?purpose=marketing&channel=sms`)).body).toMatchObject({ allowed: false, reason: 'no_consent' });

    const note = await env.admin.post(`${base}/notes`).send({ body: 'Called about billing' });
    expect(note.status).toBe(201);
    expect((await env.admin.patch(`${base}/notes/${note.body.id}`).send({ pinned: true })).body.pinned).toBe(true);
    expect((await env.admin.get(`${base}/notes`)).body.items).toHaveLength(1);
    expect((await env.admin.delete(`${base}/notes/${note.body.id}`)).status).toBe(204);

    const timeline = await env.admin.get(`${base}/timeline?limit=5&types=consent,audit`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.items.length).toBe(5);
    expect(timeline.body.nextBefore).toEqual(expect.any(String));
    const audit = await env.admin.get(`${base}/audit`);
    expect(audit.body.items[0].entityId).toBe(c.id);
    expect((await env.admin.get(`/audit?entity=address&action=create`)).body.total).toBe(2);
  });

  test('organizations and their sub-resources', async () => {
    const org = await env.admin.post('/organizations').send({ name: 'Acme', employeeBand: '10-49' });
    expect(org.status).toBe(201);
    const id = org.body.id;
    expect((await env.admin.post(`/organizations/${id}/phones`).send({ raw: '021 555 0100', type: 'work' })).status).toBe(201);
    expect((await env.admin.post(`/organizations/${id}/notes`).send({ body: 'Key account' })).status).toBe(201);
    await createCustomer({ organizationId: id });
    const got = await env.admin.get(`/organizations/${id}?expand=phones,members`);
    expect(got.body.phones[0].e164).toBe('+27215550100');
    expect(got.body.members).toHaveLength(1);
    expect((await env.admin.get('/organizations?q=acme')).body.total).toBe(1);
    expect((await env.admin.patch(`/organizations/${id}`).send({ industry: 'Retail' })).body.industry).toBe('Retail');
    expect((await env.admin.delete(`/organizations/${id}`)).status).toBe(409);
    expect((await env.admin.get('/organizations/missing')).status).toBe(404);
  });

  test('reference data and OpenAPI', async () => {
    const ref = await env.admin.get('/reference');
    expect(ref.body.countries).toHaveLength(249);
    expect(ref.body.lifecycleStages).toContain('mql');
    const doc = await env.admin.get('/openapi.json');
    expect(doc.body.paths['/customers/{id}/consents/check'].get).toBeDefined();
    expect(doc.body.paths['/organizations/{id}/addresses/{cpId}'].patch).toBeDefined();
    expect(doc.body.components.schemas.CustomerInput.properties.status).toBeUndefined();
    expect(doc.body.components.schemas.Customer.properties.name['x-pii']).toBe(true);
  });
});

describe('roles and privacy', () => {
  test('401 without roles, 403 without permission', async () => {
    const anon = env.as('');
    expect((await anon.get('/customers')).status).toBe(401);
    expect((await env.as('marketer').delete('/customers/x')).status).toBe(403);
    expect((await env.as('readonly').post('/customers').send({ name: 'x' })).status).toBe(403);
    expect((await env.as('agent').get('/audit')).status).toBe(403);
    expect((await env.as('agent').post('/customers/x/consents').send({})).status).toBe(404);
    expect((await env.as('readonly').post('/customers/x/consents').send({})).status).toBe(403);
  });

  test('PII is masked for roles without pii:read, everywhere', async () => {
    const c = await createCustomer({ dateOfBirth: '1815-12-10' });
    const agent = env.as('agent');
    const got = (await agent.get(`/customers/${c.id}?expand=emails,phones`)).body;
    expect(got.name).toMatchObject({ given: 'A***', family: 'L***' });
    expect(got.dateOfBirth).toBe('***');
    expect(got.emails[0].address).toBe('a***@example.com');
    expect(got.phones[0].e164).toBe('+27***67');
    const listed = (await agent.get('/customers?expand=emails')).body.items[0];
    expect(listed.emails[0].address).toBe('a***@example.com');
    const supervisor = (await env.as('supervisor').get(`/customers/${c.id}`)).body;
    expect(supervisor.name.given).toBe('Ada');
    const auditEntries = (await env.admin.get(`/customers/${c.id}/audit`)).body.items;
    expect(JSON.stringify(auditEntries)).not.toMatch(/Lovelace|ada@example\.com/);
  });

  test('an agent edit that leaves masked fields alone does not overwrite them', async () => {
    const c = await createCustomer();
    const agent = env.as('agent');
    const res = await agent.patch(`/customers/${c.id}`).send({ lifecycleStage: 'customer' });
    expect(res.status).toBe(200);
    expect((await env.admin.get(`/customers/${c.id}`)).body.name.given).toBe('Ada');
  });

  test('tenants are isolated', async () => {
    const tenanted = await mountCustomer({ tenancy: { enabled: true } });
    const req = (tenant) => ({
      post: (p) => require('supertest')(tenanted.app).post(`/applications/customer/api/v1${p}`).set('x-role', 'admin').set('x-tenant-id', tenant),
      get: (p) => require('supertest')(tenanted.app).get(`/applications/customer/api/v1${p}`).set('x-role', 'admin').set('x-tenant-id', tenant)
    });
    const a = await req('acme').post('/customers').send({ name: 'Ada', identities: [{ namespace: 'crm', value: '1' }] });
    const b = await req('globex').post('/customers').send({ name: 'Bob', identities: [{ namespace: 'crm', value: '1' }] });
    expect(a.body.number).toBe('CUS-000001');
    expect(b.body.number).toBe('CUS-000001');
    expect((await req('globex').get(`/customers/${a.body.id}`)).status).toBe(404);
    expect((await req('acme').get('/customers')).body.total).toBe(1);
    expect((await require('supertest')(tenanted.app).get('/applications/customer/api/v1/customers').set('x-role', 'admin')).status).toBe(400);
    await tenanted.cx.shutdown();
  });
});
