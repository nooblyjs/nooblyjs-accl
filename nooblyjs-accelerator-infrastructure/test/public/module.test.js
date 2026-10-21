// The accelerator's own screens in the launcher's frame (architecture.md §11): the CSS is scoped, every nav row has a
// route, every page exports render(), pages leave history and <body> to the frame, every route in product.md §5 answers
// with the frame (deep links and refresh), and a missing file is a 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NAV } from '../../index.js';
import { startApp } from '../helpers.js';
import { PAGE_URLS } from '../fixtures/pages.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const PUBLIC = new URL('../../public/', import.meta.url);

async function filesIn(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('every selector in public/css is scoped to [data-module="infrastructure"]', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.css'))) {
    assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), 'infrastructure'), [], file);
  }
});

test('every nav row has a route, and every route names a page file that exports render()', async () => {
  const source = await fs.readFile(new URL('js/module.js', PUBLIC), 'utf8');
  const routed = new Set([...source.matchAll(/nav: '([a-z-]+)'/g)].map((m) => m[1]));
  for (const row of NAV) assert.ok(routed.has(row.key), `no route for the "${row.key}" nav row`);
  const pages = [...source.matchAll(/import\('\.\/pages\/([a-z-]+\.js)'\)/g)].map((m) => m[1]);
  assert.ok(pages.length >= NAV.length);
  for (const page of new Set(pages)) {
    assert.match(await fs.readFile(new URL(`js/pages/${page}`, PUBLIC), 'utf8'), /export async function render\(view, \{/, page);
  }
});

test('pages never touch history, popstate or <body>, and write no inline styles', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const banned of [/history\.(push|replace)State/, /popstate/, /document\.body/, /style="/, /\.innerHTML = (?!String\()/]) {
      assert.doesNotMatch(source, banned, `${path.basename(file)} uses ${banned}`);
    }
  }
});

test('the kit is imported by absolute URL and the accelerator\'s own files relatively; no React, no CDN', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const [, from] of source.matchAll(/from '([^']+)'/g)) {
      assert.match(from, /^(\/ui\/js\/|\.\.?\/)/, `${path.basename(file)} imports ${from}`);
    }
    assert.doesNotMatch(source, /\breact\b/i, `${path.basename(file)} pulls in React`);
    assert.doesNotMatch(source, /(from |import\(|src=")['"]?https?:\/\//, `${path.basename(file)} loads code from another site`);
  }
});

test('register() describes the accelerator for the rail and the sidebar', async () => {
  const t = await startApp();
  try {
    const { hosted } = t;
    assert.deepEqual([hosted.name, hosted.label, hosted.title, hosted.icon], ['infrastructure', 'Cloud', 'Noobly Cloud', 'globe']);
    assert.deepEqual(hosted.ui, { entry: 'js/module.js', styles: ['css/infrastructure.css'] });
    assert.deepEqual(hosted.nav.map((n) => n.label), ['Overview', 'Virtual machines', 'Apps', 'Databases', 'Buckets']);
    assert.deepEqual(hosted.nav.map((n) => n.path), ['/', '/vms', '/apps', '/databases', '/buckets']);
  } finally {
    await t.close();
  }
});

test('the status card says when no cloud account is connected yet', async () => {
  const t = await startApp();
  try {
    const status = await t.hosted.status();
    assert.deepEqual(status.card.pill, { text: 'No cloud accounts yet', tone: 'neutral' });
  } finally {
    await t.close();
  }
});

test('every page URL answers with the launcher\'s frame; files are served; a missing file or API route is a 404', async () => {
  const t = await startApp();
  try {
    for (const url of [...PAGE_URLS, ...PAGE_URLS.slice(1).map((u) => `${u}/`), '/infrastructure/vms?cloud=gcp']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.status, 501, url); // the stand-in host's frame answers 501
      assert.match(res.text, /NooblyJS frame/, url);
    }
    const module = await fetch(`${t.base}/infrastructure/js/module.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${t.base}/infrastructure/css/infrastructure.css`)).status, 200);
    assert.equal((await fetch(`${t.base}/infrastructure/js/pages/vms.js`)).status, 200);
    assert.notEqual((await fetch(`${t.base}/infrastructure/js/nope.js`)).status, 200);
    assert.notEqual((await t.get('/infrastructure/js/nope.js', { as: 'stevie' })).status, 501, 'a missing file is not a page');
    const api = await t.get('/infrastructure/api/v1/nope', { as: 'stevie' });
    assert.equal(api.status, 404);
    assert.equal(api.json.error.code, 'not_found');
    // No Content-Security-Policy of its own: one page, one policy (the launcher's).
    assert.equal(module.headers.get('content-security-policy'), null);
  } finally {
    await t.close();
  }
});

test('pages follow the frame\'s event stream when there is one, and only refresh on a timer when there is not', async () => {
  const { reloadable } = await import(new URL('js/live.js', PUBLIC));
  const view = { addEventListener() {} };
  const signal = new AbortController().signal;
  const draws = [];
  // With an event stream: a Noobly Cloud event redraws the page; an unrelated one does not; no timer is kept.
  let listener = null;
  const live = { signal, isCurrent: () => true, sse: { enabled: true, on: (topic, fn) => { listener = fn; } } };
  await reloadable(view, live, async () => { draws.push('live'); return 2000; });
  assert.equal(draws.length, 1);
  listener({ type: 'chat.message_posted' });
  listener({ type: 'infrastructure.operation.progress' });
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(draws.length, 2);
  // For every page file: no polling of its own.
  for (const file of (await filesIn(new URL('js/pages/', PUBLIC))).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), /setInterval|setTimeout/, file);
  }
});
