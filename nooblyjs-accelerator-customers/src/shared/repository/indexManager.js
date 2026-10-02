/**
 * @fileoverview Secondary and unique indexes kept in core `cache`.
 *
 * Each index entry is one cache key, `{namespace}:idx:{index}:{tenant}:{values}`,
 * holding the array of matching document ids. Entries are rebuilt from the
 * container on startup (`rebuild`). Index values are sparse: a document with
 * a missing value for any indexed field is not indexed. String values are
 * compared case-insensitively.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { getPath } = require('../schema');
const { conflict } = require('../errors');

class IndexManager {
  /**
   * @param {Object} schema - Entity schema (its `indexes` are maintained)
   * @param {Object} cache - Core cache service (`get`/`put`/`delete`)
   * @param {string} namespace - Cache key namespace, e.g. `cx_customers`
   */
  constructor(schema, cache, namespace) {
    this.schema = schema;
    this.cache = cache;
    this.namespace = namespace;
    this.indexes = new Map(schema.indexes.map((ix) => [ix.name, ix]));
  }

  /**
   * @param {string} name - Index name
   * @return {Object} Index definition
   * @throws {Error} When the index does not exist
   */
  index(name) {
    const ix = this.indexes.get(name);
    if (!ix) throw new Error(`Unknown index '${name}' on ${this.schema.name}`);
    return ix;
  }

  /**
   * Builds the cache key for a set of values, or null when any value is missing.
   *
   * @param {Object} ix - Index definition
   * @param {string} tenantId - Tenant
   * @param {Array<*>} values - One value per index field
   * @return {?string} Cache key
   */
  keyFor(ix, tenantId, values) {
    if (values.some((v) => v === undefined || v === null || v === '')) return null;
    const norm = values.map((v) => (typeof v === 'string' ? v.toLowerCase() : v));
    return `${this.namespace}:idx:${ix.name}:${tenantId}:${JSON.stringify(norm)}`;
  }

  /**
   * @param {Object} ix - Index definition
   * @param {Object} doc - Document
   * @return {?string} Cache key for the document's values
   */
  keyForDoc(ix, doc) {
    return this.keyFor(ix, doc.tenantId, ix.fields.map((f) => getPath(doc, f)));
  }

  /**
   * Returns the ids indexed under the given values.
   *
   * @param {string} name - Index name
   * @param {Array<*>|*} values - Value(s), one per index field
   * @param {string} tenantId - Tenant
   * @return {Promise<string[]>} Matching ids
   */
  async lookup(name, values, tenantId) {
    const key = this.keyFor(this.index(name), tenantId, [].concat(values));
    if (!key) return [];
    return (await this.cache.get(key)) || [];
  }

  /**
   * Cache keys of the unique-index entries a document would occupy. Used as
   * lock keys around uniqueness check + write.
   *
   * @param {Object} doc - Document
   * @return {string[]} Keys
   */
  uniqueKeys(doc) {
    const keys = [];
    for (const ix of this.indexes.values()) {
      if (!ix.unique) continue;
      const key = this.keyForDoc(ix, doc);
      if (key) keys.push(key);
    }
    return keys;
  }

  /**
   * Throws 409 when another document already holds a unique value.
   *
   * @param {Object} doc - Candidate document
   * @param {string} [selfId] - Id to ignore (the document being updated)
   * @return {Promise<void>}
   * @throws {ClientError} 409 conflict naming the index
   */
  async assertUnique(doc, selfId) {
    for (const ix of this.indexes.values()) {
      if (!ix.unique) continue;
      const key = this.keyForDoc(ix, doc);
      if (!key) continue;
      const ids = (await this.cache.get(key)) || [];
      if (ids.some((id) => id !== selfId)) {
        throw conflict(`${this.schema.name} with the same ${ix.fields.join(' + ')} already exists`, {
          index: ix.name, existingId: ids.find((id) => id !== selfId)
        });
      }
    }
  }

  /**
   * Adds a document to every index.
   *
   * @param {Object} doc - Stored document (with id)
   * @return {Promise<void>}
   */
  async add(doc) {
    for (const ix of this.indexes.values()) {
      const key = this.keyForDoc(ix, doc);
      if (!key) continue;
      const ids = (await this.cache.get(key)) || [];
      if (!ids.includes(doc.id)) await this.cache.put(key, [...ids, doc.id]);
    }
  }

  /**
   * Removes a document from every index.
   *
   * @param {Object} doc - Stored document (with id)
   * @return {Promise<void>}
   */
  async remove(doc) {
    for (const ix of this.indexes.values()) {
      const key = this.keyForDoc(ix, doc);
      if (!key) continue;
      const ids = (await this.cache.get(key)) || [];
      const rest = ids.filter((id) => id !== doc.id);
      if (rest.length) await this.cache.put(key, rest);
      else await this.cache.delete(key);
    }
  }

  /**
   * Moves a document between index entries when indexed values changed.
   *
   * @param {Object} before - Previous version
   * @param {Object} after - New version
   * @return {Promise<void>}
   */
  async update(before, after) {
    const changed = [...this.indexes.values()].some((ix) => this.keyForDoc(ix, before) !== this.keyForDoc(ix, after));
    if (!changed) return;
    await this.remove(before);
    await this.add(after);
  }

  /**
   * Rebuilds all entries from the stored documents (cold start).
   *
   * @param {Object[]} docs - Every live document in the container
   * @return {Promise<void>}
   */
  async rebuild(docs) {
    const entries = new Map();
    for (const doc of docs) {
      for (const ix of this.indexes.values()) {
        const key = this.keyForDoc(ix, doc);
        if (!key) continue;
        if (!entries.has(key)) entries.set(key, []);
        entries.get(key).push(doc.id);
      }
    }
    for (const [key, ids] of entries) await this.cache.put(key, ids);
  }

  /**
   * Picks an index usable for an equality filter set.
   *
   * @param {Array<{field: string, op: string, value: *}>} filters - Parsed filters
   * @return {?{name: string, values: Array<*>}} Index and values, when every field of an index has an `eq` filter
   */
  pick(filters) {
    const eq = new Map(filters.filter((f) => f.op === 'eq').map((f) => [f.field, f.value]));
    for (const ix of this.indexes.values()) {
      if (ix.fields.every((f) => eq.has(f))) return { name: ix.name, values: ix.fields.map((f) => eq.get(f)) };
    }
    return null;
  }
}

module.exports = IndexManager;
