// The provider contract (architecture.md §6.1). Every provider must pass this suite; it always runs against the mock,
// and will run against GCP and AWS sandbox accounts with INFRA_CLOUD_TESTS=gcp,aws once those adapters exist (phase 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createCatalog } from '../../src/catalog/index.js';
import { createProviders } from '../../src/providers/index.js';
import { missingMethods, checkProvider } from '../../src/providers/contract.js';
import { isCloudError } from '../../src/providers/errors.js';
import { tempDir } from '../helpers.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const catalog = await createCatalog();
const LABELS = { 'managed-by': 'noobly-cloud', 'noobly-install': 'nc-test' };

async function mockProvider(cloud = 'gcp', { credentials = { type: 'mock' }, mockStepMs = 0 } = {}) {
  const dir = await tempDir();
  const store = new FsStore(dir);
  const secrets = { get: async () => credentials };
  const providers = createProviders({ enabled: ['mock'], store, secrets, catalog, mockStepMs });
  const account = { id: `test-${cloud}`, cloud, provider: 'mock', credentialRef: 'sec_test', projectId: 'test-project', accountId: '111122223333' };
  return { dir, store, providers, account, provider: await providers.forAccount(account) };
}

for (const cloud of ['gcp', 'aws']) {
  test(`mock (${cloud}): implements the whole contract`, async () => {
    const { dir, provider } = await mockProvider(cloud);
    try {
      assert.deepEqual(missingMethods(provider), []);
      assert.equal(provider.cloud, cloud);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test(`mock (${cloud}): verify, regions and zones come from the cloud's catalogue`, async () => {
    const { dir, provider } = await mockProvider(cloud);
    try {
      assert.equal((await provider.account.verify()).ok, true);
      const regions = await provider.account.regions();
      assert.deepEqual(regions.map((r) => r.id), catalog.forCloud(cloud).regions.map((r) => r.id));
      assert.deepEqual(await provider.account.zones(regions[0].id), regions[0].zones);
      await assert.rejects(provider.account.zones('mars-north1'), isCloudError);
      const types = await provider.catalog.machineTypes(regions[0].zones[0]);
      assert.ok(types.some((t) => t.id === catalog.forCloud(cloud).sizes.medium));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test(`mock (${cloud}): ensureNetwork makes the network once and finds it after`, async () => {
    const { dir, provider } = await mockProvider(cloud, { mockStepMs: 5 });
    try {
      const region = (await provider.account.regions())[0].id;
      assert.equal(await provider.account.detectNetwork(region, { labels: LABELS }), null);
      const first = await provider.account.ensureNetwork(region, { labels: LABELS });
      assert.equal(first.created, true);
      await provider.waitFor(first.operation);
      const second = await provider.account.ensureNetwork(region, { labels: LABELS });
      assert.deepEqual([second.ref, second.created], [first.ref, false]);
      assert.equal(await provider.account.detectNetwork(region, { labels: LABELS }), first.ref);
      assert.equal((await provider.inventory({ labels: LABELS })).networks.length, 1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}

test('mock: a VM goes through its life: create, stop, start, address, remove', async () => {
  // A pace, so the state in between can be seen: each operation takes 1–3 × 50 ms.
  const { dir, provider } = await mockProvider('aws', { mockStepMs: 50 });
  try {
    const labels = { ...LABELS, 'noobly-name': 'web-02' };
    const ip = await provider.compute.reserveAddress('af-south-1', { labels });
    const { ref, operation } = await provider.compute.create({ name: 'web-02', zone: 'af-south-1a', machineType: 't3.medium', image: 'ubuntu-2404-lts', diskGb: 30, labels, address: ip.ref });
    assert.equal((await provider.compute.get(ref)).status, 'provisioning');
    await provider.waitFor(operation);
    assert.equal((await provider.compute.get(ref)).status, 'running');
    assert.equal(await provider.compute.defaultAddress(ref), `ec2-${ip.address.replaceAll('.', '-')}.af-south-1.compute.amazonaws.com`);
    await provider.waitFor((await provider.compute.stop(ref)).operation);
    assert.equal((await provider.compute.get(ref)).status, 'stopped');
    await provider.waitFor((await provider.compute.start(ref)).operation);
    assert.equal((await provider.compute.get(ref)).status, 'running');
    await provider.compute.setFirewall(ref, [{ port: 22, from: '196.25.1.1/32' }]);
    assert.deepEqual((await provider.compute.get(ref)).firewall, [{ port: 22, from: '196.25.1.1/32' }]);
    assert.deepEqual((await provider.compute.list({ labels })).map((v) => v.name), ['web-02']);
    await assert.rejects(provider.compute.create({ name: 'web-02', zone: 'af-south-1a', machineType: 't3.medium', labels }), (err) => err.code === 'conflict');
    await assert.rejects(provider.compute.create({ name: 'x', zone: 'af-south-1a', machineType: 'n2-huge' }), (err) => err.code === 'invalid');
    await provider.waitFor((await provider.compute.remove(ref)).operation);
    assert.equal(await provider.compute.get(ref), null);
    await provider.compute.releaseAddress(ip.ref);
    assert.equal((await provider.inventory({ labels: LABELS })).addresses.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mock: GCP gives a VM its IP as its address (no hostname)', async () => {
  const { dir, provider } = await mockProvider('gcp');
  try {
    const ip = await provider.compute.reserveAddress('africa-south1', { labels: LABELS });
    const { ref, operation } = await provider.compute.create({ name: 'web-01', zone: 'africa-south1-a', machineType: 'e2-medium', labels: LABELS, address: ip.ref });
    await provider.waitFor(operation);
    assert.equal(await provider.compute.defaultAddress(ref), ip.address);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mock: the cloud is a file in the folder, so it outlives the provider (a restart)', async () => {
  const { dir, store, account, provider } = await mockProvider('gcp');
  try {
    await provider.account.ensureNetwork('africa-south1', { labels: LABELS });
    const later = createProviders({ enabled: ['mock'], store, secrets: { get: async () => ({}) }, catalog, mockStepMs: 0 });
    const again = await later.forAccount(account);
    assert.equal((await again.inventory({ labels: LABELS })).networks.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mock: waitFor reports progress and stops when its signal aborts', async () => {
  const { dir, provider } = await mockProvider('gcp', { mockStepMs: 200 });
  try {
    const { operation } = await provider.account.ensureNetwork('africa-south1', { labels: LABELS });
    const seen = [];
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('stop')), 120);
    await assert.rejects(provider.waitFor(operation, { signal: controller.signal, onProgress: (f) => seen.push(f) }), /stop/);
    assert.ok(seen.length >= 1 && seen.every((f) => f >= 0 && f < 1));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mock: fails on purpose (once, or every time) and changes behind our back', async () => {
  const { dir, provider } = await mockProvider('gcp');
  try {
    provider.mock.failAt('account.verify', { code: 'permission', message: 'No permission compute.instances.create' });
    await assert.rejects(provider.account.verify(), (err) => isCloudError(err) && err.code === 'permission' && /compute\.instances/.test(err.message));
    assert.equal((await provider.account.verify()).ok, true, 'once means once');
    const { ref } = await provider.account.ensureNetwork('africa-south1', { labels: LABELS });
    await provider.mock.outOfBand(ref, null);
    assert.equal((await provider.inventory({ labels: LABELS })).networks.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mock: credentials that are missing or refused fail verify, in words', async () => {
  for (const [credentials, message] of [[null, /No credentials/], ['invalid key', /refused/]]) {
    const { dir, provider } = await mockProvider('gcp', { credentials });
    try {
      const result = await provider.account.verify();
      assert.equal(result.ok, false);
      assert.match(result.message, message);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

test('the registry: one instance per account and credentials, the real providers say when they arrive, and the contract is enforced', async () => {
  const { dir, providers, account, provider } = await mockProvider('gcp');
  try {
    assert.equal(await providers.forAccount(account), provider);
    assert.notEqual(await providers.forAccount({ ...account, credentialRef: 'sec_other' }), provider);
    assert.equal(providers.defaultFor('gcp'), 'mock');
    await assert.rejects(providers.forAccount({ ...account, provider: 'gcp' }), /INFRA_PROVIDERS/);
    const both = createProviders({ enabled: ['mock', 'gcp'], store: null, secrets: { get: async () => null }, catalog });
    assert.equal(both.defaultFor('gcp'), 'gcp');
    assert.equal(both.defaultFor('aws'), 'mock');
    await assert.rejects(both.forAccount({ ...account, provider: 'gcp' }), /roadmap phase 2/);
    assert.throws(() => checkProvider({ name: 'half', account: {} }), /half provider lacks account\.verify/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
