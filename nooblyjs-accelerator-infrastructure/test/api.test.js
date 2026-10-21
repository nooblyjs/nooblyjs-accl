// The read-only API around the Overview (architecture.md §13): the summary, the catalogue, activity, cost and
// operations, on the seed story, with their query checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';

test('/summary counts the seed story as the mockup shows it, and an empty install as zero', async () => {
  const empty = await startApp();
  try {
    const s = (await empty.get(`${API}/summary`, { as: 'naledi-k' })).json;
    assert.deepEqual([s.accounts, s.resources, s.totals.vms.text, s.totals.buckets.value, s.endpoints, s.activity, s.spend.total], [[], 0, 'None yet', '0 GB', [], [], 0]);
  } finally {
    await empty.close();
  }
  const t = await startApp({ seed: true });
  try {
    const s = (await t.get(`${API}/summary`, { as: 'naledi-k' })).json;
    assert.deepEqual(s.accounts.map((a) => `${a.cloudLabel} ${a.label} ${a.stateText}`), ['GCP stevie-prod Connected', 'AWS stevie-aws · 0932 Connected']);
    assert.equal(s.resources, 18);
    assert.deepEqual(Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, [v.count, v.text]])), {
      vms: [5, '3 running · 1 stopped · 1 starting'],
      apps: [6, '3 live on HTTPS · 1 building'],
      databases: [3, '2 MySQL · 1 MongoDB'],
      buckets: [4, '4 buckets · 2 public'],
    });
    assert.equal(s.totals.buckets.value, '182 GB');
    assert.deepEqual(s.endpoints.map((e) => [e.host, e.text, e.url]), [
      ['api.example.com', 'Live', 'https://api.example.com'],
      ['blog.example.com', 'Live', 'https://blog.example.com'],
      ['docs.example.com', 'Certificate pending', null],
      ['shop.example.com', 'Live', 'https://shop.example.com'],
      ['staging.example.com', 'VM stopped', null],
    ]);
    assert.equal(s.activity.length, 5, 'the five newest');
    assert.ok(s.activity.every((a, i) => i === 0 || a.at <= s.activity[i - 1].at), 'newest first');
    assert.deepEqual([s.activity[0].verb, s.activity[0].text], ['Building', 'docs 77be014 on docs-01']);
  } finally {
    await t.close();
  }
});

test('/cost: every resource at its current rate for this month; the accounts add up to the total', async () => {
  const t = await startApp({ seed: true });
  try {
    const c = (await t.get(`${API}/cost`, { as: 'stevie' })).json;
    assert.match(c.month, /^[A-Z][a-z]+ \d{4}$/);
    assert.match(c.resetsOn, /^1 [A-Z][a-z]{2}$/);
    assert.ok(c.total > 0);
    assert.ok(Math.abs(c.accounts.reduce((sum, a) => sum + a.usd, 0) - c.total) < 0.05);
    assert.ok(Math.abs(c.accounts.reduce((sum, a) => sum + a.share, 0) - 1) < 1e-9);
    const prod = c.accounts.find((a) => a.id === 'stevie-prod');
    assert.deepEqual(prod.counts, { vm: 3, database: 2, bucket: 2 }, 'catalog-db counts in its database, not as a VM');
  } finally {
    await t.close();
  }
});

test('/catalog by cloud or by account; anything else is a 404', async () => {
  const t = await startApp({ seed: true });
  try {
    const gcp = (await t.get(`${API}/catalog?cloud=gcp`, { as: 'naledi-k' })).json;
    assert.deepEqual([gcp.cloud, gcp.sizes.medium], ['gcp', 'e2-medium']);
    assert.equal((await t.get(`${API}/catalog?account=stevie-aws`, { as: 'naledi-k' })).json.cloud, 'aws');
    assert.equal((await t.get(`${API}/catalog?cloud=azure`, { as: 'naledi-k' })).status, 404);
    assert.equal((await t.get(`${API}/catalog?account=nobody`, { as: 'naledi-k' })).status, 404);
  } finally {
    await t.close();
  }
});

test('/activity filters by kind and person, caps the limit, and refuses an unknown kind', async () => {
  const t = await startApp({ seed: true });
  try {
    const vms = (await t.get(`${API}/activity?kind=vm`, { as: 'naledi-k' })).json.activity;
    assert.ok(vms.length >= 2 && vms.every((a) => a.resource.type === 'vm'));
    const byStevie = (await t.get(`${API}/activity?person=stevie`, { as: 'naledi-k' })).json.activity;
    assert.ok(byStevie.every((a) => a.actor?.id === 'stevie' && a.actor.name === 'Stevie'));
    assert.equal((await t.get(`${API}/activity?limit=2`, { as: 'naledi-k' })).json.activity.length, 2);
    assert.equal((await t.get(`${API}/activity?kind=planet`, { as: 'naledi-k' })).status, 400);
  } finally {
    await t.close();
  }
});

test('/operations lists by status and resource, checks its query, and 404s an unknown id', async () => {
  const t = await startApp({ seed: true });
  try {
    const active = (await t.get(`${API}/operations?status=active`, { as: 'naledi-k' })).json.operations;
    assert.equal(active.length, 3);
    const docs = (await t.get(`${API}/operations?resource=vm:docs-01`, { as: 'naledi-k' })).json.operations;
    assert.deepEqual(docs.map((o) => [o.label, o.statusText]), [['Launch docs-01', 'Starting · 1 of 3']]);
    assert.equal((await t.get(`${API}/operations?status=nope`, { as: 'naledi-k' })).status, 400);
    assert.equal((await t.get(`${API}/operations?resource=../etc`, { as: 'naledi-k' })).status, 400);
    assert.equal((await t.get(`${API}/operations/op_nothere`, { as: 'naledi-k' })).status, 404);
    assert.equal((await t.get(`${API}/operations/not-an-id`, { as: 'naledi-k' })).status, 404);
    const seen = (await t.get(`${API}/operations/op_seedlaunch`, { as: 'naledi-k' })).json;
    assert.deepEqual([seen.retryable, seen.cancellable], [false, true]);
    assert.ok(seen.log.length >= 2);
  } finally {
    await t.close();
  }
});
