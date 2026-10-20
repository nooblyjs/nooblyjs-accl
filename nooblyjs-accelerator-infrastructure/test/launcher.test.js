// A CommonJS launcher on Express 4 (the shape of the accelerators' ../app.js; roadmap 0.6) loads this ESM accelerator
// by package name, with the real nooblyjs-core serverManager, and serves its pages and API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.js';
import fs from 'node:fs/promises';

const run = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('./fixtures/launcher.cjs', import.meta.url));

test('a CommonJS launcher on Express 4 loads the accelerator with register() and the dev launcher', async () => {
  // Its own working folder: whatever nooblyjs-core writes on start stays out of the repo.
  const cwd = await tempDir();
  try {
    const { stdout } = await run(process.execPath, [LAUNCHER], { cwd, timeout: 15_000, env: { ...process.env, NODE_ENV: 'development' } });
    const seen = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.match(seen.express, /^4\./);
    assert.equal(seen['/infrastructure'].status, 200);
    assert.match(seen['/infrastructure'].type, /text\/html/);
    assert.equal(seen['/infrastructure/vms/web-01'].status, 200);
    assert.match(seen['/infrastructure/js/module.js'].type, /javascript/);
    assert.equal(seen['/infrastructure/api/v1/about'].status, 200);
    assert.equal(seen.about.name, 'infrastructure');
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
