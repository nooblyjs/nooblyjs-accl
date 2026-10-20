// The operations engine (architecture.md §7), with operation types defined here: steps run in order and are kept on
// disk; one operation at a time per resource and `perAccount` per account; failures say what went wrong and retry
// from the step that failed; cancel stops and undoes; a stop leaves the operation running on disk, and the next start
// carries on from the step it was on without doing a finished step again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createRepos } from '../src/repos/index.js';
import { createOperations } from '../src/services/operations.js';
import { CloudError } from '../src/providers/errors.js';
import { createTestServerManager, createHost } from './fixtures/host.js';
import { tempDir } from './helpers.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const STEVIE = { id: 'stevie', name: 'Stevie', accessRole: 'Owner' };
const NALEDI = { id: 'naledi-k', name: 'Naledi K.', accessRole: 'Viewer' };

/** A deferred: a promise a test resolves when it wants a step to go on. */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** A step that waits for `g` to open, or rejects when the operation is cancelled or the server stops. */
const waitFor = (g, ctx) => new Promise((resolve, reject) => {
  ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
  g.promise.then(resolve);
});

async function engine({ dir, perAccount = 4, queue } = {}) {
  dir ??= await tempDir();
  const store = new FsStore(dir);
  const stand = createHost({ rootDir: dir });
  const host = stand.hostFor(dir);
  const lines = [];
  const log = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (m) => lines.push({ level, m })]));
  const repos = createRepos(store, { log });
  const ops = createOperations({
    repos, host, log, queue: queue ?? createTestServerManager().queue(), now: () => Date.now(), perAccount,
    providers: { forAccount: async () => null },
    secrets: { scrub: (t) => String(t).replaceAll('s3cret-value', '••••••') },
  });
  return { dir, store, repos, ops, events: stand.eventLog, audit: stand.auditLog, lines };
}

const close = async (e) => {
  await e.ops.close();
  await fs.rm(e.dir, { recursive: true, force: true });
};

test('an operation runs its steps in order, keeps what they return, logs and says each step', async () => {
  const e = await engine();
  try {
    const seen = [];
    e.ops.define('test.work', {
      label: (op) => `Work on ${op.resource.name}`,
      verb: 'Working',
      steps: [
        { key: 'one', label: 'First', run: async (ctx) => { seen.push(['one', ctx.input.size]); return { state: { made: 'res-1' } }; } },
        { key: 'two', label: 'Second', run: async (ctx) => { seen.push(['two', ctx.state.made]); await ctx.log('the password is s3cret-value'); return { skipped: true, reason: 'nothing to do' }; } },
        { key: 'three', label: 'Third', run: async () => { seen.push(['three']); } },
      ],
      succeeded: async (ctx) => seen.push(['succeeded', ctx.op.status]),
    });
    const queued = await e.ops.start('test.work', { resource: { type: 'vm', name: 'web-01' }, input: { size: 'medium' }, person: STEVIE });
    assert.equal(queued.statusText, 'Queued');
    await e.ops.idle();
    assert.deepEqual(seen, [['one', 'medium'], ['two', 'res-1'], ['three'], ['succeeded', 'succeeded']]);
    const op = await e.ops.get(queued.id);
    assert.deepEqual([op.status, op.progress, op.steps.map((s) => s.status)], ['succeeded', 100, ['done', 'skipped', 'done']]);
    assert.deepEqual(op.requestedBy, { id: 'stevie', name: 'Stevie' });
    const log = op.log.map((l) => l.text);
    assert.ok(log.includes('Step 1 of 3: First') && log.includes('Skipped: Second (nothing to do)') && log.includes('Finished: Work on web-01'));
    assert.ok(log.includes('the password is ••••••'), 'the log is scrubbed of secrets');
    assert.ok(op.log.every((l) => !Number.isNaN(Date.parse(l.at))));
    const types = e.events.map((ev) => ev.type);
    assert.deepEqual([types[0], types[1], types.at(-1)], ['infrastructure.operation.queued', 'infrastructure.operation.started', 'infrastructure.operation.succeeded']);
    assert.ok(e.events.every((ev) => ev.payload.operationId === queued.id));
  } finally {
    await close(e);
  }
});

