// Secrets (architecture.md §10): encrypted at rest inside the accelerator's folder, bound to their ref, scrubbed from
// logs, and refused in production without a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createSecrets, MASK } from '../src/services/secrets.js';
import { tempDir, filesUnder } from './helpers.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const quiet = { warn() {}, info() {}, error() {} };

async function fresh(options = {}) {
  const dir = await tempDir();
  const store = new FsStore(dir);
  return { dir, store, secrets: await createSecrets({ store, log: quiet, keyMaterial: 'a test key', ...options }) };
}

test('a secret round-trips, strings and objects alike, and its file holds no plaintext', async () => {
  const { dir, secrets } = await fresh();
  try {
    const password = 'correct horse battery staple';
    const json = { type: 'service_account', private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQ' };
    const a = await secrets.put('db-password', password);
    const b = await secrets.put('cloud-credentials', json);
    assert.match(a, /^sec_[a-z0-9]{16}$/);
    assert.equal(await secrets.get(a), password);
    assert.deepEqual(await secrets.get(b), json);
    for (const file of await filesUnder(dir)) {
      const text = await fs.readFile(path.join(dir, file), 'utf8');
      assert.ok(!text.includes('horse') && !text.includes('BEGIN PRIVATE'), `${file} holds no plaintext`);
    }
    await secrets.remove(a);
    assert.equal(await secrets.get(a), null);
    assert.equal(await secrets.get('../../etc/passwd'), null, 'a ref that is not an id reads nothing');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a ciphertext moved to another ref does not open (the ref is bound in)', async () => {
  const { dir, store, secrets } = await fresh();
  try {
    const a = await secrets.put('x', 'first secret value');
    const b = await secrets.put('x', 'second secret value');
    const recordA = await store.readYaml(['secrets', `${a}.yaml`]);
    await store.writeYaml(['secrets', `${b}.yaml`], { ...recordA, ref: b });
    await assert.rejects(secrets.get(b));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('another key refuses to start on secrets written with the first one', async () => {
  const { dir, store, secrets } = await fresh();
  try {
    await secrets.put('x', 'value');
    await assert.rejects(createSecrets({ store, log: quiet, keyMaterial: 'another key' }), /not the key/);
    const again = await createSecrets({ store, log: quiet, keyMaterial: 'a test key' });
    assert.ok(again);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('without a key: a development key is made once inside the folder; production refuses', async () => {
  const dir = await tempDir();
  try {
    const store = new FsStore(dir);
    const warnings = [];
    const first = await createSecrets({ store, log: { warn: (m) => warnings.push(m) }, keyMaterial: '', production: false });
    const ref = await first.put('x', 'kept across restarts');
    assert.match(warnings.join(), /INFRA_SECRET_KEY/);
    const stat = await fs.stat(path.join(dir, 'secrets', 'dev-key.txt'));
    assert.equal(stat.mode & 0o077, 0, 'only the owner may read the development key');
    const second = await createSecrets({ store, log: quiet, keyMaterial: '', production: false });
    assert.equal(await second.get(ref), 'kept across restarts');
    await assert.rejects(createSecrets({ store: new FsStore(await tempDir()), log: quiet, keyMaterial: '', production: true }), /INFRA_SECRET_KEY/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('scrub() masks every secret value seen, including those inside an object, but not short ones', async () => {
  const { dir, secrets } = await fresh();
  try {
    await secrets.put('x', 'hunter2-is-long-enough');
    await secrets.put('y', { token: 'tok_abcdef123456', n: 'ab' });
    const text = secrets.scrub('connect with hunter2-is-long-enough and tok_abcdef123456 as ab');
    assert.equal(text, `connect with ${MASK} and ${MASK} as ab`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('reveal() returns the value and leaves an audit record', async () => {
  const records = [];
  const { dir, secrets } = await fresh({ audit: { record: async (r) => records.push(r) } });
  try {
    const ref = await secrets.put('db-password', 'reveal-me-please');
    assert.equal(await secrets.reveal(ref, { id: 'stevie' }, 'connect from a laptop'), 'reveal-me-please');
    assert.deepEqual(records, [{ actor: 'stevie', action: 'secret.revealed', target: ref, reason: 'connect from a laptop' }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
