// Keeping records current (architecture.md §8): the inventory sync makes the records agree with the cloud — a change
// made in the console wins, a resource that vanished is marked missing (said once, never deleted), and anything with
// an operation under way is left to it — and the account check notices refused credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { createJobs } from '../src/services/jobs.js';

const API = '/infrastructure/api/v1';
const kinds = (t, type) => t.eventLog.filter((e) => e.type === type);

test('a freshly seeded install agrees with its mock cloud: the sync and the check find nothing to say', async () => {
  const t = await startApp({ seed: true });
  try {
    const before = t.eventLog.length;
    await t.hosted.runJob('inventory');
    await t.hosted.runJob('account-check');
    assert.deepEqual(t.eventLog.slice(before).map((e) => e.type), []);
  } finally {
    await t.close();
  }
});

test('a VM stopped in the cloud console shows as stopped, and says it was changed outside Noobly Cloud', async () => {
  const t = await startApp({ seed: true });
  try {
    const cloud = await t.hosted.mockCloud('stevie-prod');
    await cloud.outOfBand('vm-seedweb01', { status: 'stopped' });
    await t.hosted.runJob('inventory');
    const changed = kinds(t, 'infrastructure.resource.changed');
    assert.equal(changed.length, 1);
    assert.deepEqual([changed[0].payload.resource, changed[0].payload.status, changed[0].payload.was], [{ type: 'vm', name: 'web-01' }, 'stopped', 'running']);
    const s = (await t.get(`${API}/summary`, { as: 'stevie' })).json;
    assert.equal(s.totals.vms.text, '2 running · 2 stopped · 1 starting');
    assert.ok(s.endpoints.filter((e) => e.vm === 'web-01').every((e) => e.text === 'VM stopped'));
    assert.match((await t.get(`${API}/activity?limit=1`, { as: 'stevie' })).json.activity[0].text, /VM web-01 is stopped in GCP, changed outside Noobly Cloud/);
  } finally {
    await t.close();
  }
});

test('a database deleted in the console is marked missing, said once, and never deleted from the records', async () => {
  const t = await startApp({ seed: true });
  try {
    await (await t.hosted.mockCloud('stevie-aws')).outOfBand('db-seedorders', null);
    await t.hosted.runJob('inventory');
    await t.hosted.runJob('inventory');
    const missing = kinds(t, 'infrastructure.resource.missing');
    assert.equal(missing.length, 1, 'said once');
    assert.deepEqual(missing[0].payload.resource, { type: 'database', name: 'orders-db' });
    const s = (await t.get(`${API}/summary`, { as: 'stevie' })).json;
    assert.equal(s.totals.databases.count, 3, 'still in the records');
  } finally {
    await t.close();
  }
});

test('a MongoDB database is as available as its VM', async () => {
  const t = await startApp({ seed: true });
  try {
    await (await t.hosted.mockCloud('stevie-prod')).outOfBand('vm-seedcat01', { status: 'stopped' });
    await t.hosted.runJob('inventory');
    const changed = kinds(t, 'infrastructure.resource.changed').map((e) => [e.payload.resource.name, e.payload.status]);
    assert.deepEqual(changed.sort(), [['catalog', 'stopped'], ['catalog-db', 'stopped']]);
  } finally {
    await t.close();
  }
});

test('a resource with an operation under way is left to its operation', async () => {
  const t = await startApp({ seed: true });
  try {
    // docs-01 is being launched (the seed's op_seedlaunch): the cloud says running, the operation hasn't finished.
    await (await t.hosted.mockCloud('stevie-prod')).outOfBand('vm-seeddoc01', { status: 'running' });
    await t.hosted.runJob('inventory');
    assert.deepEqual(kinds(t, 'infrastructure.resource.changed'), []);
    assert.equal((await t.get(`${API}/summary`, { as: 'stevie' })).json.totals.vms.text, '3 running · 1 stopped · 1 starting');
  } finally {
    await t.close();
  }
});

test('the account check: refused credentials need attention (said once); accepted again, connected again', async () => {
  const t = await startApp({ seed: true });
  try {
    const cloud = await t.hosted.mockCloud('stevie-aws');
    cloud.failAt('account.verify', { once: false, code: 'permission', message: 'The role can no longer be assumed.' });
    await t.hosted.runJob('account-check');
    await t.hosted.runJob('account-check');
    assert.equal(kinds(t, 'infrastructure.account.needs_attention').length, 1);
    const account = (await t.get(`${API}/accounts/stevie-aws`, { as: 'stevie' })).json;
    assert.deepEqual([account.state, account.stateMessage], ['needs-attention', 'The role can no longer be assumed.']);
    assert.deepEqual((await t.hosted.status()).card.pill, { text: '1 needs attention', tone: 'danger' });
    // While it needs attention the sync leaves its resources alone.
    await cloud.outOfBand('db-seedorders', null);
    await t.hosted.runJob('inventory');
    assert.deepEqual(kinds(t, 'infrastructure.resource.missing'), []);
    cloud.failures.length = 0;
    await t.hosted.runJob('account-check');
    assert.equal((await t.get(`${API}/accounts/stevie-aws`, { as: 'stevie' })).json.state, 'connected');
    assert.equal(kinds(t, 'infrastructure.account.connected').length, 1);
  } finally {
    await t.close();
  }
});

test('jobs: a job runs when due by the launcher\'s clock, never two at once, and a failing job is logged, not thrown', async () => {
  let clock = 0;
  const ran = [];
  const warnings = [];
  const jobs = createJobs({
    now: () => clock,
    log: { warn: (m) => warnings.push(m) },
    checkEveryMs: 0,
    jobs: [
      { name: 'often', every: 1000, run: async () => ran.push(`often@${clock}`) },
      { name: 'busy', every: async () => (clock < 5000 ? 2000 : 60_000), run: async () => ran.push(`busy@${clock}`) },
      { name: 'broken', every: 1000, run: async () => { throw new Error('boom'); } },
    ],
  });
  await jobs.tick();
  clock = 500;
  await Promise.all([jobs.tick(), jobs.tick()]);
  clock = 2000;
  await jobs.tick();
  clock = 6000;
  await jobs.tick();
  clock = 7000;
  await jobs.tick();
  assert.deepEqual(ran, ['often@0', 'busy@0', 'often@2000', 'busy@2000', 'often@6000', 'often@7000']);
  assert.equal(warnings.length, 4);
  await jobs.run('busy');
  assert.equal(ran.at(-1), 'busy@7000');
  await jobs.close();
});

test('the seed story has three operations under way, of types later phases run, which the sync leaves alone', async () => {
  const t = await startApp({ seed: true });
  try {
    // The seed has three operations under way (a launch, a build, a backup).
    const ops = (await t.get(`${API}/operations?status=active`, { as: 'stevie' })).json.operations;
    assert.deepEqual(ops.map((o) => o.type).sort(), ['app.deploy', 'db.backup', 'vm.launch']);
  } finally {
    await t.close();
  }
});
