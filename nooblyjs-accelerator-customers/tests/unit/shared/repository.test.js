'use strict';

const { defineSchema } = require('../../../src/shared/schema');
const {
  BaseRepository, IndexManager, QueryEngine, Counter, KeyedMutex
} = require('../../../src/shared/repository');
const { DomainEventBus } = require('../../../src/shared/events');
const { AuditService } = require('../../../src/shared/audit');
const { createContext, systemContext } = require('../../../src/shared/context');
const { createServices } = require('../../helpers/registry');

const widget = defineSchema({
  name: 'widget',
  numberPrefix: 'WID',
  fields: {
    name: { type: 'string', required: true, pii: true },
    sku: { type: 'string', lowercase: true },
    status: { type: 'enum', values: ['draft', 'live'], default: 'draft' },
    qty: { type: 'integer', default: 0 },
    active: { type: 'boolean', default: true },
    ns: { type: 'string' },
    val: { type: 'string' },
    owner: { type: 'object', fields: { id: { type: 'string' }, team: { type: 'string' } } },
    lines: { type: 'array', items: { type: 'object', fields: { code: { type: 'string' } } } },
    extra: { type: 'json' },
    state: { type: 'string', readOnly: true }
  },
  indexes: [
    { name: 'sku', fields: ['sku'], unique: true },
    { name: 'identity', fields: ['ns', 'val'], unique: true },
    { name: 'status', fields: ['status'] }
  ],
  search: ['name', 'sku', 'tags']
});

const ledger = defineSchema({ name: 'entry', plural: 'entries', appendOnly: true, fields: { amount: { type: 'number', required: true } } });

const admin = systemContext('test');
const viewer = createContext({ actor: { type: 'user', id: 'u1' }, roles: ['readonly'], permissions: ['customer:read'] });
const otherTenant = systemContext('test', { tenantId: 'acme' });

function setup(extra = {}) {
  const s = createServices();
  const events = new DomainEventBus({ eventEmitter: s.eventEmitter, notifying: s.notifying, logger: s.logger });
  const audit = new AuditService({ dataService: s.dataService });
  const counter = new Counter(s.dataService, 'cx_counters');
  const deps = {
    dataService: s.dataService, cache: s.cache, search: s.search, logger: s.logger,
    events, audit, counter, module: 'test', containerPrefix: 'cx', ...extra
  };
  const repo = new BaseRepository(widget, deps);
  return { s, events, audit, counter, deps, repo };
}

