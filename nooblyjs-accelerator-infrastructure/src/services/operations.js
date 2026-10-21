// The operations engine (architecture.md §7): anything that takes longer than a request. An operation is a record
// (operations/<id>.md, its body the log) with a list of steps; it is queued on the launcher's queue and worked in this
// process, at most `perAccount` at a time per cloud account and one at a time per resource (a stop waits for the
// launch). Each step is idempotent: it checks the record's saved state and the cloud before acting, so running it
// again after a crash never creates anything twice.
//
// When the server stops, a running operation stays "running" on disk and recover() picks it up at the next start, at
// the step it was on. Cancel stops a running operation at its next safe point and undoes the steps that define undo.
import { newId } from '../util/ids.js';
import { HttpError, notFound } from '../util/errors.js';
import { needs } from '../util/http.js';
import { isCloudError } from '../providers/errors.js';

const QUEUE = 'infrastructure-operations';
const ACTIVE = new Set(['queued', 'running']);
/** How often a running step may write its progress (a cloud wait reports many times a second). */
const PROGRESS_EVERY_MS = 1000;

export const who = (person) => (person ? { id: person.id, name: person.name ?? person.id, ...(person.kind === 'agent' ? { kind: 'agent' } : {}) } : null);
export const resourceKey = (resource) => (resource ? `${resource.type}:${resource.name}` : null);
export const inProgress = (op) => ACTIVE.has(op?.status);

/**
 * @param {object} o
 * @param {object} o.repos
 * @param {object} o.host         events (worded), audit
 * @param {object} o.log
 * @param {object} o.queue        the launcher's queue (nooblyjs-core): enqueue / dequeue by name
 * @param {object} o.providers
 * @param {object} o.secrets      scrubs the log
 * @param {() => number} o.now
 * @param {number} [o.perAccount]
 */
