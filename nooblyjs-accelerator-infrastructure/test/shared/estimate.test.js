// The estimate shared by the create forms and the server (architecture.md §12), against the mockups' figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../../src/catalog/index.js';
import { estimate, usd, HOURS_PER_MONTH } from '../../public/js/shared/estimate.js';
import { isResourceName, isBucketName, resourceNameProblem } from '../../public/js/shared/names.js';

const catalog = await createCatalog();
const gcp = catalog.forCloud('gcp');
const aws = catalog.forCloud('aws');

test('Launch a Linux VM: e2-medium with a 30 GB disk is about $30 a month (VM $28 · disk $2)', () => {
  const e = estimate('vm', { region: 'africa-south1', machineType: 'e2-medium', diskGb: 30 }, gcp);
  assert.equal(usd(e.monthly), '$30');
  assert.deepEqual(e.parts.map((p) => [p.label, usd(p.monthly)]), [['VM', '$28'], ['disk', '$2.04']]);
  assert.ok(Math.abs(e.hourly * HOURS_PER_MONTH - e.monthly) < 1e-9);
});

test('a stopped VM costs its disk only', () => {
  const e = estimate('vm', { region: 'af-south-1', machineType: 't3.small', diskGb: 40, status: 'stopped' }, aws);
  assert.deepEqual(e.parts.map((p) => p.label), ['disk']);
  assert.equal(usd(e.monthly), '$3.20');
});

test('Create a database: Standard MySQL with 20 GB is $56 a month (server $52 · storage $3 · backups $1); HA doubles the server', () => {
  const e = estimate('database', { engine: 'mysql', region: 'africa-south1', tier: 'standard', storageGb: 20 }, gcp);
  assert.equal(usd(e.monthly), '$56');
  assert.deepEqual(e.parts.map((p) => [p.label, Math.round(p.monthly)]), [['server', 52], ['storage', 3], ['backups', 1]]);
  const ha = estimate('database', { engine: 'mysql', region: 'africa-south1', tier: 'standard', storageGb: 20, ha: true }, gcp);
  assert.equal(Math.round(ha.parts[0].monthly), 104);
});

test('a MongoDB database costs its VM, its disks and its daily dumps', () => {
  const e = estimate('database', { engine: 'mongodb', region: 'africa-south1', tier: 'standard', storageGb: 20, keepDays: 7 }, gcp);
  assert.deepEqual(e.parts.map((p) => p.label), ['VM', 'disks', 'backups']);
  assert.equal(Math.round(e.parts[0].monthly), 28, 'the e2-medium VM');
});

test('Create a bucket: S3 Standard is about $0.03 per GB a month; 124 GB on Cloud Storage is $3.10', () => {
  assert.equal(usd(estimate('bucket', { region: 'af-south-1', storageClass: 'standard', bytes: 1e9 }, aws).perGb), '$0.03');
  assert.equal(usd(estimate('bucket', { region: 'africa-south1', storageClass: 'standard', bytes: 124e9 }, gcp).monthly), '$3.10');
});

test('a region\'s price factor scales every price', () => {
  const home = estimate('vm', { region: 'africa-south1', machineType: 'e2-small', diskGb: 10 }, gcp).monthly;
  const iowa = estimate('vm', { region: 'us-central1', machineType: 'e2-small', diskGb: 10 }, gcp).monthly;
  assert.ok(Math.abs(iowa - home * 0.85) < 0.02);
});

test('what the catalogue lacks is said, not guessed', () => {
  assert.equal(estimate('vm', { machineType: 'n2-huge' }, gcp).monthly, null);
  assert.match(estimate('vm', { machineType: 'n2-huge' }, gcp).problem, /n2-huge/);
  assert.equal(estimate('database', { engine: 'postgres', tier: 'standard' }, gcp).monthly, null);
  assert.equal(estimate('vm', {}, null).monthly, null);
  assert.equal(usd(null), '—');
});

test('every catalogue is dated, says where its prices come from, and its size cards name machine types it prices', () => {
  for (const c of [gcp, aws]) {
    assert.match(c.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(c.source, /Illustrative/);
    for (const type of Object.values(c.sizes)) assert.ok(c.machineTypes[type], `${c.cloud} prices ${type}`);
    for (const type of Object.values(c.databases.mongodb.tiers)) assert.ok(c.machineTypes[type], `${c.cloud} MongoDB tier ${type}`);
    for (const r of c.regions) assert.ok(r.zones.length > 0);
  }
});

test('names: resources follow RFC 1035; buckets follow the clouds\' rules', () => {
  for (const ok of ['web-01', 'a', 'orders-db']) assert.ok(isResourceName(ok), ok);
  for (const bad of ['Web-01', '1web', 'web-', 'web_01', '', 'a'.repeat(64), '../x']) assert.ok(!isResourceName(bad), bad);
  assert.equal(resourceNameProblem('Web'), 'Start with a lower-case letter.');
  assert.equal(resourceNameProblem('web-'), 'End with a letter or a number.');
  assert.equal(resourceNameProblem('web-01'), null);
  for (const ok of ['stevie-media', 'media.example.com', 'abc']) assert.ok(isBucketName(ok), ok);
  for (const bad of ['ab', 'Stevie', 'a..b', '192.168.1.1', 'goog-x', 'xn--abc', '-abc']) assert.ok(!isBucketName(bad), bad);
});
