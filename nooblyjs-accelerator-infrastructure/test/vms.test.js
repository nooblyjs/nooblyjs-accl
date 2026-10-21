// Virtual machines through the API on the mock cloud (product.md §6.2–6.4, §7; roadmap phase 2): launch, stop,
// start, restart and delete as operations; what is sent checked field by field; who may do what; cancel undoes a
// half-made launch; a failure says why and retries; health; SSH keys; and the cost of a VM stopped mid-month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM8i7cX0d4qT2bL5vWk9yH3nP6rS1eJ0aU8fG4hQ2mZx priya@laptop';
const spec = (over = {}) => ({
  account: 'stevie-prod', name: 'web-02', region: 'africa-south1', zone: 'africa-south1-a', size: 'medium',
  image: 'ubuntu-2404-lts', diskGb: 30, docker: true, sshKeyId: 'key_seedmacbook', sshFrom: 'my-ip', ...over,
});
const send = (t, method, url, as, body) => fetch(`${t.base}${url}`, {
  method, headers: { 'x-dev-person': as, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json() }));
const resources = async (t, account, name) => (await t.hosted.mockCloud(account)).resources((r) => r.labels?.['noobly-name'] === name);

test('a Contributor launches a VM: 202 Starting, then three steps on the mock cloud, and it is Running', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.post(`${API}/vms`, { as: 'priya-s', body: spec() });
    assert.equal(res.status, 202);
    assert.deepEqual([res.json.vm.name, res.json.vm.status, res.json.operation.type], ['web-02', 'starting', 'vm.launch']);
    await t.hosted.idle();
    const vm = (await t.get(`${API}/vms/web-02`, { as: 'naledi-k' })).json;
    assert.deepEqual([vm.statusText, vm.size, vm.image, vm.runtime, vm.ports, vm.estimate.monthly], ['Running', '2 vCPU · 4 GB', 'Ubuntu 24.04 LTS', 'Docker 27', '22 (my IP only)', 30.04]);
    assert.match(vm.sshCommand, /^ssh ubuntu@\d+\.\d+\.\d+\.\d+$/);
    assert.equal(vm.staticIp, true);
    const op = (await t.get(`${API}/operations/${res.json.operation.id}`, { as: 'stevie' })).json;
    assert.deepEqual(op.steps.map((s) => s.status), ['done', 'done', 'skipped']);

    const made = await resources(t, 'stevie-prod', 'web-02');
    assert.deepEqual(made.map((r) => r.kind).sort(), ['address', 'vm']);
    const cloudVm = made.find((r) => r.kind === 'vm');
    assert.equal(cloudVm.publicIp, made.find((r) => r.kind === 'address').address, 'the VM has its static address');
    assert.deepEqual(cloudVm.firewall, [{ port: 22, from: '127.0.0.1/32', why: 'ssh' }], 'SSH from the person\'s address only');
    const userData = JSON.parse(cloudVm.userData.slice('#cloud-config\n'.length));
    assert.match(userData.ssh_authorized_keys[0], /^ssh-ed25519 .* stevie@macbook$/);
    assert.match(userData.users[1].ssh_authorized_keys[0], /^ssh-ed25519 \S+ noobly-cloud nc-seed01$/, 'the install\'s control key');

    const activity = (await t.get(`${API}/activity?kind=vm&limit=2`, { as: 'stevie' })).json.activity.map((a) => [a.verb, a.actor?.name]);
    assert.deepEqual(activity, [['Ready', 'Priya S.'], ['Created', 'Priya S.']]);
  } finally {
    await t.close();
  }
});

