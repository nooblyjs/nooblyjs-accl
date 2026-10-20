// A launcher shaped like the accelerators' ../app.js (CommonJS, Express 4, the real nooblyjs-core serverManager
// initialised with an EventEmitter), loading this accelerator by its package name the way ../app.js does. Run by
// test/launcher.test.js in a child process; prints what it saw as one line of JSON and exits.
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const express = require('express4');
const serviceRegistry = require('nooblyjs-core');

(async () => {
  const app = express();
  serviceRegistry.initialize(app, new EventEmitter());

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nooblyjs-launcher-'));
  const { register } = await import('nooblyjs-accelerator-infrastructure');
  const { createDevLauncher } = await import('nooblyjs-accelerator-infrastructure/host');
  const quiet = { info() {}, warn() {}, error() {} };
  const launcher = createDevLauncher({ express, rootDir: dataRoot, log: quiet });
  launcher.mount(app);
  const dataDir = path.join(dataRoot, 'infrastructure');
  const hosted = await register(app, serviceRegistry, { mountPath: '/infrastructure', dataDir, host: launcher.hostFor(dataDir) });
  launcher.add(hosted, '/infrastructure');

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = { headers: { 'x-dev-person': 'stevie' } };
  const seen = { express: require('express4/package.json').version };
  for (const url of ['/infrastructure', '/infrastructure/vms/web-01', '/infrastructure/js/module.js', '/infrastructure/api/v1/about']) {
    const res = await fetch(base + url, as);
    seen[url] = { status: res.status, type: res.headers.get('content-type') };
    if (url.endsWith('/about')) seen.about = await res.json();
  }
  server.close();
  await hosted.close();
  await serviceRegistry.shutdown?.();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(seen)}\n`);
  process.exit(0);
})().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
