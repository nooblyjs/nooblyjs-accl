/**
 * @fileoverview Human-readable sequence numbers (`CUS-000123`, `CS-000045`).
 *
 * Counters are documents in the `{prefix}_counters` container, incremented
 * under an in-process lock. Multi-node needs core `cache.increment` (C5).
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const KeyedMutex = require('./mutex');

class Counter {
  /**
   * @param {Object} dataService - Core dataService
   * @param {string} container - Container name, e.g. `cx_counters`
   */
  constructor(dataService, container) {
    this.dataService = dataService;
    this.container = container;
    this.mutex = new KeyedMutex();
    this.keys_ = new Map();
  }

  /**
   * Returns the next value of a named sequence.
   *
   * @param {string} name - Sequence name (one per entity and tenant)
   * @return {Promise<number>} Next value, starting at 1
   */
  async next(name) {
    return this.mutex.run(`counter:${name}`, async () => {
      let key = this.keys_.get(name);
      let doc = key ? await this.dataService.getByUuid(this.container, key) : null;
      if (!doc) {
        const all = await this.dataService.listAll(this.container);
        doc = all.find((d) => d.name === name) || null;
        if (doc) key = doc.id;
      }
      if (!doc) {
        key = await this.dataService.add(this.container, { name, value: 1 });
        await this.dataService.update(this.container, key, { id: key, name, value: 1 });
        this.keys_.set(name, key);
        return 1;
      }
      const value = doc.value + 1;
      await this.dataService.update(this.container, key, { ...doc, id: key, value });
      this.keys_.set(name, key);
      return value;
    });
  }

  /**
   * Formats a sequence value.
   *
   * @param {string} prefix - e.g. `CUS`
   * @param {number} value - Sequence value
   * @param {number} [width=6] - Zero padding
   * @return {string} e.g. `CUS-000123`
   */
  static format(prefix, value, width = 6) {
    return `${prefix}-${String(value).padStart(width, '0')}`;
  }

  /**
   * Allocates the next formatted number for a prefix and tenant.
   *
   * @param {string} prefix - e.g. `CUS`
   * @param {string} [tenantId='default'] - Tenant (sequences are per tenant)
   * @return {Promise<string>} e.g. `CUS-000001`
   */
  async nextNumber(prefix, tenantId = 'default') {
    return Counter.format(prefix, await this.next(`${tenantId}:${prefix}`));
  }
}

module.exports = Counter;