test('the control key is made once, kept as a secret, and its private half is never in an answer or a plain file', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.post(`${API}/vms`, { as: 'priya-s', body: spec() });
    await t.post(`${API}/vms`, { as: 'priya-s', body: spec({ name: 'web-03' }) });
    await t.hosted.idle();
    const keys = new Set();
    for (const name of ['web-02', 'web-03']) {
      const vm = (await resources(t, 'stevie-prod', name)).find((r) => r.kind === 'vm');
      keys.add(JSON.parse(vm.userData.slice(14)).users[1].ssh_authorized_keys[0]);
    }
    assert.equal(keys.size, 1, 'one control key for the install');
    for (const url of [`${API}/vms/web-02`, `${API}/vms`, `${API}/ssh-keys`]) {
      assert.doesNotMatch((await t.get(url, { as: 'stevie' })).text, /PRIVATE KEY/);
    }
  } finally {
    await t.close();
  }
});

test('what is sent is checked field by field (422), and nothing is made', async () => {
  const t = await startApp({ seed: true });
  try {
    for (const [body, fields] of [
      [spec({ name: 'web-01' }), ['name']],
      [spec({ name: 'Web 2' }), ['name']],
      [spec({ account: 'nobody' }), ['account']],
      [spec({ region: 'af-south-1' }), ['region']],
      [spec({ zone: 'europe-west2-a' }), ['zone']],
      [spec({ size: 'huge' }), ['size']],
      [spec({ size: 'custom', machineType: 'n2-huge' }), ['machineType']],
      [spec({ image: 'windows-2022' }), ['image']],
      [spec({ diskGb: 5 }), ['diskGb']],
      [spec({ diskGb: 30.5 }), ['diskGb']],
      [spec({ sshKeyId: '' }), ['sshKeyId']],
      [spec({ sshKeyId: 'key_nothere' }), ['sshKeyId']],
      [spec({ sshFrom: 'custom', sshCidr: '10.0.0.0/33' }), ['sshCidr']],
      [spec({ sshFrom: 'somewhere' }), ['sshFrom']],
    ]) {
      const res = await t.post(`${API}/vms`, { as: 'stevie', body });
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.deepEqual(Object.keys(res.json.error.details.fields).sort(), fields, JSON.stringify(res.json.error.details.fields));
    }
    const custom = await t.post(`${API}/vms`, { as: 'stevie', body: spec({ size: 'custom', machineType: 'e2-standard-2', sshFrom: 'custom', sshCidr: '196.25.1.0/24' }) });
    assert.equal(custom.status, 202);
    await t.hosted.idle();
    const vm = (await resources(t, 'stevie-prod', 'web-02')).find((r) => r.kind === 'vm');
    assert.equal(vm.machineType, 'e2-standard-2');
    assert.deepEqual(vm.firewall.map((r) => r.from), ['196.25.1.0/24']);
    // An account that needs attention can't take new VMs.
    (await t.hosted.mockCloud('stevie-aws')).failAt('account.verify', { once: false, message: 'Refused.' });
    await t.hosted.runJob('account-check');
    const refused = await t.post(`${API}/vms`, { as: 'stevie', body: spec({ account: 'stevie-aws', name: 'api-02', region: 'af-south-1', zone: 'af-south-1a' }) });
    assert.match(refused.json.error.details.fields.account, /needs attention/);
  } finally {
    await t.close();
  }
});

