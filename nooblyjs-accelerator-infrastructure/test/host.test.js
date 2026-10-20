// The dev launcher (src/host/standalone.js; architecture.md §3.3) with nooblyjs-core's real shell: every page URL
// answers with the real frame for a signed-in person and sends anyone else to /login, the shell lists the
// accelerator with its nav, the /ui kit is served, cookie sign-ins need the CSRF token, and it refuses production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { register } from '../index.js';
import { createDevLauncher, CSRF_COOKIE, PERSON_COOKIE } from '../src/host/standalone.js';
import { createTestServerManager, express } from './fixtures/host.js';
import { PAGE_URLS } from './fixtures/pages.js';
import { tempDir, listen, caller } from './helpers.js';

const quiet = { info() {}, warn() {}, error() {} };

async function startLauncher() {
  const rootDir = await tempDir();
  const dataDir = path.join(rootDir, 'infrastructure');
  const app = express();
  const launcher = createDevLauncher({ express, rootDir, log: quiet });
  launcher.mount(app);
  const hosted = await register(app, createTestServerManager(), { mountPath: '/infrastructure', dataDir, host: launcher.hostFor(dataDir) });
  launcher.add(hosted, '/infrastructure');
  const { server, base } = await listen(app);
  const call = caller(base);
  return {
    base,
    get: (url, o) => call('GET', url, o),
    post: (url, o) => call('POST', url, o),
    async close() {
      await hosted.close();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

test('every page URL answers with the real frame when signed in, and redirects to /login when not', async () => {
  const t = await startLauncher();
  try {
    for (const url of PAGE_URLS) {
      const page = await t.get(url, { as: 'naledi-k' });
      assert.equal(page.status, 200, url);
      assert.match(page.headers.get('content-type'), /text\/html/, url);
      assert.match(page.text, /<!doctype html>/i, url);
      const out = await t.get(url, { redirect: 'manual' });
      assert.equal(out.status, 302, url);
      assert.equal(out.headers.get('location'), `/login?next=${encodeURIComponent(url)}`, url);
    }
  } finally {
    await t.close();
  }
});

test('the shell lists the accelerator with its nav and status card, and serves the /ui kit', async () => {
  const t = await startLauncher();
  try {
    const shell = await t.get('/api/v1/shell', { as: 'stevie' });
    assert.equal(shell.status, 200);
    const app = shell.json.apps.find((a) => a.name === 'infrastructure');
    assert.ok(app, 'listed');
    assert.deepEqual([app.label, app.title, app.mountPath, app.state], ['Cloud', 'Noobly Cloud', '/infrastructure', 'ready']);
    assert.deepEqual(app.nav.map((n) => n.key), ['overview', 'vms', 'apps', 'databases', 'buckets']);
    const status = await t.get('/api/v1/shell/status', { as: 'stevie' });
    assert.equal(status.json.infrastructure.card.pill.text, 'No cloud accounts yet');
    const kit = await fetch(`${t.base}/ui/js/html.js`);
    assert.equal(kit.status, 200);
    assert.match(kit.headers.get('content-type'), /javascript/);
  } finally {
    await t.close();
  }
});

test('the dev sign-in sets the person and a CSRF cookie; a cookie sign-in must send the token back', async () => {
  const t = await startLauncher();
  try {
    const login = await t.post('/login?next=/infrastructure/vms', { body: 'person=stevie', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/infrastructure/vms');
    const cookies = Object.fromEntries(login.headers.getSetCookie().map((c) => c.split(';')[0].split('=')));
    assert.equal(cookies[PERSON_COOKIE], 'stevie');
    const cookie = `${PERSON_COOKIE}=stevie; ${CSRF_COOKIE}=${cookies[CSRF_COOKIE]}`;
    const withoutToken = await t.post('/infrastructure/api/v1/seed', { body: {}, headers: { cookie } });
    assert.equal(withoutToken.status, 403);
    assert.equal(withoutToken.json.error.code, 'csrf');
    const withToken = await t.post('/infrastructure/api/v1/seed', { body: {}, headers: { cookie, 'x-csrf-token': decodeURIComponent(cookies[CSRF_COOKIE]) } });
    assert.equal(withToken.status, 201);
    // An open redirect is not possible: next must be a path on this server.
    const away = await t.post('/login?next=//evil.example', { body: 'person=stevie', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    assert.equal(away.headers.get('location'), '/');
  } finally {
    await t.close();
  }
});

test('the dev launcher refuses to run in production', () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createDevLauncher({ express, rootDir: '/tmp/never' }), /NODE_ENV=production/);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});
