// Every route renders (roadmap phase 0's exit check): each URL in product.md §5 matches the route the frame would
// pick, and that page draws its title, breadcrumb and links into the view with the real UI kit, in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { PAGES } from '../fixtures/pages.js';

const require = createRequire(import.meta.url);
const { UI_DIR } = require('nooblyjs-core/src/shell');
register('../fixtures/ui-loader.js', import.meta.url, { data: { uiDir: UI_DIR } });

const MOUNT = '/infrastructure';
const { routes } = await import('../../public/js/module.js');
const { matchRoute } = await import('/ui/js/router.js');
const { escapeHtml } = await import('/ui/js/html.js');

/** A content area the way the frame hands it over, as far as pages use it. */
function fakeView() {
  return { innerHTML: '', addEventListener() {}, querySelector: () => null };
}

function fakeCtx() {
  const controller = new AbortController();
  return {
    app: { name: 'infrastructure', label: 'Cloud', mountPath: MOUNT },
    person: { id: 'stevie', name: 'Stevie', accessRole: 'Owner' },
    signal: controller.signal,
    api: { get: async () => { throw new Error('placeholder pages make no API calls'); } },
    sse: { enabled: false, on() {} },
    can: () => true,
    isCurrent: () => true,
  };
}

for (const expected of PAGES) {
  test(`${expected.url} renders ${expected.page} with the title "${expected.title}"`, async () => {
    const found = matchRoute(routes, expected.url.slice(MOUNT.length) || '/');
    assert.ok(found, 'a route matches');
    assert.deepEqual(found.params, expected.params ?? {});
    const page = await found.route.page();
    assert.match(String(found.route.page), new RegExp(`pages/${expected.page.replace('.', '\\.')}`));

    const view = fakeView();
    await page.render(view, { params: found.params, query: new URLSearchParams(), ctx: fakeCtx(), route: found.route });
    const out = view.innerHTML;
    assert.match(out, new RegExp(`<h1 class="page-title">${escapeHtml(expected.title)}</h1>`), 'one h1 with the page title');
    assert.equal(out.match(/<h1\b/g).length, 1, 'exactly one h1');
    assert.match(out, /Coming in roadmap phase \d/);
    for (const [, href] of out.matchAll(/href="([^"]*)"/g)) {
      assert.ok(href === MOUNT || href.startsWith(`${MOUNT}/`), `link ${href} stays inside the accelerator`);
    }
    if (expected.params) assert.match(out, /aria-label="Breadcrumb"/, 'a detail page has a breadcrumb');
  });
}

test('a name in the URL is escaped, never markup', async () => {
  const found = matchRoute(routes, '/vms/%3Cimg%20src%3Dx%3E');
  const view = fakeView();
  await (await found.route.page()).render(view, { params: found.params, query: new URLSearchParams(), ctx: fakeCtx(), route: found.route });
  assert.doesNotMatch(view.innerHTML, /<img/);
  assert.match(view.innerHTML, /&lt;img src=x&gt;/);
});
