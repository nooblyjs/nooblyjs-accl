// The launcher contract (architecture.md §3): the accelerator mounts once under its path, never listens, signs people
// in with the launcher, refuses with an audit record, writes only inside its own folder, and a bad start mounts
// nothing. Every test runs on Express 5 and again on Express 4 (npm test runs both).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, filesUnder, FALLBACK } from './helpers.js';
import { EXPRESS_MAJOR } from './fixtures/host.js';
import { enabledProviders } from '../index.js';

const API = '/infrastructure/api/v1';

test(`register() mounts the API under the mount path and describes itself (Express ${EXPRESS_MAJOR})`, async () => {
  const t = await startApp();
  try {
    assert.equal(t.registerError, null);
    const about = await t.get(`${API}/about`, { as: 'naledi-k' });
    assert.equal(about.status, 200);
    assert.deepEqual({ name: about.json.name, mountPath: about.json.mountPath, providers: about.json.providers }, { name: 'infrastructure', mountPath: '/infrastructure', providers: ['mock'] });
    assert.match(about.json.version, /^\d+\.\d+\.\d+$/);
    for (const key of ['name', 'label', 'title', 'icon', 'mountPath', 'ui', 'nav', 'status', 'services', 'seed', 'close', 'idle']) assert.ok(t.hosted[key], key);
  } finally {
    await t.close();
  }
});

test('the accelerator works under another mount path, and leaves everything else to the launcher', async () => {
  const t = await startApp({ mountPath: '/cloud' });
  try {
    assert.equal((await t.get('/cloud/api/v1/about', { as: 'stevie' })).json.mountPath, '/cloud');
    assert.equal((await t.get('/infrastructure/api/v1/about', { as: 'stevie' })).text, FALLBACK);
    assert.equal((await t.get('/somewhere-else', { as: 'stevie' })).text, FALLBACK);
  } finally {
    await t.close();
  }
});

test('the API is signed-in only, and unknown routes and bad bodies use the one error shape', async () => {
  const t = await startApp();
  try {
    const signedOut = await t.get(`${API}/summary`);
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.json.error.code, 'unauthenticated');
    const missing = await t.get(`${API}/nope`, { as: 'stevie' });
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.json.error).sort(), ['code', 'message']);
    const badJson = await t.post(`${API}/seed`, { as: 'stevie', body: '{not json', headers: { 'content-type': 'application/json' } });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error.code, 'bad_request');
  } finally {
    await t.close();
  }
});

test('a role without the permission gets 403 and the refusal is audited; every write is audited', async () => {
  const t = await startApp();
  try {
    const refused = await t.post(`${API}/seed`, { as: 'priya-s', body: { reset: true } });
    assert.equal(refused.status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'change-guardrails'));
    const before = t.auditLog.length;
    assert.equal((await t.post(`${API}/seed`, { as: 'stevie', body: { reset: true } })).status, 201);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(t.auditLog.slice(before).some((a) => a.actor === 'stevie' && a.action === `POST ${API}/seed` && a.status === 201));
  } finally {
    await t.close();
  }
});

test('an error inside an async route reaches the error handler, in the error shape, on Express 4 and 5', async () => {
  const broken = (host) => ({ ...host, store: { ...host.store, readYaml: async () => { throw new Error('disk on fire'); } } });
  const t = await startApp({ changeHost: broken });
  try {
    const res = await t.post(`${API}/seed`, { as: 'stevie', body: {} });
    assert.equal(res.status, 500);
    assert.equal(res.json.error.code, 'internal_error');
    assert.doesNotMatch(res.text, /disk on fire/, 'a server fault never leaks its message');
    assert.ok(t.serverManager.lines.some((l) => l.level === 'error' && /disk on fire/.test(l.message)), 'and it is logged');
  } finally {
    await t.close();
  }
});

test('everything is written inside the accelerator\'s own folder', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.post(`${API}/seed`, { as: 'stevie', body: { reset: true } });
    const all = await filesUnder(t.rootDir);
    assert.ok(all.includes('infrastructure/seed.yaml'));
    assert.deepEqual(all.filter((f) => !f.startsWith('infrastructure/')), []);
  } finally {
    await t.close();
  }
});

test('a bad start throws before anything is mounted', async () => {
  for (const [why, options] of [
    ['a host without events', { changeHost: (h) => ({ ...h, events: undefined }) }],
    ['a host without a frame', { changeHost: (h) => ({ ...h, frame: undefined }) }],
    ['a serverManager nobody initialised', { serverManager: { initialized: false } }],
    ['a mount path that is not a path', { mountPath: 'infrastructure' }],
  ]) {
    const t = await startApp(options).catch((err) => ({ registerError: err, close: async () => {} }));
    try {
      assert.ok(t.registerError, why);
      if (t.get) assert.equal((await t.get(`${API}/about`, { as: 'stevie' })).text, FALLBACK, why);
    } finally {
      await t.close();
    }
  }
});

test('INFRA_PROVIDERS names the clouds this install may use, and an unknown one stops the start', async () => {
  assert.deepEqual(enabledProviders(undefined), ['mock']);
  assert.deepEqual(enabledProviders(' mock, gcp,aws,gcp '), ['mock', 'gcp', 'aws']);
  assert.throws(() => enabledProviders('mock,azure'), /not azure/);
  const saved = process.env.INFRA_PROVIDERS;
  process.env.INFRA_PROVIDERS = 'azure';
  try {
    const t = await startApp();
    try {
      assert.match(t.registerError?.message ?? '', /INFRA_PROVIDERS/);
      assert.equal((await t.get(`${API}/about`, { as: 'stevie' })).text, FALLBACK);
    } finally {
      await t.close();
    }
  } finally {
    if (saved === undefined) delete process.env.INFRA_PROVIDERS;
    else process.env.INFRA_PROVIDERS = saved;
  }
});

test('the accelerator never initialises the serverManager, and uses the launcher\'s logging', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(t.serverManager.calls.map((c) => `${c.service}:${c.instanceName}`), ['logging:infrastructure']);
  } finally {
    await t.close();
  }
});

test('seeding is idempotent, and a reset empties the folder and writes the story again', async () => {
  const t = await startApp();
  try {
    const marker = path.join(t.dataDir, 'seed.yaml');
    const notes = path.join(t.dataDir, 'notes.md');
    await t.hosted.seed({ reset: false });
    const first = await fs.readFile(marker, 'utf8');
    assert.match(first, /story: noobly-cloud/);
    await fs.writeFile(notes, 'written by hand\n');
    await t.hosted.seed({ reset: false });
    assert.equal(await fs.readFile(marker, 'utf8'), first, 'an already seeded folder is left alone');
    assert.equal(await fs.readFile(notes, 'utf8'), 'written by hand\n');
    await t.hosted.seed({ reset: true });
    await assert.rejects(fs.readFile(notes, 'utf8'), { code: 'ENOENT' });
    assert.match(await fs.readFile(marker, 'utf8'), /story: noobly-cloud/);
  } finally {
    await t.close();
  }
});
