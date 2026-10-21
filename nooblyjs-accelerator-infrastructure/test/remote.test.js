// Reaching inside a VM (architecture.md §9): commands are fixed scripts piped to `bash -s` with quoted arguments;
// first boot is JSON that nothing can reshape; the SSH runner talks to a real SSH server (ssh2's, in this process),
// pins the host key on first use and refuses another; the mock runner answers as a mock cloud VM would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ssh2 from 'ssh2';
import { createRequire } from 'node:module';
import { quote, command, scriptText, SCRIPTS } from '../src/remote/shell.js';
import { cloudInit, isPublicKey } from '../src/remote/cloud-init.js';
import { createSshRunner, fingerprint } from '../src/remote/runner-ssh.js';
import { createMockRunner } from '../src/remote/runner-mock.js';
import { MockCloud } from '../src/providers/mock/cloud.js';
import { createCatalog } from '../src/catalog/index.js';
import { tempDir } from './helpers.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const { utils, Server } = ssh2;
const PERSON = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq7Xw2bmZcV4pM1kQ9nT6sR0uY3eW8aH5jL2fD7cB1x stevie@macbook';

test('arguments are single-quoted words, whatever they hold; only our scripts can be named', () => {
  assert.equal(quote("it's"), `'it'\\''s'`);
  assert.equal(command(['web-01', "x'; rm -rf / #", '$(id)']), `bash -s -- 'web-01' 'x'\\''; rm -rf / #' '$(id)'`);
  assert.throws(() => command([{ toString: () => 'x' }]), /strings or numbers/);
  assert.ok(SCRIPTS.includes('wait-ready') && SCRIPTS.includes('health'));
  assert.match(scriptText('health'), /^#!\/usr\/bin\/env bash/);
  assert.throws(() => scriptText('../../etc/passwd'), /No remote script/);
});

test('first boot: the person\'s key on the default user, the control key on noobly, Docker when asked, and a ready marker', () => {
  const control = utils.generateKeyPairSync('ed25519').public;
  const text = cloudInit({ personKey: PERSON, controlKey: control, docker: true, packages: 'apt' });
  assert.match(text, /^#cloud-config\n/);
  const config = JSON.parse(text.slice('#cloud-config\n'.length));
  assert.deepEqual(config.ssh_authorized_keys, [PERSON]);
  assert.deepEqual(config.users[1].ssh_authorized_keys, [control.trim()]);
  assert.equal(config.users[1].name, 'noobly');
  assert.deepEqual(config.packages, ['docker.io']);
  assert.deepEqual(config.runcmd.at(-1), ['touch', '/var/lib/noobly/ready']);
  assert.equal(config.ssh_pwauth, false);
  const rocky = JSON.parse(cloudInit({ personKey: PERSON, controlKey: control, packages: 'dnf' }).slice(14));
  assert.ok(rocky.runcmd.some((c) => c.includes('docker-ce')));
  const bare = JSON.parse(cloudInit({ personKey: PERSON, controlKey: control, docker: false }).slice(14));
  assert.deepEqual(bare.packages, []);
  assert.ok(!bare.runcmd.flat().includes('docker'));
  assert.throws(() => cloudInit({ personKey: `${PERSON}\nruncmd: [rm]`, controlKey: control }), /not an SSH public key/);
  assert.throws(() => cloudInit({ personKey: '-----BEGIN OPENSSH PRIVATE KEY-----', controlKey: control }), /not an SSH public key/);
  assert.ok(isPublicKey(PERSON) && !isPublicKey('ssh-dss AAAA'));
});

/** An SSH server in this process that lets in one key and answers `exec` with `respond(command, stdin)`. */
async function sshServer(allowed, respond) {
  const hostKey = utils.generateKeyPairSync('ed25519');
  const allowedKey = utils.parseKey(allowed);
  const seen = [];
  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => {
      const ok = ctx.method === 'publickey' && ctx.username === 'noobly' && ctx.key.algo === allowedKey.type && ctx.key.data.equals(allowedKey.getPublicSSH());
      if (!ok) return ctx.reject();
      if (ctx.signature && allowedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject();
      return ctx.accept();
    }).on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, reject, info) => {
          const stream = acceptExec();
          let stdin = '';
          stream.on('data', (d) => { stdin += d; });
          stream.on('end', () => {
            seen.push({ command: info.command, stdin });
            const { code, stdout } = respond(info.command, stdin);
            stream.write(stdout);
            stream.exit(code);
            stream.end();
          });
        });
      });
    }).on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, hostKey: fingerprint(utils.parseKey(hostKey.public).getPublicSSH()), seen, close: () => new Promise((r) => server.close(r)) };
}