test('one operation at a time per resource; different resources run side by side', async () => {
  const e = await engine();
  try {
    const order = [];
    const gates = { a: gate(), b: gate(), c: gate() };
    e.ops.define('test.hold', {
      label: (op) => `Hold ${op.input.id}`,
      steps: [{ key: 'hold', label: 'Hold', run: async (ctx) => { order.push(`start ${ctx.input.id}`); await waitFor(gates[ctx.input.id], ctx); order.push(`end ${ctx.input.id}`); } }],
    });
    await e.ops.start('test.hold', { resource: { type: 'vm', name: 'web-01' }, input: { id: 'a' } });
    await e.ops.start('test.hold', { resource: { type: 'vm', name: 'web-01' }, input: { id: 'b' } });
    await e.ops.start('test.hold', { resource: { type: 'vm', name: 'api-01' }, input: { id: 'c' } });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(order.sort(), ['start a', 'start c'], 'b waits for a; c runs beside a');
    gates.a.open();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(order.includes('start b'), 'b starts once a is done');
    gates.b.open();
    gates.c.open();
    await e.ops.idle();
  } finally {
    await close(e);
  }
});

test('at most perAccount operations at a time in one cloud account', async () => {
  const e = await engine({ perAccount: 1 });
  try {
    const running = new Set();
    let most = 0;
    e.ops.define('test.count', {
      label: () => 'Count',
      steps: [{ key: 'count', label: 'Count', run: async (ctx) => {
        running.add(ctx.op.id);
        most = Math.max(most, running.size);
        await new Promise((r) => setTimeout(r, 15));
        running.delete(ctx.op.id);
      } }],
    });
    for (const name of ['a', 'b', 'c']) await e.ops.start('test.count', { resource: { type: 'vm', name }, account: null });
    await e.ops.idle();
    assert.equal(most, 3, 'no account: no limit');
    // The account limit, without an account record: the provider is only looked up when the record exists.
    most = 0;
    for (const name of ['d', 'e', 'f']) await e.ops.start('test.count', { resource: { type: 'vm', name }, account: 'stevie-prod' });
    await e.ops.idle();
    assert.equal(most, 1, 'one at a time in stevie-prod');
  } finally {
    await close(e);
  }
});

test('a failed step fails the operation in words; a fault is logged, not shown; retry runs from the failed step', async () => {
  const e = await engine();
  try {
    let tries = 0;
    let firstRuns = 0;
    let bugRuns = 0;
    const failures = [];
    e.ops.define('test.flaky', {
      label: () => 'Flaky work',
      steps: [
        { key: 'first', label: 'First', run: async () => { firstRuns += 1; } },
        { key: 'quota', label: 'Ask the cloud', run: async () => { tries += 1; if (tries === 1) throw new CloudError('quota', 'The account has no more CPUs in africa-south1.'); } },
        { key: 'bug', label: 'Our own step', run: async () => { bugRuns += 1; if (bugRuns === 1) throw new TypeError('x is undefined at line 42'); } },
      ],
      failed: async (ctx, err) => failures.push(err.message),
    });
    const { id } = await e.ops.start('test.flaky', { resource: { type: 'vm', name: 'web-01' }, person: STEVIE });
    await e.ops.idle();
    let op = await e.ops.get(id);
    assert.deepEqual([op.status, op.error], ['failed', { code: 'quota', message: 'The account has no more CPUs in africa-south1.', step: 'quota' }]);
    assert.equal(op.retryable, true);
    assert.ok(e.events.some((ev) => ev.type === 'infrastructure.operation.failed' && ev.payload.reason === op.error.message));

    await e.ops.retry(id, STEVIE);
    await e.ops.idle();
    op = await e.ops.get(id);
    assert.equal(op.status, 'failed');
    assert.equal(op.error.code, 'internal_error');
    assert.doesNotMatch(op.error.message, /line 42/, 'a fault is not shown to people');
    assert.ok(e.lines.some((l) => l.level === 'error' && /line 42/.test(l.m)), 'it is logged');

    await e.ops.retry(id, STEVIE);
    await e.ops.idle();
    op = await e.ops.get(id);
    assert.equal(op.status, 'succeeded');
    assert.equal(firstRuns, 1, 'a finished step never runs again');
    assert.equal(failures.length, 2);
    await assert.rejects(e.ops.retry(id, STEVIE), (err) => err.status === 409);
  } finally {
    await close(e);
  }
});