test('a pasted public key is saved and used; a pasted private key is refused', async () => {
  const t = await startApp({ seed: true });
  try {
    const bad = await t.post(`${API}/vms`, { as: 'priya-s', body: spec({ sshKeyId: '', publicKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn' }) });
    assert.deepEqual([bad.status, Object.keys(bad.json.error.details.fields)], [422, ['publicKey']]);
    const ok = await t.post(`${API}/vms`, { as: 'priya-s', body: spec({ sshKeyId: '', publicKey: PUBLIC_KEY, keyName: 'priya-laptop' }) });
    assert.equal(ok.status, 202);
    await t.hosted.idle();
    const keys = (await t.get(`${API}/ssh-keys`, { as: 'priya-s' })).json.keys;
    const saved = keys.find((k) => k.name === 'priya-laptop');
    assert.deepEqual([saved.type, saved.usedBy], ['ed25519', ['web-02']]);
    assert.match(saved.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  } finally {
    await t.close();
  }
});

test('SSH from anywhere is for a person who may approve; launch, stop and start are for Contributors', async () => {
  const t = await startApp({ seed: true });
  try {
    const contributor = await t.post(`${API}/vms`, { as: 'priya-s', body: spec({ sshFrom: 'anywhere' }) });
    assert.equal(contributor.status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'approve'));
    const agent = await t.post(`${API}/vms`, { as: 'ada-quill', body: spec({ sshFrom: 'anywhere' }) });
    assert.equal(agent.json.error.code, 'people_only');
    assert.equal((await t.post(`${API}/vms`, { as: 'naledi-k', body: spec() })).status, 403, 'a Viewer may not launch');
    const approver = await t.post(`${API}/vms`, { as: 'lerato-m', body: spec({ sshFrom: 'anywhere' }) });
    assert.equal(approver.status, 202);
    await t.hosted.idle();
    assert.deepEqual((await resources(t, 'stevie-prod', 'web-02')).find((r) => r.kind === 'vm').firewall.map((r) => r.from), ['0.0.0.0/0']);
    assert.equal((await t.post(`${API}/vms/web-02/stop`, { as: 'naledi-k' })).status, 403);
  } finally {
    await t.close();
  }
});

test('stop, start and restart move the VM through its states; the wrong state or a busy VM is a 409', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.post(`${API}/vms/staging-01/stop`, { as: 'priya-s' })).status, 409, 'already stopped');
    assert.equal((await t.post(`${API}/vms/docs-01/stop`, { as: 'priya-s' })).status, 409, 'busy launching');
    assert.equal((await t.post(`${API}/vms/catalog-db/stop`, { as: 'stevie' })).status, 409, 'a database VM is stopped from Databases');
    assert.equal((await t.post(`${API}/vms/nobody/stop`, { as: 'stevie' })).status, 404);

    const start = await t.post(`${API}/vms/staging-01/start`, { as: 'priya-s' });
    assert.equal(start.status, 202);
    assert.equal((await t.get(`${API}/vms/staging-01`, { as: 'priya-s' })).json.status, 'starting');
    assert.equal((await t.post(`${API}/vms/staging-01/start`, { as: 'priya-s' })).status, 409, 'busy starting');
    await t.hosted.idle();
    assert.equal((await t.get(`${API}/vms/staging-01`, { as: 'priya-s' })).json.statusText, 'Running');
    await t.post(`${API}/vms/staging-01/restart`, { as: 'priya-s' });
    await t.hosted.idle();
    await t.post(`${API}/vms/staging-01/stop`, { as: 'priya-s' });
    await t.hosted.idle();
    const vm = (await t.get(`${API}/vms/staging-01`, { as: 'priya-s' })).json;
    assert.deepEqual([vm.statusText, vm.estimate.note], ['Stopped', 'disk only']);
    const verbs = (await t.get(`${API}/activity?kind=vm&limit=3`, { as: 'stevie' })).json.activity.map((a) => a.verb);
    assert.deepEqual(verbs, ['Stopped', 'Restarted', 'Started']);
  } finally {
    await t.close();
  }
});

test('delete: a person who may approve, typing the name; never a VM with apps; nothing left in the cloud', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await send(t, 'DELETE', `${API}/vms/web-01`, 'priya-s', { confirm: 'web-01' })).status, 403);
    assert.equal((await send(t, 'DELETE', `${API}/vms/web-01`, 'ada-quill', { confirm: 'web-01' })).json.error.code, 'people_only');
    const withApps = await send(t, 'DELETE', `${API}/vms/web-01`, 'stevie', { confirm: 'web-01' });
    assert.equal(withApps.status, 409);
    assert.match(withApps.json.error.message, /runs blog, storefront/);

    await t.post(`${API}/vms`, { as: 'stevie', body: spec() });
    await t.hosted.idle();
    assert.equal((await send(t, 'DELETE', `${API}/vms/web-02`, 'stevie', {})).status, 422, 'the name must be typed');
    const del = await send(t, 'DELETE', `${API}/vms/web-02`, 'lerato-m', { confirm: 'web-02' });
    assert.equal(del.status, 202);
    await t.hosted.idle();
    assert.equal((await t.get(`${API}/vms/web-02`, { as: 'stevie' })).status, 404);
    assert.deepEqual(await resources(t, 'stevie-prod', 'web-02'), [], 'machine and address gone');
    assert.equal((await t.get(`${API}/activity?kind=vm&limit=1`, { as: 'stevie' })).json.activity[0].verb, 'Deleted');
  } finally {
    await t.close();
  }
});