test('the SSH runner pipes the script to bash over stdin, with quoted arguments, as noobly with the control key', async () => {
  const control = utils.generateKeyPairSync('ed25519');
  const server = await sshServer(control.public, (cmd, stdin) => ({ code: stdin.includes('free -b') ? 0 : 1, stdout: '{"ok":true}\n' }));
  const pinned = [];
  try {
    const runner = createSshRunner({ host: '127.0.0.1', port: server.port, privateKey: control.private, pin: async (fp) => pinned.push(fp) });
    const result = await runner.run('health', ["it's"]);
    assert.deepEqual([result.code, result.stdout], [0, '{"ok":true}\n']);
    assert.equal(server.seen[0].command, `bash -s -- 'it'\\''s'`);
    assert.equal(server.seen[0].stdin, scriptText('health'));
    assert.deepEqual(pinned, [server.hostKey], 'the host key is pinned the first time');
    runner.close();
  } finally {
    await server.close();
  }
});

test('the SSH runner refuses a host whose key is not the pinned one, and a key the VM does not hold', async () => {
  const control = utils.generateKeyPairSync('ed25519');
  const server = await sshServer(control.public, () => ({ code: 0, stdout: '' }));
  try {
    const impostor = createSshRunner({ host: '127.0.0.1', port: server.port, privateKey: control.private, hostKey: 'SHA256:not-the-one' });
    await assert.rejects(impostor.run('health'));
    const stranger = createSshRunner({ host: '127.0.0.1', port: server.port, privateKey: utils.generateKeyPairSync('ed25519').private });
    await assert.rejects(stranger.run('health'), /authentication/i);
    assert.equal(server.seen.length, 0, 'nothing ran');
  } finally {
    await server.close();
  }
});

test('the mock runner: a VM answers once it is running; first boot takes two units, once; health comes from its figures', async () => {
  const dir = await tempDir();
  try {
    const catalog = (await createCatalog()).forCloud('gcp');
    const cloud = new MockCloud({ store: new FsStore(dir), accountId: 'a', cloud: 'gcp', stepMs: 20 });
    await cloud.mutate((state) => state.resources.push({ id: 'vm-1', kind: 'vm', name: 'web-01', machineType: 'e2-medium', diskGb: 30, status: 'stopped', userData: '"docker.io"', sim: { memUsedGb: 2.1, diskUsedGb: 11 } }));
    const runner = createMockRunner({ cloud, ref: 'vm-1', catalog });
    assert.equal((await runner.run('wait-ready')).code, 255, 'a stopped VM does not answer');
    await cloud.outOfBand('vm-1', { status: 'running', startedAt: new Date(Date.now() - 3600_000).toISOString() });
    const started = Date.now();
    const ready = await runner.run('wait-ready');
    assert.deepEqual(JSON.parse(ready.stdout), { ready: true, docker: '27.3.1' });
    assert.ok(Date.now() - started >= 35, 'first boot took two units');
    const again = Date.now();
    await runner.run('wait-ready');
    assert.ok(Date.now() - again < 35, 'and only once');
    const health = JSON.parse((await runner.run('health')).stdout);
    assert.deepEqual([health.memory.totalBytes, health.memory.usedBytes, health.disk.usedBytes], [4e9, 2.1e9, 11e9]);
    assert.ok(Math.abs(health.uptimeSeconds - 3600) < 5);
    assert.equal((await runner.run('nope')).code, 127);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