describe('KeyedMutex', () => {
  test('serialises work per key and releases', async () => {
    const m = new KeyedMutex();
    const order = [];
    const slow = m.run('a', async () => { await new Promise((r) => setTimeout(r, 10)); order.push(1); });
    const fast = m.run('a', async () => { order.push(2); });
    const other = m.run('b', async () => { order.push(0); });
    await Promise.all([slow, fast, other]);
    expect(order).toEqual([0, 1, 2]);
    expect(m.size).toBe(0);
  });

  test('releases on error and handles multi-key / empty runs', async () => {
    const m = new KeyedMutex();
    await expect(m.run(['x', 'y'], async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(m.run([], async () => 7)).resolves.toBe(7);
    await expect(m.run(['y', 'x', 'x'], async () => 8)).resolves.toBe(8);
    expect(m.size).toBe(0);
  });
});

describe('Counter', () => {
  test('allocates sequential, formatted numbers per name, under concurrency', async () => {
    const { s } = setup();
    const c = new Counter(s.dataService, 'cx_counters');
    const values = await Promise.all(Array.from({ length: 20 }, () => c.next('a')));
    expect(values.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await c.nextNumber('CUS')).toBe('CUS-000001');
    expect(await c.nextNumber('CUS', 'acme')).toBe('CUS-000001');
    expect(Counter.format('CS', 45, 4)).toBe('CS-0045');
  });

  test('resumes from stored counters after a restart', async () => {
    const { s } = setup();
    await new Counter(s.dataService, 'cx_counters').next('a');
    await new Counter(s.dataService, 'cx_counters').next('a');
    expect(await new Counter(s.dataService, 'cx_counters').next('a')).toBe(3);
  });
});

describe('QueryEngine', () => {
  const docs = [
    { id: '1', n: 3, s: 'Beta', t: ['x', 'y'], b: true, o: { k: 'a' } },
    { id: '2', n: 1, s: 'alpha', t: ['y'], b: false, o: { k: 'b' } },
    { id: '3', n: 2, s: 'Gamma', t: [], o: null },
    { id: '4', s: 'delta' }
  ];
  const ids = (q) => QueryEngine.execute(docs, q).items.map((d) => d.id);

  test.each([
    [{ field: 's', op: 'eq', value: 'BETA' }, ['1']],
    [{ field: 's', op: 'ne', value: 'beta' }, ['2', '3', '4']],
    [{ field: 'n', op: 'in', value: [1, 2] }, ['2', '3']],
    [{ field: 'n', op: 'nin', value: [1, 2] }, ['1', '4']],
    [{ field: 'n', op: 'gt', value: 1 }, ['1', '3']],
    [{ field: 'n', op: 'gte', value: 2 }, ['1', '3']],
    [{ field: 'n', op: 'lt', value: 3 }, ['2', '3']],
    [{ field: 'n', op: 'lte', value: 1 }, ['2']],
    [{ field: 't', op: 'contains', value: 'x' }, ['1']],
    [{ field: 's', op: 'contains', value: 'LT' }, ['4']],
    [{ field: 's', op: 'contains', value: 'PH' }, ['2']],
    [{ field: 's', op: 'prefix', value: 'g' }, ['3']],
    [{ field: 'n', op: 'exists', value: 'false' }, ['4']],
    [{ field: 'b', op: 'exists', value: true }, ['1', '2']],
    [{ field: 't', op: 'eq', value: 'y' }, ['1', '2']],
    [{ field: 'o.k', op: 'eq', value: 'b' }, ['2']],
    [{ field: 'b', op: 'eq', value: true }, ['1']]
  ])('filter %j', (filter, expected) => {
    expect(ids({ filters: [filter] })).toEqual(expected);
  });

  test('rejects unknown operators', () => {
    expect(() => QueryEngine.matchFilter({}, { field: 'a', op: 'zz', value: 1 })).toThrow(/Unknown operator/);
  });

  test('sorts with nulls last in both directions, then paginates', () => {
    expect(ids({ sort: [{ field: 'n', dir: 1 }] })).toEqual(['2', '3', '1', '4']);
    expect(ids({ sort: [{ field: 'n', dir: -1 }] })).toEqual(['1', '3', '2', '4']);
    expect(ids({ sort: [{ field: 'b', dir: 1 }, { field: 's', dir: 1 }] })).toEqual(['2', '1', '4', '3']);
    const page = QueryEngine.execute(docs, { sort: [{ field: 's', dir: 1 }], limit: 2, offset: 1 });
    expect(page).toMatchObject({ total: 4, limit: 2, offset: 1, nextCursor: '3' });
    expect(page.items.map((d) => d.id)).toEqual(['1', '4']);
    expect(QueryEngine.execute(docs, { limit: 10 }).nextCursor).toBeNull();
    expect(QueryEngine.execute(docs).total).toBe(4);
  });

  test('compare and project', () => {
    expect(QueryEngine.compare(null, undefined)).toBe(0);
    expect(QueryEngine.compare(null, 1)).toBe(1);
    expect(QueryEngine.compare(1, null)).toBe(-1);
    expect(QueryEngine.compare('b', 'a')).toBeGreaterThan(0);
    expect(QueryEngine.project({ id: '1', a: 1, o: { k: 2, z: 3 } }, ['a', 'o.k', 'missing'])).toEqual({ id: '1', a: 1, o: { k: 2 } });
    expect(QueryEngine.project({ id: '1', a: 1 }, null)).toEqual({ id: '1', a: 1 });
  });
});

describe('IndexManager', () => {
  test('maintains sparse, case-insensitive, tenant-scoped entries', async () => {
    const { s } = setup();
    const ix = new IndexManager(widget, s.cache, 'cx_widgets');
    await ix.add({ id: 'a', tenantId: 'default', sku: 'ABC', status: 'draft' });
    await ix.add({ id: 'a', tenantId: 'default', sku: 'ABC', status: 'draft' });
    await ix.add({ id: 'b', tenantId: 'default', status: 'draft' });
    expect(await ix.lookup('sku', 'abc', 'default')).toEqual(['a']);
    expect(await ix.lookup('sku', 'abc', 'acme')).toEqual([]);
    expect(await ix.lookup('sku', null, 'default')).toEqual([]);
    expect(await ix.lookup('status', ['draft'], 'default')).toEqual(['a', 'b']);
    expect(() => ix.index('nope')).toThrow(/Unknown index/);

    await ix.update({ id: 'a', tenantId: 'default', sku: 'ABC', status: 'draft' }, { id: 'a', tenantId: 'default', sku: 'ABC', status: 'draft' });
    await ix.update({ id: 'a', tenantId: 'default', sku: 'ABC', status: 'draft' }, { id: 'a', tenantId: 'default', sku: 'XYZ', status: 'live' });
    expect(await ix.lookup('sku', 'abc', 'default')).toEqual([]);
    expect(await ix.lookup('status', 'draft', 'default')).toEqual(['b']);
    expect(ix.pick([{ field: 'ns', op: 'eq', value: 'a' }])).toBeNull();
    expect(ix.pick([{ field: 'ns', op: 'eq', value: 'a' }, { field: 'val', op: 'eq', value: 'b' }]))
      .toEqual({ name: 'identity', values: ['a', 'b'] });
  });
});

describe('BaseRepository', () => {
  test('requires dataService, cache and a counter for numbered entities', () => {
    expect(() => new BaseRepository(widget, {})).toThrow(/required/);
    const { s } = setup();
    expect(() => new BaseRepository(widget, { dataService: s.dataService, cache: s.cache })).toThrow(/counter/);
  });

  test('create stamps the envelope, number, indexes, audit and event', async () => {
    const { repo, s, audit } = setup();
    const seen = [];
    s.eventEmitter.on('cx.widget.created', (e) => seen.push(e));
    const w = await repo.create({ name: 'Bolt', sku: 'B-1', tags: ['vip'], state: 'ignored' }, admin);
    expect(w).toMatchObject({
      name: 'Bolt', sku: 'b-1', status: 'draft', qty: 0, active: true, number: 'WID-000001',
      tenantId: 'default', version: 1, deletedAt: null, createdBy: 'system:test'
    });
    expect(w.state).toBeUndefined();
    expect(w.id).toEqual(expect.any(String));
    const stored = await s.dataService.getByUuid('cx_widgets', w.id);
    expect(stored.id).toBe(w.id);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'cx.widget.created', module: 'test', subject: { entity: 'widget', id: w.id } });
    expect(seen[0].data.name).toBe('B***');
    const log = await audit.list({ entityId: w.id }, admin);
    expect(log.items[0]).toMatchObject({ action: 'create', entity: 'widget' });
    expect(log.items[0].changes).toContainEqual({ op: 'add', path: '/name', value: '[REDACTED]' });
  });

  test('create accepts trusted system fields', async () => {
    const { repo } = setup();
    const w = await repo.create({ name: 'A' }, admin, { system: { state: 'locked' } });
    expect(w.state).toBe('locked');
  });

  test('stored documents are isolated from caller mutation', async () => {
    const { repo } = setup();
    const input = { name: 'A', extra: { deep: 1 } };
    const w = await repo.create(input, admin);
    input.extra.deep = 2;
    w.extra.deep = 3;
    expect((await repo.get(w.id, admin)).extra.deep).toBe(1);
  });

  test('unique indexes reject duplicates, including concurrent creates', async () => {
    const { repo } = setup();
    await repo.create({ name: 'A', sku: 'X' }, admin);
    await expect(repo.create({ name: 'B', sku: 'x' }, admin)).rejects.toMatchObject({ statusCode: 409, index: 'sku' });
    const results = await Promise.allSettled([
      repo.create({ name: 'C', ns: 'crm', val: '1' }, admin),
      repo.create({ name: 'D', ns: 'crm', val: '1' }, admin),
      repo.create({ name: 'E', ns: 'crm', val: '1' }, admin)
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // the same values are allowed in another tenant
    await expect(repo.create({ name: 'F', sku: 'X' }, otherTenant)).resolves.toMatchObject({ tenantId: 'acme' });
  });

  test('get masks PII without pii:read, honours tenancy and sparse fields', async () => {
    const { repo } = setup();
    const w = await repo.create({ name: 'Bolt', sku: 'b' }, admin);
    expect((await repo.get(w.id, viewer)).name).toBe('B***');
    expect((await repo.get(w.id, admin)).name).toBe('Bolt');
    expect(await repo.get(w.id, admin, { fields: ['sku'] })).toEqual({ id: w.id, version: 1, sku: 'b' });
    await expect(repo.get(w.id, otherTenant)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repo.get('missing', admin)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repo.get(undefined, admin)).rejects.toMatchObject({ statusCode: 404 });
    expect(await repo.find('missing', admin)).toBeNull();
    expect((await repo.find(w.id, admin)).id).toBe(w.id);
  });

  test('update merges, bumps version, re-indexes, audits and emits changes', async () => {
    const { repo, s, audit } = setup();
    const w = await repo.create({ name: 'A', sku: 'one', owner: { id: 'o1', team: 't' } }, admin);
    const events = [];
    s.eventEmitter.on('cx.widget.updated', (e) => events.push(e));
    const u = await repo.update(w.id, { sku: 'two', owner: { team: null }, status: 'live', id: 'hack' }, viewer);
    expect(u).toMatchObject({ id: w.id, sku: 'two', owner: { id: 'o1' }, status: 'live', version: 2, updatedBy: 'u1', number: w.number });
    expect(u.owner.team).toBeUndefined();
    expect(await repo.findByIndex('sku', 'two', admin)).toHaveLength(1);
    expect(await repo.findByIndex('sku', 'one', admin)).toHaveLength(0);
    expect(events[0].changes).toEqual(expect.arrayContaining([{ op: 'replace', path: '/sku', from: 'one', value: 'two' }]));
    expect((await audit.list({ entityId: w.id, action: 'update' }, admin)).total).toBe(1);
  });

  test('update without changes is a no-op', async () => {
    const { repo } = setup();
    const w = await repo.create({ name: 'A' }, admin);
    const u = await repo.update(w.id, { name: 'A' }, admin);
    expect(u.version).toBe(1);
  });

  test('update validates, enforces required fields, versions and uniqueness', async () => {
    const { repo } = setup();
    const a = await repo.create({ name: 'A', sku: 'a' }, admin);
    await repo.create({ name: 'B', sku: 'b' }, admin);
    await expect(repo.update(a.id, { qty: 'x' }, admin)).rejects.toMatchObject({ statusCode: 422 });
    await expect(repo.update(a.id, { name: null }, admin)).rejects.toMatchObject({ statusCode: 422 });
    await expect(repo.update(a.id, { qty: 1 }, admin, { expectedVersion: 5 })).rejects.toMatchObject({ statusCode: 412, currentVersion: 1 });
    await expect(repo.update(a.id, { sku: 'B' }, admin)).rejects.toMatchObject({ statusCode: 409 });
    await expect(repo.update('nope', { qty: 1 }, admin)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repo.update(a.id, { qty: 1 }, admin, { expectedVersion: 1 })).resolves.toMatchObject({ version: 2 });
  });

  test('update sets trusted system fields', async () => {
    const { repo } = setup();
    const a = await repo.create({ name: 'A' }, admin);
    expect((await repo.update(a.id, {}, admin, { system: { state: 'done' } })).state).toBe('done');
  });

  test('concurrent updates are serialised per document', async () => {
    const { repo } = setup();
    const a = await repo.create({ name: 'A' }, admin);
    await Promise.all(Array.from({ length: 10 }, (_, i) => repo.update(a.id, { qty: i + 1 }, admin)));
    expect((await repo.get(a.id, admin)).version).toBe(11);
  });

  test('softDelete hides the document and frees unique values', async () => {
    const { repo, s } = setup();
    const a = await repo.create({ name: 'Anvil', sku: 'a' }, admin);
    const deleted = [];
    s.eventEmitter.on('cx.widget.deleted', (e) => deleted.push(e));
    await expect(repo.softDelete(a.id, admin, { expectedVersion: 9 })).rejects.toMatchObject({ statusCode: 412 });
    const d = await repo.softDelete(a.id, admin);
    expect(d.deletedAt).toEqual(expect.any(String));
    expect(deleted).toHaveLength(1);
    await expect(repo.get(a.id, admin)).rejects.toMatchObject({ statusCode: 404 });
    expect((await repo.get(a.id, admin, { includeDeleted: true })).id).toBe(a.id);
    await expect(repo.softDelete(a.id, admin)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repo.create({ name: 'Anvil two', sku: 'a' }, admin)).resolves.toBeTruthy();
    expect((await repo.list({ includeDeleted: true }, admin)).total).toBe(2);
    expect(await repo.searchText('anvil', admin)).toHaveLength(1);
  });

  test('hardDelete removes the document everywhere', async () => {
    const { repo, s, audit } = setup();
    const a = await repo.create({ name: 'A', sku: 'a' }, admin);
    const purged = [];
    s.eventEmitter.on('cx.widget.purged', (e) => purged.push(e));
    expect(await repo.hardDelete(a.id, admin)).toBe(true);
    expect(await repo.hardDelete(a.id, admin)).toBe(false);
    expect(await s.dataService.getByUuid('cx_widgets', a.id)).toBeNull();
    expect(await repo.findByIndex('sku', 'a', admin)).toEqual([]);
    expect(purged[0].subject.id).toBe(a.id);
    expect((await audit.list({ entityId: a.id, action: 'erase' }, admin)).items[0].changes)
      .toContainEqual({ op: 'remove', path: '/name', from: '[REDACTED]' });
    const b = await repo.create({ name: 'B' }, admin);
    await repo.softDelete(b.id, admin);
    expect(await repo.hardDelete(b.id, admin)).toBe(true);
  });

  test('list filters (coerced), sorts, paginates and narrows by index', async () => {
    const { repo, s } = setup();
    for (let i = 1; i <= 5; i++) {
      await repo.create({ name: `W${i}`, qty: i, status: i % 2 ? 'live' : 'draft', active: i < 4, owner: { team: i < 3 ? 'red' : 'blue' } }, admin);
    }
    await repo.create({ name: 'Other' }, otherTenant);
    const spy = jest.spyOn(s.dataService, 'listAll');
    const live = await repo.list({ filters: [{ field: 'status', op: 'eq', value: 'live' }], sort: [{ field: 'qty', dir: -1 }] }, viewer);
    expect(spy).not.toHaveBeenCalled();
    expect(live.items.map((w) => w.qty)).toEqual([5, 3, 1]);
    expect(live.items[0].name).toBe('W***');
    const page = await repo.list({ filters: [{ field: 'qty', op: 'gte', value: '2' }, { field: 'active', op: 'eq', value: 'true' }], limit: 1, offset: 1, sort: [{ field: 'qty', dir: 1 }], fields: ['qty'] }, admin);
    expect(page).toMatchObject({ total: 2, nextCursor: null, items: [{ qty: 3 }] });
    expect(Object.keys(page.items[0]).sort()).toEqual(['id', 'qty', 'version']);
    expect((await repo.list({ filters: [{ field: 'owner.team', op: 'eq', value: 'red' }] }, admin)).total).toBe(2);
    expect((await repo.list({ filters: [{ field: 'qty', op: 'in', value: ['1', '2'] }] }, admin)).total).toBe(2);
    expect((await repo.list({ filters: [{ field: 'extra.anything', op: 'exists', value: 'false' }] }, admin)).total).toBe(5);
    expect((await repo.list({ filters: [{ field: 'lines.code', op: 'exists', value: 'false' }] }, admin)).total).toBe(5);
    expect((await repo.list(undefined, admin)).total).toBe(5);
    expect(await repo.count(admin)).toBe(5);
    expect(await repo.count(otherTenant)).toBe(1);
  });

  test('list rejects unknown fields, operators and bad values', async () => {
    const { repo } = setup();
    await expect(repo.list({ filters: [{ field: 'nope', op: 'eq', value: 'x' }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ filters: [{ field: 'name.x', op: 'eq', value: 'x' }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ filters: [{ field: 'owner.nope', op: 'eq', value: 'x' }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ filters: [{ field: 'qty', op: 'zz', value: '1' }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ filters: [{ field: 'qty', op: 'eq', value: 'x' }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ filters: [{ field: 'active', op: 'eq', value: 'yes' }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ sort: [{ field: 'nope', dir: 1 }] }, admin)).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list({ fields: ['nope'] }, admin)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('findOne and findByIndex', async () => {
    const { repo } = setup();
    const a = await repo.create({ name: 'A', ns: 'crm', val: '42' }, admin);
    expect((await repo.findOne({ ns: 'crm', val: '42' }, admin)).id).toBe(a.id);
    expect(await repo.findOne({ ns: 'crm', val: '43' }, admin)).toBeNull();
    expect(await repo.findByIndex('identity', ['CRM', '42'], otherTenant)).toEqual([]);
  });

  test('searchText finds by search fields within the tenant', async () => {
    const { repo } = setup();
    await repo.create({ name: 'Copper bolt', sku: 'cb-1', tags: ['metal'] }, admin);
    await repo.create({ name: 'Copper pipe' }, otherTenant);
    const hits = await repo.searchText('copper', admin);
    expect(hits).toHaveLength(1);
    expect(hits[0].sku).toBe('cb-1');
    expect(await repo.searchText('', admin)).toEqual([]);
    expect(await repo.searchText('copper', admin, { limit: 0 })).toHaveLength(1);
  });

  test('search failures are logged, not thrown', async () => {
    const { repo, s } = setup();
    await repo.create({ name: 'Anvil' }, admin);
    jest.spyOn(s.search, 'search').mockRejectedValue(new Error('down'));
    jest.spyOn(s.search, 'add').mockRejectedValue(new Error('down'));
    jest.spyOn(s.search, 'remove').mockRejectedValue(new Error('down'));
    expect(await repo.searchText('anvil', admin)).toEqual([]);
    const b = await repo.create({ name: 'B' }, admin);
    await repo.softDelete(b.id, admin);
    expect(s.logger.calls.filter((c) => c.level === 'warn')).toHaveLength(3);
  });

  test('works without optional deps (events, audit, search)', async () => {
    const { s, counter } = setup();
    const repo = new BaseRepository(widget, { dataService: s.dataService, cache: s.cache, counter });
    const a = await repo.create({ name: 'A' }, admin);
    await repo.update(a.id, { qty: 2 }, admin);
    expect(await repo.searchText('A', admin)).toEqual([]);
    await repo.softDelete(a.id, admin);
    expect(await repo.hardDelete(a.id, admin)).toBe(true);
    expect(repo.container).toBe('cx_widgets');
  });

  test('init rebuilds indexes and search from stored documents', async () => {
    const { repo, deps, s } = setup();
    const a = await repo.create({ name: 'Anvil', sku: 'an' }, admin);
    const b = await repo.create({ name: 'Bucket', sku: 'bu' }, admin);
    await repo.softDelete(b.id, admin);
    // a fresh process: new cache and search, same data
    const fresh = createServices();
    const repo2 = new BaseRepository(widget, { ...deps, cache: fresh.cache, search: fresh.search });
    expect(await repo2.init()).toBe(1);
    expect((await repo2.findByIndex('sku', 'an', admin))[0].id).toBe(a.id);
    expect(await repo2.findByIndex('sku', 'bu', admin)).toEqual([]);
    expect(await repo2.searchText('anvil', admin)).toHaveLength(1);
    expect(s).toBeTruthy();
  });

  test('read-through document cache', async () => {
    const { repo, s } = setup({ cacheDocuments: true });
    const a = await repo.create({ name: 'A' }, admin);
    const spy = jest.spyOn(s.dataService, 'getByUuid');
    await repo.get(a.id, admin);
    expect(spy).not.toHaveBeenCalled();
    await repo.update(a.id, { qty: 3 }, admin);
    expect((await repo.get(a.id, admin)).qty).toBe(3);
    await s.cache.delete(`cx_widgets:doc:${a.id}`);
    expect((await repo.get(a.id, admin)).qty).toBe(3);
    expect(spy).toHaveBeenCalled();
    await repo.softDelete(a.id, admin);
    await repo.hardDelete(a.id, admin);
    expect(await s.cache.get(`cx_widgets:doc:${a.id}`)).toBeUndefined();
  });

  test('append-only entities refuse update and delete', async () => {
    const { deps } = setup();
    const repo = new BaseRepository(ledger, deps);
    const e = await repo.create({ amount: 5 }, admin);
    expect(repo.container).toBe('cx_entries');
    await expect(repo.update(e.id, { amount: 6 }, admin)).rejects.toMatchObject({ statusCode: 409 });
    await expect(repo.softDelete(e.id, admin)).rejects.toMatchObject({ statusCode: 409 });
  });
});
