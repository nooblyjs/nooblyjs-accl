// The mock cloud (architecture.md §6.3): one account's "cloud" in a file, <dataDir>/infrastructure/mock-cloud/<account>.yaml,
// so it outlives a restart like a real one. Resources change through operations that finish `units` × stepMs after
// they start (stepMs 0: at once); an operation is applied the first time anyone looks after it is due. It touches
// nothing outside this process.
//
// For tests and demos it also fails on purpose (failAt) and changes behind Noobly Cloud's back (outOfBand), as a
// person in the cloud console would.
import crypto from 'node:crypto';
import { CloudError } from '../errors.js';

const DAY = 86_400_000;

export const mockId = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex')}`;

export class MockCloud {
  /**
   * @param {object} o
   * @param {object} o.store      the accelerator's FsStore
   * @param {string} o.accountId
   * @param {string} o.cloud      'gcp' or 'aws': what this mock pretends to be
   * @param {number} [o.stepMs]   how long one unit of cloud work takes
   * @param {() => number} [o.now]
   */
  constructor({ store, accountId, cloud, stepMs = 1200, now = () => Date.now() }) {
    this.store = store;
    this.file = ['mock-cloud', `${accountId}.yaml`];
    this.accountId = accountId;
    this.cloud = cloud;
    this.stepMs = stepMs;
    this.now = now;
    this.state = null;
    this.failures = [];
  }

  async load() {
    if (!this.state) {
      const saved = await this.store.readYaml(this.file);
      this.state = { account: this.accountId, cloud: this.cloud, resources: saved?.resources ?? [], operations: saved?.operations ?? [] };
    }
    if (this.settle()) await this.save();
    return this.state;
  }

  save() {
    return this.store.withLock(this.file, () => this.store.writeYaml(this.file, this.state));
  }

  /** Applies every operation that is due. True when something changed. */
  settle(at = this.now()) {
    let changed = false;
    for (const op of this.state.operations) {
      if (op.applied || new Date(op.doneAt).getTime() > at) continue;
      const i = this.state.resources.findIndex((r) => r.id === op.resource);
      if (i >= 0) {
        if (op.after === null) this.state.resources.splice(i, 1);
        else Object.assign(this.state.resources[i], op.after);
      }
      op.applied = true;
      changed = true;
    }
    // Finished operations are kept a day, so a restart can still ask about one.
    const before = this.state.operations.length;
    this.state.operations = this.state.operations.filter((op) => !op.applied || at - new Date(op.doneAt).getTime() < DAY);
    return changed || this.state.operations.length !== before;
  }

  /** Changes the cloud and saves it. `fn(state)` returns what the caller gets back. */
  async mutate(fn) {
    await this.load();
    const result = await fn(this.state);
    await this.save();
    return result;
  }

  /** Starts an operation on a resource; `after` is what it becomes (null: it is gone). Returns the handle. */
  begin(state, resourceId, action, after, units = 1) {
    const at = this.now();
    const op = { id: mockId('op'), resource: resourceId, action, startedAt: new Date(at).toISOString(), doneAt: new Date(at + units * this.stepMs).toISOString(), after, applied: false };
    state.operations.push(op);
    return { kind: 'mock', id: op.id };
  }

  /** Where an operation is: { done, fraction, action }. Unknown operations count as done (the cloud forgot them). */
  async progress(handle) {
    const state = await this.load();
    const op = state.operations.find((o) => o.id === handle?.id);
    if (!op || op.applied) return { done: true, fraction: 1, action: op?.action ?? null };
    const start = new Date(op.startedAt).getTime();
    const end = new Date(op.doneAt).getTime();
    return { done: false, fraction: end > start ? Math.min(0.99, (this.now() - start) / (end - start)) : 0, action: op.action };
  }

  async resources(filter = () => true) {
    const state = await this.load();
    return state.resources.filter(filter).map((r) => structuredClone(r));
  }

  // ---------- failing and changing on purpose ----------

  /** The next call of `method` ('compute.create') throws a CloudError; every call, with once: false. */
  failAt(method, { once = true, code = 'unavailable', message } = {}) {
    this.failures.push({ method, once, code, message });
  }

  /** Called by the provider at the start of each method. */
  check(method) {
    const i = this.failures.findIndex((f) => f.method === method);
    if (i < 0) return;
    const failure = this.failures[i];
    if (failure.once) this.failures.splice(i, 1);
    throw new CloudError(failure.code, failure.message ?? `The mock cloud failed ${method} on purpose.`);
  }

  /** A change made in the cloud console: `patch` is merged into the resource; null deletes it. */
  async outOfBand(resourceId, patch) {
    return this.mutate((state) => {
      const i = state.resources.findIndex((r) => r.id === resourceId);
      if (i < 0) throw new Error(`The mock cloud has no resource ${resourceId}.`);
      if (patch === null) state.resources.splice(i, 1);
      else Object.assign(state.resources[i], patch);
      return true;
    });
  }
}