test('cancel: a queued operation never runs; a running one stops, and its finished steps are undone', async () => {
  const e = await engine();
  try {
    const undone = [];
    const held = gate();
    e.ops.define('test.cancel', {
      label: (op) => `Make ${op.resource.name}`,
      steps: [
        { key: 'make', label: 'Make it', run: async () => ({ state: { made: true } }), undo: async (ctx) => undone.push(['make', ctx.state.made]) },
        { key: 'wait', label: 'Wait', run: (ctx) => waitFor(held, ctx) },
      ],
      cancelled: async (ctx) => undone.push(['cancelled', ctx.op.status]),
    });
    const running = await e.ops.start('test.cancel', { resource: { type: 'vm', name: 'web-01' }, person: STEVIE });
    const queued = await e.ops.start('test.cancel', { resource: { type: 'vm', name: 'web-01' }, person: STEVIE });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await e.ops.cancel(queued.id, STEVIE)).status, 'cancelled');
    const after = await e.ops.cancel(running.id, STEVIE);
    assert.equal(after.status, 'cancelled');
    assert.deepEqual(undone, [['cancelled', 'cancelled'], ['make', true], ['cancelled', 'cancelled']]);
    const op = await e.ops.get(running.id);
    assert.ok(op.log.some((l) => l.text === 'Undone: Make it'));
    await assert.rejects(e.ops.cancel(running.id, STEVIE), (err) => err.status === 409);
  } finally {
    await close(e);
  }
});

test('cancel and retry need the draft permission; a refusal is audited', async () => {
  const e = await engine();
  try {
    const held = gate();
    e.ops.define('test.perm', { label: () => 'Hold', steps: [{ key: 'hold', label: 'Hold', run: (ctx) => waitFor(held, ctx) }] });
    const { id } = await e.ops.start('test.perm', { resource: { type: 'vm', name: 'web-01' } });
    await assert.rejects(e.ops.cancel(id, NALEDI), (err) => err.status === 403);
    assert.ok(e.audit.some((a) => a.action === 'access.refused' && a.actor === 'naledi-k' && a.permission === 'draft'));
    held.open();
    await e.ops.idle();
  } finally {
    await close(e);
  }
});

test('a stop leaves the operation running on disk; the next start carries on from its step, and does nothing twice', async () => {
  const dir = await tempDir();
  const queue = createTestServerManager().queue();
  const made = [];
  const define = (ops, held) => ops.define('test.resume', {
    label: () => 'Resume me',
    steps: [
      { key: 'one', label: 'Make a thing', run: async () => { made.push('thing'); return { state: { thing: 'made' } }; } },
      { key: 'two', label: 'Wait for it', run: (ctx) => waitFor(held, ctx) },
      { key: 'three', label: 'Finish', run: async (ctx) => { made.push(`finish with ${ctx.state.thing}`); } },
    ],
  });
  const first = await engine({ dir, queue });
  define(first.ops, gate());
  const { id } = await first.ops.start('test.resume', { resource: { type: 'vm', name: 'web-01' } });
  await new Promise((r) => setTimeout(r, 30));
  await first.ops.close();
  let op = await first.repos.operations.get(id);
  assert.deepEqual([op.status, op.steps.map((s) => s.status)], ['running', ['done', 'running', 'pending']]);
  assert.match(op.body, /Stopped with the server during "Wait for it"/);

  const second = await engine({ dir, queue: createTestServerManager().queue() });
  const open = gate();
  open.open();
  define(second.ops, open);
  // A type this server doesn't run yet is left alone.
  await second.repos.operations.write({ ...op, id: 'op_unknowntype', type: 'test.notyet' });
  await second.ops.recover();
  await second.ops.idle();
  op = await second.ops.get(id);
  assert.equal(op.status, 'succeeded');
  assert.deepEqual(made, ['thing', 'finish with made'], 'the first step ran once, and its state survived the restart');
  assert.equal((await second.ops.get('op_unknowntype')).status, 'running');
  await close(second);
});