export function createOperations({ repos, host, log, queue, providers, secrets, now, perAccount = 4 }) {
  const types = new Map();
  /** id → { key, account, controller, reason, promise } */
  const running = new Map();
  /** Queued ids waiting for their resource or account to be free, oldest first. */
  const waiting = [];
  let pumping = null;
  let again = false;
  let closed = false;

  const iso = () => new Date(now()).toISOString();
  const line = (text) => `${iso()}  ${secrets.scrub(text)}\n`;
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor ?? null });
  const facts = (op) => ({
    operationId: op.id, type: op.type, label: op.label, resource: op.resource, account: op.account ?? null,
    status: op.status, progress: op.progress ?? 0, step: current(op)?.label ?? null,
  });
  const current = (op) => op.steps?.find((s) => s.status === 'running') ?? op.steps?.find((s) => s.status === 'pending' || s.status === 'failed');

  /** Read-modify-write; `text` (if any) is appended to the log. */
  const update = (id, fn, text) => repos.operations.update(id, async (op) => {
    if (!op) return null;
    const next = await fn(op);
    if (!next) return null;
    return text ? { ...next, body: `${next.body ?? ''}${line(text)}` } : next;
  });

  const progressOf = (steps, fraction = 0) => {
    const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
    return Math.min(100, Math.round(((done + fraction) / steps.length) * 100));
  };

  // ---------------------------------------------------------------- types

  /**
   * Defines an operation type.
   * @param {string} type   e.g. 'account.connect'
   * @param {object} def
   * @param {(op) => string} def.label         "Connect stevie-prod"
   * @param {string} [def.verb]                "Connecting", for "Connecting · 2 of 3"
   * @param {{ key: string, label: string, run: (ctx) => Promise<{ state?: object, skipped?: boolean }|void>, undo?: (ctx) => Promise<void> }[]} def.steps
   * @param {(ctx) => Promise<void>} [def.succeeded]
   * @param {(ctx, err) => Promise<void>} [def.failed]
   * @param {(ctx) => Promise<void>} [def.cancelled]
   */
  function define(type, def) {
    if (types.has(type)) throw new Error(`Operation type ${type} is defined twice.`);
    if (!def.steps?.length) throw new Error(`Operation type ${type} has no steps.`);
    types.set(type, def);
  }

  // ---------------------------------------------------------------- starting

  /** Queues an operation. Returns its view at once; the work happens in the background. */
  async function start(type, { resource, account = null, input = {}, person = null }) {
    const def = types.get(type);
    if (!def) throw new Error(`No operation type ${type}.`);
    const op = {
      id: newId('op'),
      type,
      resource,
      account,
      input,
      status: 'queued',
      progress: 0,
      steps: def.steps.map((s) => ({ key: s.key, label: s.label, status: 'pending' })),
      state: {},
      requestedBy: who(person),
      createdAt: iso(),
    };
    op.label = def.label(op);
    op.body = line(`Queued: ${op.label}${person ? ` (by ${person.name ?? person.id})` : ''}`);
    await repos.operations.write(op);
    await emit('infrastructure.operation.queued', facts(op), person?.id);
    await queue.enqueue(QUEUE, { id: op.id });
    pump();
    return view(op);
  }

  // ---------------------------------------------------------------- scheduling

  /** Takes everything off the queue, then starts what may start. Calls while pumping run once more after. */
  function pump() {
    if (closed) return Promise.resolve();
    if (pumping) {
      again = true;
      return pumping;
    }
    pumping = (async () => {
      try {
        do {
          again = false;
          for (let job = await queue.dequeue(QUEUE); job; job = await queue.dequeue(QUEUE)) {
            if (!waiting.includes(job.id) && !running.has(job.id)) waiting.push(job.id);
          }
          await startEligible();
        } while (again && !closed);
      } catch (err) {
        log.error(`operations queue: ${err.stack ?? err.message}`);
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  }

  async function startEligible() {
    for (const id of [...waiting]) {
      if (closed) return;
      const op = await repos.operations.get(id);
      if (!op || !inProgress(op) || !types.has(op.type)) {
        waiting.splice(waiting.indexOf(id), 1);
        continue;
      }
      const key = resourceKey(op.resource);
      const busy = [...running.values()];
      if (key && busy.some((r) => r.key === key)) continue;
      if (op.account && busy.filter((r) => r.account === op.account).length >= perAccount) continue;
      waiting.splice(waiting.indexOf(id), 1);
      const entry = { key, account: op.account, controller: new AbortController(), reason: null };
      running.set(id, entry);
      entry.promise = execute(id, entry)
        .catch((err) => log.error(`operation ${id}: ${err.stack ?? err.message}`))
        .finally(() => {
          running.delete(id);
          pump();
        });
    }
  }

  // ---------------------------------------------------------------- running

  async function context(op, entry) {
    const account = op.account ? await repos.accounts.get(op.account) : null;
    const provider = account ? await providers.forAccount(account) : null;
    let lastProgress = 0;
    const ctx = {
      op,
      input: op.input ?? {},
      state: { ...(op.state ?? {}) },
      account,
      provider,
      signal: entry.controller.signal,
      now,
      iso,
      log: async (text) => {
        await update(op.id, (r) => r, text);
      },
      /** Keeps state now (a cloud resource's id, an operation handle), before waiting on anything. */
      save: async (patch) => {
        Object.assign(ctx.state, patch);
        await update(op.id, (r) => ({ ...r, state: { ...(r.state ?? {}), ...patch } }));
      },
      /** Within the current step: `fraction` (0–1) of it is done. */
      progress: async (fraction) => {
        if (now() - lastProgress < PROGRESS_EVERY_MS) return;
        lastProgress = now();
        const next = await update(op.id, (r) => ({ ...r, progress: progressOf(r.steps, fraction) }));
        if (next) await emit('infrastructure.operation.progress', facts(next), next.requestedBy?.id);
      },
      /** Waits for a cloud operation handle, reporting progress and stopping when the operation is cancelled. */
      wait: (handle) => provider.waitFor(handle, { signal: entry.controller.signal, onProgress: (f) => ctx.progress(f).catch(() => {}) }),
    };
    return ctx;
  }

  async function execute(id, entry) {
    const started = await update(id, (r) => (inProgress(r) ? { ...r, status: 'running', startedAt: r.startedAt ?? iso() } : null),
      'Started');
    if (!started) return;
    if (started.cancelRequested) return finishCancelled(id, entry);
    const def = types.get(started.type);
    let ctx;
    try {
      ctx = await context(started, entry);
    } catch (err) {
      return fail(id, null, err);
    }
    await emit('infrastructure.operation.started', facts(started), started.requestedBy?.id);

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      const op = await repos.operations.get(id);
      if (op.steps[i].status === 'done' || op.steps[i].status === 'skipped') continue;
      if (op.cancelRequested) return finishCancelled(id, entry);
      const marked = await update(id, (r) => ({ ...r, steps: r.steps.map((s, j) => (j === i ? { ...s, status: 'running', startedAt: iso() } : s)), progress: progressOf(r.steps) }),
        `Step ${i + 1} of ${def.steps.length}: ${step.label}`);
      await emit('infrastructure.operation.progress', facts(marked), marked.requestedBy?.id);
      ctx.op = marked;
      let result;
      try {
        if (entry.controller.signal.aborted) throw entry.controller.signal.reason ?? new Error('aborted');
        result = (await step.run(ctx)) ?? {};
      } catch (err) {
        if (entry.reason === 'close') {
          await update(id, (r) => r, `Stopped with the server during "${step.label}"; it carries on at the next start.`);
          return;
        }
        if (entry.reason === 'cancel') return finishCancelled(id, entry);
        return fail(id, i, err, ctx);
      }
      if (result.state) Object.assign(ctx.state, result.state);
      const status = result.skipped ? 'skipped' : 'done';
      const after = await update(id, (r) => {
        const steps = r.steps.map((s, j) => (j === i ? { ...s, status, finishedAt: iso() } : s));
        return { ...r, steps, state: { ...(r.state ?? {}), ...(result.state ?? {}) }, progress: progressOf(steps) };
      }, result.skipped ? `Skipped: ${step.label}${result.reason ? ` (${result.reason})` : ''}` : `Done: ${step.label}`);
      await emit('infrastructure.operation.progress', facts(after), after.requestedBy?.id);
      if (entry.reason === 'close') return;
    }

    const done = await update(id, (r) => ({ ...r, status: 'succeeded', progress: 100, finishedAt: iso() }), `Finished: ${started.label}`);
    ctx.op = done;
    try {
      await def.succeeded?.(ctx);
    } catch (err) {
      log.error(`operation ${id} (${done.type}) succeeded, but its follow-up failed: ${err.stack ?? err.message}`);
    }
    await emit('infrastructure.operation.succeeded', facts(done), done.requestedBy?.id);
  }

  /** A failed step: the operation is failed, with a message a person may see. Cloud errors say what the cloud said. */
  async function fail(id, index, err, ctx = null) {
    const op = await repos.operations.get(id);
    const step = index === null ? null : op.steps[index];
    const message = isCloudError(err) ? err.message
      : `Something went wrong${step ? ` while "${step.label}"` : ''}. It has been logged.`;
    if (!isCloudError(err)) log.error(`operation ${id} (${op.type})${step ? ` step ${step.key}` : ''}: ${err.stack ?? err.message}`);
    const failed = await update(id, (r) => ({
      ...r,
      status: 'failed',
      finishedAt: iso(),
      steps: r.steps.map((s, j) => (j === index ? { ...s, status: 'failed', finishedAt: iso() } : s)),
      error: { code: isCloudError(err) ? err.code : 'internal_error', message, step: step?.key ?? null },
    }), `Failed${step ? ` at "${step.label}"` : ''}: ${message}`);
    if (ctx) ctx.op = failed;
    try {
      await types.get(failed.type)?.failed?.(ctx ?? { op: failed, input: failed.input, state: failed.state }, err);
    } catch (hookErr) {
      log.error(`operation ${id} failed, and so did its failed() hook: ${hookErr.message}`);
    }
    await emit('infrastructure.operation.failed', { ...facts(failed), stepLabel: step?.label ?? null, reason: message }, failed.requestedBy?.id);
  }

  /**
   * Undoes the steps that know how (newest first) — the finished ones, and the one that was running when the cancel
   * came, which may be half done (an undo must cope with that) — then marks the operation cancelled.
   */
  async function finishCancelled(id, entry = null) {
    const op = await repos.operations.get(id);
    const def = types.get(op.type);
    if (def && op.status === 'running') {
      let ctx = null;
      try {
        ctx = await context(op, entry ?? { controller: new AbortController() });
      } catch (err) {
        log.warn(`operation ${id}: could not undo: ${err.message}`);
      }
      for (let i = op.steps.length - 1; ctx && i >= 0; i--) {
        if (!['done', 'running'].includes(op.steps[i].status) || !def.steps[i].undo) continue;
        try {
          await def.steps[i].undo({ ...ctx, signal: new AbortController().signal });
          await update(id, (r) => r, `Undone: ${def.steps[i].label}`);
        } catch (err) {
          log.warn(`operation ${id}: undo of ${def.steps[i].key} failed: ${err.message}`);
          await update(id, (r) => r, `Could not undo "${def.steps[i].label}": ${isCloudError(err) ? err.message : 'see the server log'}`);
        }
      }
    }
    const cancelled = await update(id, (r) => ({ ...r, status: 'cancelled', finishedAt: iso() }),
      `Cancelled${op.cancelledBy ? ` by ${op.cancelledBy.name}` : ''}`);
    try {
      await def?.cancelled?.({ op: cancelled, input: cancelled.input, state: cancelled.state });
    } catch (err) {
      log.error(`operation ${id}: cancelled() hook: ${err.message}`);
    }
    await emit('infrastructure.operation.cancelled', facts(cancelled), cancelled.cancelledBy?.id ?? null);
    return cancelled;
  }

  // ---------------------------------------------------------------- what people can ask

  /** Cancels a queued or running operation. A running one stops at its next safe point. Needs `draft`. */
  async function cancel(id, person) {
    const op = await repos.operations.get(id);
    if (!op) throw notFound(`No operation ${id}.`);
    await needs(host, person, 'draft', `cancel "${op.label}"`);
    if (!inProgress(op)) throw new HttpError(409, 'conflict', `This operation has already ${op.status === 'succeeded' ? 'finished' : op.status}.`);
    await update(id, (r) => ({ ...r, cancelRequested: true, cancelledBy: who(person) }), `Cancel asked for by ${person?.name ?? person?.id}`);
    const entry = running.get(id);
    if (entry) {
      entry.reason = 'cancel';
      entry.controller.abort(new Error('cancelled'));
      await entry.promise;
    } else {
      const queued = waiting.indexOf(id);
      if (queued >= 0) waiting.splice(queued, 1);
      await finishCancelled(id);
    }
    return view(await repos.operations.get(id));
  }

  /** Runs a failed operation again from the step that failed. Needs `draft`. */
  async function retry(id, person) {
    const op = await repos.operations.get(id);
    if (!op) throw notFound(`No operation ${id}.`);
    await needs(host, person, 'draft', `retry "${op.label}"`);
    if (op.status !== 'failed') throw new HttpError(409, 'conflict', 'Only a failed operation can be retried.');
    if (!types.has(op.type)) throw new HttpError(409, 'conflict', 'This kind of operation cannot run on this server yet.');
    const next = await update(id, (r) => ({
      ...r,
      status: 'queued',
      error: null,
      finishedAt: null,
      retries: (r.retries ?? 0) + 1,
      steps: r.steps.map((s) => (s.status === 'failed' ? { ...s, status: 'pending', finishedAt: null } : s)),
    }), `Retry asked for by ${person?.name ?? person?.id}`);
    await queue.enqueue(QUEUE, { id });
    pump();
    return view(next);
  }

  // ---------------------------------------------------------------- views

  function statusText(op) {
    const total = op.steps?.length ?? 0;
    const index = op.steps?.findIndex((s) => s.status === 'running' || s.status === 'pending') ?? -1;
    switch (op.status) {
      case 'queued': return 'Queued';
      case 'running': {
        const verb = types.get(op.type)?.verb ?? 'Working';
        return total > 1 ? `${verb} · ${index < 0 ? total : index + 1} of ${total}` : verb;
      }
      case 'succeeded': return 'Finished';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
      default: return op.status;
    }
  }

  const TONE = { queued: 'neutral', running: 'warning', succeeded: 'success', failed: 'danger', cancelled: 'neutral' };

  function view(op) {
    return {
      id: op.id,
      type: op.type,
      label: op.label,
      resource: op.resource,
      account: op.account ?? null,
      status: op.status,
      statusText: statusText(op),
      tone: TONE[op.status] ?? 'neutral',
      progress: op.progress ?? 0,
      steps: (op.steps ?? []).map((s) => ({ key: s.key, label: s.label, status: s.status })),
      requestedBy: op.requestedBy ?? null,
      createdAt: op.createdAt,
      startedAt: op.startedAt ?? null,
      finishedAt: op.finishedAt ?? null,
      error: op.error ?? null,
      cancellable: inProgress(op),
      retryable: op.status === 'failed' && types.has(op.type),
    };
  }

  const parseLog = (body) => String(body ?? '').split('\n').filter(Boolean).map((l) => {
    const at = l.slice(0, 24);
    return { at, text: l.slice(26) };
  });

  return {
    define,
    start,
    cancel,
    retry,
    view,
    async get(id) {
      const op = await repos.operations.get(id);
      if (!op) throw notFound(`No operation ${id}.`);
      return { ...view(op), log: parseLog(op.body) };
    },
    /** Newest first. `resource` is 'type:name'; status 'active' keeps the ones still going. */
    async list({ resource, status, account } = {}) {
      return (await repos.operations.list())
        .filter((op) => !resource || resourceKey(op.resource) === resource)
        .filter((op) => !account || op.account === account)
        .filter((op) => (status === 'active' ? inProgress(op) : !status || op.status === status))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(view);
    },
    /** The resources ('type:name') with an operation queued or running. */
    async busy() {
      return new Set((await repos.operations.list()).filter(inProgress).map((op) => resourceKey(op.resource)));
    },
    /**
     * At start: queue again whatever was waiting or under way when the server stopped. A cancel asked for just before
     * a stop still stands. Operations of a type this server doesn't run yet are left as they are.
     */
    async recover() {
      for (const op of await repos.operations.list()) {
        if (!inProgress(op)) continue;
        if (!types.has(op.type)) {
          log.info(`operation ${op.id} (${op.type}) waits for a server that runs that type; left as it is.`);
          continue;
        }
        if (op.cancelRequested) await finishCancelled(op.id);
        else await queue.enqueue(QUEUE, { id: op.id });
      }
      await pump();
    },
    /** Resolves when nothing that can run is queued or running (tests, and close()). */
    async idle() {
      for (;;) {
        if (pumping) await pumping;
        if (!running.size) {
          const startable = await Promise.all(waiting.map((id) => repos.operations.get(id)));
          if (!startable.some((op) => op && inProgress(op) && types.has(op.type))) return;
          await pump();
          if (!running.size) return;
        }
        await Promise.all([...running.values()].map((r) => r.promise));
      }
    },
    /** Stops: running operations stop at their next safe point and stay "running" on disk, for recover(). */
    async close() {
      closed = true;
      for (const entry of running.values()) {
        entry.reason = 'close';
        entry.controller.abort(new Error('the server is stopping'));
      }
      await Promise.all([...running.values()].map((r) => r.promise));
      if (pumping) await pumping;
    },
  };
}
