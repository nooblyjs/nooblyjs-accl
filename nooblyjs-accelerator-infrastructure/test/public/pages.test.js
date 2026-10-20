// Every route renders (roadmap phases 0 and 1): each URL in product.md §5 matches the route the frame would pick, and
// that page draws into a DOM (linkedom) with the real UI kit and the real API of a seeded accelerator, in Node.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { parseHTML } from 'linkedom';
import { PAGES } from '../fixtures/pages.js';
import { startApp } from '../helpers.js';
import { MATRIX, PERSON_HEADER } from '../fixtures/host.js';

const require = createRequire(import.meta.url);
const { UI_DIR } = require('nooblyjs-core/src/shell');
register('../fixtures/ui-loader.js', import.meta.url, { data: { uiDir: UI_DIR } });

const MOUNT = '/infrastructure';
const { routes } = await import('../../public/js/module.js');
const { matchRoute } = await import('/ui/js/router.js');
const { escapeHtml } = await import('/ui/js/html.js');
const { createApi } = await import('/ui/js/api.js');

let app;
before(async () => {
  app = await startApp({ seed: true });
});
after(async () => {
  await app.close();
});

/** A content area the way the frame hands it over, in a document of its own. */
function fakeView() {
  const { document } = parseHTML('<!doctype html><html><body><main id="view"></main></body></html>');
  return document.getElementById('view');
}

/** The frame's ctx, as far as pages use it, signed in as `person` (Owner by default). */
function fakeCtx(person = { id: 'stevie', name: 'Stevie', accessRole: 'Owner' }) {
  const controller = new AbortController();
  const fetchImpl = (url, options) => fetch(url, { ...options, headers: { ...options.headers, [PERSON_HEADER]: person.id } });
  return {
    app: { name: 'infrastructure', label: 'Cloud', mountPath: MOUNT },
    person,
    signal: controller.signal,
    api: createApi(`${app.base}${MOUNT}/api/v1`, { signal: controller.signal, fetchImpl }),
    sse: { enabled: false, on() {} },
    can: (permission) => (MATRIX[permission] ?? []).includes(person.accessRole),
    isCurrent: () => true,
    abort: () => controller.abort(),
  };
}

async function draw(url, person) {
  const [path, search = ''] = url.split('?');
  const found = matchRoute(routes, path.slice(MOUNT.length) || '/');
  assert.ok(found, `a route matches ${url}`);
  const view = fakeView();
  const ctx = fakeCtx(person);
  await (await found.route.page()).render(view, { params: found.params, query: new URLSearchParams(search), ctx, route: found.route });
  ctx.abort();
  return { found, out: view.innerHTML };
}

for (const expected of PAGES) {
  test(`${expected.url} renders ${expected.page} with the title "${expected.title}"`, async () => {
    const { found, out } = await draw(expected.url);
    assert.deepEqual(found.params, expected.params ?? {});
    assert.match(String(found.route.page), new RegExp(`pages/${expected.page.replace('.', '\\.')}`));
    assert.match(out, new RegExp(`<h1 class="page-title">${escapeHtml(expected.title)}</h1>`), 'one h1 with the page title');
    assert.equal(out.match(/<h1\b/g).length, 1, 'exactly one h1');
    assert.doesNotMatch(out, /Couldn.t load/, 'no error card');
    for (const [, href] of out.matchAll(/href="([^"]*)"/g)) {
      assert.ok(href === MOUNT || href.startsWith(`${MOUNT}/`) || /^https?:\/\/[a-z0-9.-]+\//.test(`${href}/`), `link ${href} stays inside the accelerator or is a public endpoint`);
    }
    if (expected.params) assert.match(out, /aria-label="Breadcrumb"/, 'a detail page has a breadcrumb');
    if (!expected.built) assert.match(out, /Coming in roadmap phase \d/);
  });
}

test('the Overview shows the seed story\'s numbers, as the mockup does', async () => {
  const { out } = await draw('/infrastructure');
  for (const text of [
    '2 cloud accounts · 18 resources', '3 running · 1 stopped · 1 starting', '3 live on HTTPS · 1 building',
    '2 MySQL · 1 MongoDB', '182 GB', '4 buckets · 2 public', 'Create something', 'Launch a Linux VM',
    'shop.example.com', 'storefront · web-01 · GCP', 'VM stopped', 'Certificate pending',
    'docs 77be014 on docs-01', 'Spend this month', 'Estimate · resets', 'stevie-prod', '3 VMs · 2 databases · 2 buckets',
  ]) assert.ok(out.includes(escapeHtml(text)), `the Overview says "${text}"`);
  assert.match(out, /href="https:\/\/shop\.example\.com"/, 'a live endpoint is a link');
  assert.doesNotMatch(out, /href="[^"]*staging\.example\.com/, 'an endpoint whose VM is stopped is not');
});

test('the Accounts page lists both accounts, says it runs on the mock cloud, and offers Connect only to an Owner', async () => {
  const owner = (await draw('/infrastructure/accounts')).out;
  for (const text of ['stevie-prod', 'stevie-aws · 0932', 'Project stevie-prod', 'Account 553219040932', 'Connected', 'Running on the mock cloud', 'Connect account', 'Check now', 'Remove']) {
    assert.ok(owner.includes(text), `the Owner sees "${text}"`);
  }
  const viewer = (await draw('/infrastructure/accounts', { id: 'naledi-k', name: 'Naledi K.', accessRole: 'Viewer' })).out;
  assert.ok(viewer.includes('stevie-prod'));
  for (const text of ['Connect account', 'Check now', '>Remove<']) assert.ok(!viewer.includes(text), `a Viewer doesn't see "${text}"`);
});

test('the Activity page lists what happened, newest first, and filters by kind', async () => {
  const all = (await draw('/infrastructure/activity')).out;
  assert.ok(all.indexOf('docs 77be014 on docs-01') < all.indexOf('VM staging-01'), 'newest first');
  assert.ok(all.includes('GCP account stevie-prod'));
  const vms = (await draw('/infrastructure/activity?kind=vm')).out;
  assert.ok(vms.includes('VM staging-01'));
  assert.ok(!vms.includes('storefront a1f3c9e'), 'only VMs');
  assert.match(vms, /data-kind="vm" aria-pressed="true"/);
});

test('a name in the URL is escaped, never markup', async () => {
  const { out } = await draw('/infrastructure/vms/%3Cimg%20src%3Dx%3E');
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img src=x&gt;/);
});