test('cancelling a launch half-way deletes what it made, and the VM never was', async () => {
  const t = await startApp({ seed: true, mockStepMs: 150 });
  try {
    const { json } = await t.post(`${API}/vms`, { as: 'priya-s', body: spec() });
    for (let i = 0; i < 100; i++) {
      if ((await resources(t, 'stevie-prod', 'web-02')).some((r) => r.kind === 'vm')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const cancelled = await t.post(`${API}/operations/${json.operation.id}/cancel`, { as: 'priya-s' });
    assert.equal(cancelled.json.status, 'cancelled');
    await t.hosted.idle();
    assert.equal((await t.get(`${API}/vms/web-02`, { as: 'stevie' })).status, 404);
    const left = (await resources(t, 'stevie-prod', 'web-02')).filter((r) => r.status !== 'deleting');
    assert.deepEqual(left, [], 'no machine and no address left behind');
  } finally {
    await t.close();
  }
});

test('a launch the cloud refuses fails in words, and a retry finishes it without a second machine', async () => {
  const t = await startApp({ seed: true });
  try {
    (await t.hosted.mockCloud('stevie-prod')).failAt('compute.create', { code: 'quota', message: 'The project has no more CPUs in africa-south1.' });
    const { json } = await t.post(`${API}/vms`, { as: 'priya-s', body: spec() });
    await t.hosted.idle();
    let vm = (await t.get(`${API}/vms/web-02`, { as: 'stevie' })).json;
    assert.deepEqual([vm.statusText, vm.failure], ['Failed', 'The project has no more CPUs in africa-south1.']);
    const retry = await t.post(`${API}/operations/${json.operation.id}/retry`, { as: 'priya-s' });
    assert.equal(retry.status, 202);
    await t.hosted.idle();
    vm = (await t.get(`${API}/vms/web-02`, { as: 'stevie' })).json;
    assert.deepEqual([vm.statusText, vm.failure], ['Running', null]);
    const made = await resources(t, 'stevie-prod', 'web-02');
    assert.deepEqual(made.map((r) => r.kind).sort(), ['address', 'vm'], 'one address, one machine');
  } finally {
    await t.close();
  }
});

test('the seed\'s launch of docs-01 carries on when resumed, using the machine it had already made', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.hosted.resume();
    await t.hosted.idle();
    const vm = (await t.get(`${API}/vms/docs-01`, { as: 'stevie' })).json;
    assert.deepEqual([vm.statusText, vm.publicIp], ['Running', '203.0.113.58']);
    assert.equal((await resources(t, 'stevie-prod', 'docs-01')).filter((r) => r.kind === 'vm').length, 1);
  } finally {
    await t.close();
  }
});

test('health: CPU from the cloud, memory, disk and uptime from inside; a stopped VM says so', async () => {
  const t = await startApp({ seed: true });
  try {
    const h = (await t.get(`${API}/vms/web-01/health`, { as: 'naledi-k' })).json;
    assert.deepEqual([h.cpuPercent, h.memory, h.disk, h.problem], [23, { usedGb: 2.1, totalGb: 4 }, { usedGb: 11, totalGb: 30 }, null]);
    assert.ok(h.uptimeSeconds > 17 * 86400);
    const again = (await t.get(`${API}/vms/web-01/health`, { as: 'naledi-k' })).json;
    assert.equal(again.at, h.at, 'kept a minute');
    assert.match((await t.get(`${API}/vms/staging-01/health`, { as: 'naledi-k' })).json.problem, /stopped/);
  } finally {
    await t.close();
  }
});

