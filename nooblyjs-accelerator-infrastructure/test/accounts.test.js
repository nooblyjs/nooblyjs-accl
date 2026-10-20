// Cloud accounts through the API (product.md §6.11, §7): an Owner connects one and account.connect runs on the mock
// cloud; what is sent is checked field by field; credentials never come back; refused credentials leave the account
// needing attention; and — roadmap phase 1's exit check — stopping the server in the middle of connecting and starting
// it again finishes the job without making anything twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, filesUnder } from './helpers.js';

const API = '/infrastructure/api/v1';
const GCP_KEY = { type: 'service_account', project_id: 'stevie-dev', private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n' };
const gcp = (over = {}) => ({ cloud: 'gcp', name: 'stevie-dev', projectId: 'stevie-dev-1', defaultRegion: 'europe-west2', credentials: JSON.stringify(GCP_KEY), ...over });
const aws = (over = {}) => ({ cloud: 'aws', name: 'stevie-staging', accountId: '123456789012', defaultRegion: 'eu-west-1', credentials: 'arn:aws:iam::123456789012:role/noobly-cloud\nexternal-id-7f3a9c', ...over });

async function everything(t) {
  const files = await filesUnder(t.dataDir);
  return (await Promise.all(files.map((f) => fs.readFile(path.join(t.dataDir, f), 'utf8')))).join('\n');
}

test('an Owner connects a GCP account: 202 at once, then account.connect makes its network on the mock cloud', async () => {
  const t = await startApp();
  try {
    const res = await t.post(`${API}/accounts`, { as: 'stevie', body: gcp() });
    assert.equal(res.status, 202);
    assert.deepEqual([res.json.account.id, res.json.account.state, res.json.account.provider], ['stevie-dev', 'connecting', 'mock']);
    assert.equal(res.json.operation.type, 'account.connect');
    await t.hosted.idle();

    const account = (await t.get(`${API}/accounts/stevie-dev`, { as: 'naledi-k' })).json;
    assert.deepEqual([account.state, account.stateText, account.regionLabel, account.identity], ['connected', 'Connected', 'europe-west2 · London', 'mock GCP project stevie-dev-1']);
    const op = (await t.get(`${API}/operations/${res.json.operation.id}`, { as: 'stevie' })).json;
    assert.deepEqual([op.status, op.steps.map((s) => s.status)], ['succeeded', ['done', 'done', 'done']]);

    const cloud = await t.hosted.mockCloud('stevie-dev');
    const networks = await cloud.resources((r) => r.kind === 'network');
    assert.equal(networks.length, 1);
    assert.equal(networks[0].region, 'europe-west2');
    assert.equal(networks[0].labels['managed-by'], 'noobly-cloud');
    assert.match(networks[0].labels['noobly-install'], /^nc-[0-9a-f]{8}$/);

    const status = await t.hosted.status();
    assert.deepEqual(status.card.pill, { text: '1 account connected', tone: 'success' });
    assert.deepEqual(status.card.items, [{ label: 'GCP · stevie-dev', value: 'Connected' }]);
    const activity = (await t.get(`${API}/activity`, { as: 'stevie' })).json.activity;
    assert.deepEqual(activity.map((a) => [a.verb, a.text, a.actor?.name]), [['Connected', 'GCP account stevie-dev', 'Stevie']]);
    assert.ok(t.auditLog.some((a) => a.actor === 'stevie' && a.action === `POST ${API}/accounts` && a.status === 202));
  } finally {
    await t.close();
  }
});

test('credentials never come back from the API, and are never kept in plaintext', async () => {
  const t = await startApp();
  try {
    const res = await t.post(`${API}/accounts`, { as: 'stevie', body: gcp() });
    await t.hosted.idle();
    const answers = [
      res.text,
      (await t.get(`${API}/accounts`, { as: 'stevie' })).text,
      (await t.get(`${API}/accounts/stevie-dev`, { as: 'stevie' })).text,
      (await t.get(`${API}/operations/${res.json.operation.id}`, { as: 'stevie' })).text,
    ];
    for (const text of answers) {
      assert.doesNotMatch(text, /PRIVATE KEY|MIIEvQ|credentialRef|sec_/);
    }
    assert.doesNotMatch(await everything(t), /MIIEvQ|BEGIN PRIVATE KEY/, 'nothing in the folder holds the key in plaintext');
  } finally {
    await t.close();
  }
});

test('what is sent is checked field by field (422), and nothing is written', async () => {
  const t = await startApp({ seed: true });
  try {
    for (const [body, fields] of [
      [gcp({ name: 'Stevie Dev' }), ['name']],
      [gcp({ name: 'stevie-prod' }), ['name']],
      [gcp({ projectId: 'x' }), ['projectId']],
      [gcp({ defaultRegion: 'af-south-1' }), ['defaultRegion']],
      [gcp({ credentials: '   ' }), ['credentials']],
      [gcp({ credentials: 'x'.repeat(20_001) }), ['credentials']],
      [aws({ accountId: '1234' }), ['accountId']],
      [{ cloud: 'azure', name: 'nope' }, ['cloud', 'credentials']],
    ]) {
      const res = await t.post(`${API}/accounts`, { as: 'stevie', body });
      assert.equal(res.status, 422, JSON.stringify(body).slice(0, 80));
      assert.equal(res.json.error.code, 'invalid');
      assert.deepEqual(Object.keys(res.json.error.details.fields).sort(), fields.sort(), JSON.stringify(res.json.error.details.fields));
    }
    assert.deepEqual((await t.get(`${API}/accounts`, { as: 'stevie' })).json.accounts.map((a) => a.id), ['stevie-prod', 'stevie-aws']);
    const ok = await t.post(`${API}/accounts`, { as: 'stevie', body: aws() });
    assert.equal(ok.status, 202);
    assert.equal(ok.json.account.label, 'stevie-staging · 9012');
  } finally {
    await t.close();
  }
});

test('only an Owner connects, changes or removes accounts, and never an agent; refusals are audited', async () => {
  const t = await startApp({ seed: true });
  try {
    const contributor = await t.post(`${API}/accounts`, { as: 'priya-s', body: gcp() });
    assert.equal(contributor.status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'change-guardrails'));
    const agent = await t.post(`${API}/accounts`, { as: 'ada-quill', body: gcp() });
    assert.deepEqual([agent.status, agent.json.error.code], [403, 'people_only']);
    assert.equal((await t.put(`${API}/accounts/stevie-prod`, { as: 'priya-s', body: {} })).status, 404, 'no PUT route');
    const patch = await fetch(`${t.base}${API}/accounts/stevie-prod`, { method: 'PATCH', headers: { 'x-dev-person': 'priya-s', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(patch.status, 403);
    const del = await fetch(`${t.base}${API}/accounts/stevie-prod`, { method: 'DELETE', headers: { 'x-dev-person': 'lerato-m', 'content-type': 'application/json' }, body: '{"confirm":"stevie-prod"}' });
    assert.equal(del.status, 403, 'an Approver may not remove an account');
    assert.equal((await t.get(`${API}/accounts`, { as: 'naledi-k' })).status, 200, 'anyone may look');
    assert.equal((await t.post(`${API}/accounts/stevie-prod/verify`, { as: 'naledi-k' })).status, 403, 'a Viewer may not check');
    assert.equal((await t.post(`${API}/accounts/stevie-prod/verify`, { as: 'priya-s' })).status, 200, 'a Contributor may');
  } finally {
    await t.close();
  }
});

test('refused credentials: the connect fails at "Check the credentials" and the account needs attention', async () => {
  const t = await startApp();
  try {
    const res = await t.post(`${API}/accounts`, { as: 'stevie', body: gcp({ credentials: 'an invalid key' }) });
    await t.hosted.idle();
    const account = (await t.get(`${API}/accounts/stevie-dev`, { as: 'stevie' })).json;
    assert.deepEqual([account.state, account.stateText, account.stateMessage], ['needs-attention', 'Needs attention', 'The mock cloud refused these credentials.']);
    const op = (await t.get(`${API}/operations/${res.json.operation.id}`, { as: 'stevie' })).json;
    assert.deepEqual([op.status, op.error.step, op.retryable], ['failed', 'verify', true]);
    assert.deepEqual((await t.hosted.status()).card.pill, { text: '1 needs attention', tone: 'danger' });
    const activity = (await t.get(`${API}/activity`, { as: 'stevie' })).json.activity.map((a) => a.verb);
    assert.ok(activity.includes('Attention') && activity.includes('Failed'));
  } finally {
    await t.close();
  }
});

test('new credentials replace the old (whose secret is removed) and the account is checked again', async () => {
  const t = await startApp();
  try {
    await t.post(`${API}/accounts`, { as: 'stevie', body: gcp({ credentials: 'an invalid key' }) });
    await t.hosted.idle();
    const before = (await filesUnder(t.dataDir)).filter((f) => /^secrets\/sec_/.test(f));
    const res = await fetch(`${t.base}${API}/accounts/stevie-dev`, {
      method: 'PATCH', headers: { 'x-dev-person': 'stevie', 'content-type': 'application/json' }, body: JSON.stringify({ credentials: JSON.stringify(GCP_KEY), defaultRegion: 'us-central1' }),
    });
    const account = await res.json();
    assert.deepEqual([res.status, account.state, account.defaultRegion], [200, 'connected', 'us-central1']);
    const after = (await filesUnder(t.dataDir)).filter((f) => /^secrets\/sec_/.test(f));
    assert.equal(after.length, 1);
    assert.notDeepEqual(after, before, 'the old secret is gone');
  } finally {
    await t.close();
  }
});

test('removing: the name must be typed; an account with resources stays; an empty one goes, with its secret', async () => {
  const t = await startApp({ seed: true });
  try {
    const del = (id, body) => fetch(`${t.base}${API}/accounts/${id}`, { method: 'DELETE', headers: { 'x-dev-person': 'stevie', 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
    assert.equal((await del('stevie-prod', {})).status, 422);
    const busy = await del('stevie-prod', { confirm: 'stevie-prod' });
    assert.equal(busy.status, 409);
    assert.match(busy.json.error.message, /still has 7 resources/);

    await t.post(`${API}/accounts`, { as: 'stevie', body: aws() });
    await t.hosted.idle();
    const secretsBefore = (await filesUnder(t.dataDir)).filter((f) => /^secrets\/sec_/.test(f)).length;
    const gone = await del('stevie-staging', { confirm: 'stevie-staging' });
    assert.deepEqual([gone.status, gone.json], [200, { removed: 'stevie-staging' }]);
    assert.equal((await t.get(`${API}/accounts/stevie-staging`, { as: 'stevie' })).status, 404);
    assert.equal((await filesUnder(t.dataDir)).filter((f) => /^secrets\/sec_/.test(f)).length, secretsBefore - 1);
    assert.equal((await del('stevie-staging', { confirm: 'stevie-staging' })).status, 404);
  } finally {
    await t.close();
  }
});

test('exit check: stopping the server mid-connect and starting it again finishes the job, with one network', async () => {
  // A slow mock cloud: the network takes 2 × 300 ms, so the server can be stopped while it is being made.
  const first = await startApp({ mockStepMs: 300 });
  const snapshot = await fs.mkdtemp(path.join(path.dirname(first.rootDir), 'nooblyjs-accelerator-infrastructure-copy-'));
  try {
    const { json } = await first.post(`${API}/accounts`, { as: 'stevie', body: gcp() });
    const id = json.operation.id;
    let op;
    for (let i = 0; i < 200; i++) {
      op = (await first.get(`${API}/operations/${id}`, { as: 'stevie' })).json;
      if (op.steps[1].status === 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(op.steps[1].status, 'running', 'caught while the network is being made');
    await first.hosted.close();
    const stopped = (await first.get(`${API}/operations/${id}`, { as: 'stevie' })).json;
    assert.equal(stopped.status, 'running', 'still running on disk');
    await fs.cp(first.dataDir, snapshot, { recursive: true });
    await first.close();

    const second = await startApp({ mockStepMs: 300, before: (dir) => fs.cp(snapshot, dir, { recursive: true }) });
    try {
      await second.hosted.idle();
      const done = (await second.get(`${API}/operations/${id}`, { as: 'stevie' })).json;
      assert.deepEqual([done.status, done.steps.map((s) => s.status)], ['succeeded', ['done', 'done', 'done']]);
      assert.ok(done.log.some((l) => /Stopped with the server during "Prepare the network"/.test(l.text)));
      assert.equal((await second.get(`${API}/accounts/stevie-dev`, { as: 'stevie' })).json.state, 'connected');
      const networks = await (await second.hosted.mockCloud('stevie-dev')).resources((r) => r.kind === 'network');
      assert.equal(networks.length, 1, 'no duplicate network');
      assert.equal(networks[0].status, 'ready');
    } finally {
      await second.close();
    }
  } finally {
    await fs.rm(snapshot, { recursive: true, force: true });
  }
});
