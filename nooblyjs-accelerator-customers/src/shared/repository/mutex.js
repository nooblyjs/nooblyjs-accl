/**
 * @fileoverview In-process keyed mutex.
 *
 * Serialises async work per key (a document id, a unique-index value, a
 * counter name). Single-node only; multi-node deployments need core's
 * conditional writes (Architecture §6.3, C2/C5).
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

class KeyedMutex {
  constructor() {
    this.tails_ = new Map();
  }

  /**
   * Waits for the lock on `key`.
   *
   * @param {string} key - Lock key
   * @return {Promise<function(): void>} Release function
   */
  async acquire(key) {
    const prev = this.tails_.get(key) || Promise.resolve();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const tail = prev.then(() => held);
    this.tails_.set(key, tail);
    await prev;
    return () => {
      release();
      if (this.tails_.get(key) === tail) this.tails_.delete(key);
    };
  }

  /**
   * Acquires several keys in sorted order (deadlock-free) and runs `fn`.
   *
   * @param {string|string[]} keys - Lock key(s)
   * @param {function(): Promise<*>} fn - Work to run under the lock
   * @return {Promise<*>} Result of `fn`
   */
  async run(keys, fn) {
    const sorted = [...new Set([].concat(keys))].sort();
    const releases = [];
    try {
      for (const key of sorted) releases.push(await this.acquire(key));
      return await fn();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  /** @return {number} Number of keys currently held or awaited */
  get size() {
    return this.tails_.size;
  }
}

module.exports = KeyedMutex;