test('the list filters by cloud, searches by name, IP or domain, and lists database VMs apart', async () => {
  const t = await startApp({ seed: true });
  try {
    const names = async (q) => (await t.get(`${API}/vms${q}`, { as: 'naledi-k' })).json.vms.map((v) => v.name);
    assert.deepEqual(await names(''), ['api-01', 'docs-01', 'staging-01', 'web-01', 'worker-01']);
    assert.deepEqual(await names('?cloud=aws'), ['api-01', 'staging-01']);
    assert.deepEqual(await names('?q=203.0.113.117'), ['worker-01']);
    assert.deepEqual(await names('?q=shop.example'), ['web-01']);
    assert.deepEqual(await names('?role=database'), ['catalog-db']);
    assert.equal((await t.get(`${API}/vms?cloud=azure`, { as: 'naledi-k' })).status, 400);
  } finally {
    await t.close();
  }
});

test('SSH keys: added once per key, refused when not a public key, and kept while a VM uses them', async () => {
  const t = await startApp({ seed: true });
  try {
    const add = (body, as = 'priya-s') => t.post(`${API}/ssh-keys`, { as, body });
    const first = await add({ name: 'priya-laptop', publicKey: PUBLIC_KEY });
    assert.equal(first.status, 201);
    assert.equal((await add({ name: 'same again', publicKey: PUBLIC_KEY })).json.id, first.json.id, 'the same key is not added twice');
    assert.equal((await add({ name: 'x', publicKey: 'not a key' })).status, 422);
    assert.equal((await add({ name: 'x', publicKey: PUBLIC_KEY }, 'naledi-k')).status, 403);
    assert.equal((await send(t, 'DELETE', `${API}/ssh-keys/key_seedmacbook`, 'priya-s')).status, 409, 'in use by five VMs');
    assert.equal((await send(t, 'DELETE', `${API}/ssh-keys/${first.json.id}`, 'priya-s')).status, 200);
  } finally {
    await t.close();
  }
});

test('cost: a VM stopped mid-month counts its running hours, then its disk only; a deleted one keeps what it cost', async () => {
  let clock = Date.parse('2026-10-10T00:00:00Z');
  const t = await startApp({ seed: true, changeHost: (h) => ({ ...h, clock: { now: () => clock } }) });
  const aws = async () => (await t.get(`${API}/cost`, { as: 'stevie' })).json.accounts.find((a) => a.id === 'stevie-aws').usd;
  try {
    const before = await aws();
    await t.hosted.runJob('cost-snapshot');
    clock += 24 * 3600_000;
    await t.post(`${API}/vms/api-01/stop`, { as: 'stevie' });
    await t.hosted.idle();
    const after = await aws();
    // api-01 runs at $41.40 a month; stopped, it costs $2.40. 21 days remain of 31: about $25.40 less.
    assert.ok(Math.abs((before - after) - (41.4 - 2.4) * (21 * 24) / 730) < 0.5, `${before} → ${after}`);
    clock += 24 * 3600_000;
    await t.post(`${API}/vms`, { as: 'stevie', body: spec({ account: 'stevie-aws', name: 'tmp-01', region: 'af-south-1', zone: 'af-south-1a' }) });
    await t.hosted.idle();
    clock += 48 * 3600_000;
    await t.hosted.runJob('cost-snapshot');
    const withTmp = await aws();
    await send(t, 'DELETE', `${API}/vms/tmp-01`, 'stevie', { confirm: 'tmp-01' });
    await t.hosted.idle();
    const afterDelete = await aws();
    assert.ok(afterDelete < withTmp && afterDelete > after, 'the two days tmp-01 ran still count');
  } finally {
    await t.close();
  }
});
