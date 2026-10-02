/**
 * @fileoverview BaseRepository: schema-driven persistence on core `dataService`.
 *
 * One container per entity (`{prefix}_{plural}`). Every write validates
 * against the schema, stamps the standard envelope, maintains indexes and the
 * search index, writes an audit entry and emits a domain event. Reads are
 * tenant-checked and PII-masked unless the context holds `pii:read`.
 *
 * Methods that take a context return presented (possibly masked) documents.
 * Services that need raw values use a system context.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { validate, mask, mergePatch, clone, getPath } = require('../schema');
const { notFound, conflict, versionConflict, badRequest } = require('../errors');
const { actorId } = require('../context');
const IndexManager = require('./indexManager');
const KeyedMutex = require('./mutex');
const QueryEngine = require('./queryEngine');
const Counter = require('./counter');

class BaseRepository {
  /**
   * @param {Object} schema - Entity schema from defineSchema()
   * @param {Object} deps
   * @param {Object} deps.dataService - Core dataService
   * @param {Object} deps.cache - Core cache (indexes, optional document cache)
   * @param {string} [deps.containerPrefix='cx'] - Container namespace
   * @param {string} [deps.module] - Owning module, used in event types
   * @param {Object} [deps.events] - DomainEventBus
   * @param {Object} [deps.audit] - AuditService
   * @param {Counter} [deps.counter] - Number allocator (needed when the schema has a numberPrefix)
   * @param {Object} [deps.search] - Core searching service
   * @param {Object} [deps.logger] - Core logger
   * @param {boolean} [deps.cacheDocuments=false] - Read-through document cache
   */
  constructor(schema, deps) {
    if (!deps || !deps.dataService || !deps.cache) {
      throw new Error(`BaseRepository(${schema && schema.name}): dataService and cache are required`);
    }
    this.schema = schema;
    this.dataService = deps.dataService;
    this.cache = deps.cache;
    this.events = deps.events || null;
    this.audit = deps.audit || null;
    this.counter = deps.counter || null;
    this.search = deps.search || null;
    this.logger = deps.logger || null;
    this.module = deps.module || schema.name;
    this.cacheDocuments = Boolean(deps.cacheDocuments);
    this.container = `${deps.containerPrefix || 'cx'}_${schema.plural}`;
    this.indexes = new IndexManager(schema, this.cache, this.container);
    this.mutex = new KeyedMutex();
    if (schema.numberPrefix && !this.counter) {
      throw new Error(`BaseRepository(${schema.name}): a counter is required for numbered entities`);
    }
  }

  /**
   * Rebuilds indexes and the search index from the container. Call once at mount.
   *
   * @return {Promise<number>} Number of live documents
   */
  async init() {
    const docs = (await this.dataService.listAll(this.container)).filter((d) => d && d.id && !d.deletedAt);
    await this.indexes.rebuild(docs);
    if (this.search && this.schema.search.length) {
      for (const doc of docs) await this.indexSearch_(doc);
    }
    return docs.length;
  }

  /**
   * Creates a document.
   *
   * @param {Object} input - Client fields
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {Object} [opts.system] - Trusted fields set by services, bypassing read-only stripping (e.g. `status`)
   * @return {Promise<Object>} Presented document
   * @throws {ClientError} 422 invalid, 409 unique conflict
   */
  async create(input, ctx, { system = {} } = {}) {
    const value = validate(this.schema, input);
    const now = new Date().toISOString();
    const doc = {
      ...value,
      ...clone(system),
      tenantId: ctx.tenantId,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId(ctx),
      updatedBy: actorId(ctx),
      version: 1,
      deletedAt: null
    };
    if (this.schema.numberPrefix && !doc.number) {
      doc.number = await this.counter.nextNumber(this.schema.numberPrefix, ctx.tenantId);
    }
    const stored = await this.mutex.run(this.indexes.uniqueKeys(doc), async () => {
      await this.indexes.assertUnique(doc);
      const id = await this.dataService.add(this.container, clone(doc));
      doc.id = id;
      await this.dataService.update(this.container, id, clone(doc));
      await this.indexes.add(doc);
      return doc;
    });
    await this.afterWrite_(stored);
    await this.audit?.record({ schema: this.schema, entityId: stored.id, action: 'create', before: null, after: stored, ctx });
    this.emit_('created', stored, ctx);
    return this.present(stored, ctx);
  }

  /**
   * Returns a document, or throws 404.
   *
   * @param {string} id - Document id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {boolean} [opts.includeDeleted=false] - Return soft-deleted documents
   * @param {string[]} [opts.fields] - Sparse fieldset
   * @return {Promise<Object>} Presented document
   * @throws {ClientError} 404
   */
  async get(id, ctx, { includeDeleted = false, fields } = {}) {
    const doc = await this.load_(id, ctx, includeDeleted);
    if (!doc) throw notFound(this.schema.name, id);
    return this.present(doc, ctx, fields);
  }

  /**
   * Returns a document or null (no throw).
   *
   * @param {string} id - Document id
   * @param {Object} ctx - Operation context
   * @return {Promise<?Object>} Presented document
   */
  async find(id, ctx) {
    const doc = await this.load_(id, ctx, false);
    return doc ? this.present(doc, ctx) : null;
  }

  /**
   * Applies a JSON merge patch.
   *
   * @param {string} id - Document id
   * @param {Object} patch - Merge patch of client fields
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {number} [opts.expectedVersion] - Optimistic concurrency check (412 on mismatch)
   * @param {Object} [opts.system] - Trusted fields set by services
   * @return {Promise<Object>} Presented document
   * @throws {ClientError} 404, 409, 412, 422
   */
  async update(id, patch, ctx, { expectedVersion, system = {} } = {}) {
    if (this.schema.appendOnly) throw conflict(`${this.schema.name} records are append-only`);
    const cleanPatch = validate(this.schema, patch, { partial: true });
    const result = await this.mutex.run(`doc:${id}`, async () => {
      const before = await this.load_(id, ctx, false);
      if (!before) throw notFound(this.schema.name, id);
      this.checkVersion_(before, expectedVersion);

      const merged = mergePatch(before, { ...cleanPatch, ...clone(system) });
      // Re-validate the whole document so required fields cannot be removed.
      const body = validate(this.schema, stripEnvelope(merged, this.schema));
      const after = applySystem({ ...body, ...envelopeOf(before, this.schema) }, system);
      if (sameContent(before, after)) return { before, after: before, changed: false };

      after.version = before.version + 1;
      after.updatedAt = new Date().toISOString();
      after.updatedBy = actorId(ctx);
      const lockKeys = this.indexes.uniqueKeys(after).filter((k) => !this.indexes.uniqueKeys(before).includes(k));
      await this.mutex.run(lockKeys, async () => {
        await this.indexes.assertUnique(after, id);
        await this.dataService.update(this.container, id, clone(after));
        await this.indexes.update(before, after);
      });
      return { before, after, changed: true };
    });
    if (!result.changed) return this.present(result.after, ctx);
    await this.afterWrite_(result.after);
    const changes = await this.audit?.record({
      schema: this.schema, entityId: id, action: 'update', before: result.before, after: result.after, ctx
    });
    this.emit_('updated', result.after, ctx, changes && changes.changes);
    return this.present(result.after, ctx);
  }

  /**
   * Soft-deletes a document: sets `deletedAt`, drops it from indexes and search.
   *
   * @param {string} id - Document id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {number} [opts.expectedVersion] - Optimistic concurrency check
   * @return {Promise<Object>} Presented document as deleted
   */
  async softDelete(id, ctx, { expectedVersion } = {}) {
    if (this.schema.appendOnly) throw conflict(`${this.schema.name} records are append-only`);
    const { before, after } = await this.mutex.run(`doc:${id}`, async () => {
      const current = await this.load_(id, ctx, false);
      if (!current) throw notFound(this.schema.name, id);
      this.checkVersion_(current, expectedVersion);
      const next = {
        ...current,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: actorId(ctx),
        version: current.version + 1
      };
      await this.dataService.update(this.container, id, clone(next));
      await this.indexes.remove(current);
      return { before: current, after: next };
    });
    await this.cacheDoc_(after);
    await this.unindexSearch_(id);
    await this.audit?.record({ schema: this.schema, entityId: id, action: 'delete', before, after, ctx });
    this.emit_('deleted', after, ctx);
    return this.present(after, ctx);
  }

  /**
   * Permanently removes a document (erasure and retention jobs only).
   *
   * @param {string} id - Document id
   * @param {Object} ctx - Operation context
   * @return {Promise<boolean>} True when removed
   */
  async hardDelete(id, ctx) {
    return this.mutex.run(`doc:${id}`, async () => {
      const current = await this.load_(id, ctx, true);
      if (!current) return false;
      await this.dataService.remove(this.container, id);
      if (!current.deletedAt) await this.indexes.remove(current);
      if (this.cacheDocuments) await this.cache.delete(this.docKey_(id));
      await this.unindexSearch_(id);
      await this.audit?.record({ schema: this.schema, entityId: id, action: 'erase', before: current, after: null, ctx });
      this.emit_('purged', { id, tenantId: current.tenantId }, ctx);
      return true;
    });
  }

  /**
   * Lists documents matching a parsed query.
   *
   * @param {Object} query - Parsed list query (see queryEngine)
   * @param {Object} ctx - Operation context
   * @return {Promise<{items: Object[], total: number, limit: number, offset: number, nextCursor: ?string}>} Page
   * @throws {ClientError} 400 on unknown filter/sort fields
   */
  async list(query, ctx) {
    const q = this.normaliseQuery_(query || {});
    const docs = await this.candidates_(q, ctx);
    const page = QueryEngine.execute(docs, q);
    return { ...page, items: page.items.map((d) => this.present(d, ctx, q.fields)) };
  }

  /**
   * Returns the first document matching simple equality criteria.
   *
   * @param {Object<string, *>} criteria - `{ field: value }`, dotted paths allowed
   * @param {Object} ctx - Operation context
   * @return {Promise<?Object>} Presented document
   */
  async findOne(criteria, ctx) {
    const filters = Object.entries(criteria).map(([field, value]) => ({ field, op: 'eq', value }));
    const page = await this.list({ filters, limit: 1, offset: 0 }, ctx);
    return page.items[0] || null;
  }

  /**
   * Returns documents under an index entry.
   *
   * @param {string} indexName - Index name
   * @param {Array<*>|*} values - Value(s), one per index field
   * @param {Object} ctx - Operation context
   * @return {Promise<Object[]>} Presented documents
   */
  async findByIndex(indexName, values, ctx) {
    const ids = await this.indexes.lookup(indexName, values, ctx.tenantId);
    const docs = await Promise.all(ids.map((id) => this.load_(id, ctx, false)));
    return docs.filter(Boolean).map((d) => this.present(d, ctx));
  }

  /**
   * Full-text lookup through core `searching` (fields listed in `schema.search`).
   *
   * @param {string} text - Search text
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {number} [opts.limit=20] - Maximum results
   * @return {Promise<Object[]>} Presented documents, best match first
   */
  async searchText(text, ctx, { limit = 20 } = {}) {
    if (!this.search || !this.schema.search.length || !text || !String(text).trim()) return [];
    limit = Math.max(1, Math.min(Number(limit) || 20, 100));
    let hits = [];
    try {
      hits = await this.search.search(String(text), { containerName: this.container, prefix: true, maxResults: limit * 3 });
    } catch (err) {
      this.logger?.warn?.(`[BaseRepository] search failed on ${this.container}`, { error: err.message });
      return [];
    }
    const docs = [];
    for (const hit of hits) {
      const doc = await this.load_(hit.id, ctx, false);
      if (doc) docs.push(doc);
      if (docs.length >= limit) break;
    }
    return docs.map((d) => this.present(d, ctx));
  }

  /**
   * Counts live documents for the context's tenant.
   *
   * @param {Object} ctx - Operation context
   * @return {Promise<number>} Count
   */
  async count(ctx) {
    return (await this.candidates_({ filters: [] }, ctx)).length;
  }

  /**
   * Applies role-based masking and sparse fields.
   *
   * @param {Object} doc - Raw document
   * @param {Object} ctx - Operation context
   * @param {string[]} [fields] - Sparse fieldset
   * @return {Object} Presented copy
   */
  present(doc, ctx, fields) {
    const out = ctx && ctx.can && ctx.can('pii:read') ? clone(doc) : mask(this.schema, clone(doc));
    return QueryEngine.project(out, fields);
  }

  // ---- internals ---------------------------------------------------------

  async load_(id, ctx, includeDeleted) {
    if (!id || typeof id !== 'string') return null;
    let doc = null;
    if (this.cacheDocuments) doc = await this.cache.get(this.docKey_(id));
    if (!doc) {
      doc = await this.dataService.getByUuid(this.container, id);
      if (doc && this.cacheDocuments) await this.cache.put(this.docKey_(id), clone(doc));
    }
    if (!doc) return null;
    doc = clone(doc);
    if (doc.tenantId !== ctx.tenantId) return null;
    if (doc.deletedAt && !includeDeleted) return null;
    return doc;
  }

  async candidates_(q, ctx) {
    const picked = this.indexes.pick(q.filters);
    let docs;
    if (picked) {
      const ids = await this.indexes.lookup(picked.name, picked.values, ctx.tenantId);
      docs = (await Promise.all(ids.map((id) => this.load_(id, ctx, q.includeDeleted)))).filter(Boolean);
    } else {
      docs = (await this.dataService.listAll(this.container))
        .filter((d) => d && d.id && d.tenantId === ctx.tenantId && (q.includeDeleted || !d.deletedAt))
        .map(clone);
    }
    return docs;
  }

  /**
   * Checks filter/sort fields against the schema and coerces query-string
   * values to the field's type.
   */
  normaliseQuery_(query) {
    const q = {
      filters: [], sort: [], limit: 50, offset: 0, ...query
    };
    q.filters = q.filters.map((f) => {
      const spec = this.fieldSpec_(f.field);
      if (!spec) throw badRequest(`Unknown filter field '${f.field}'`);
      if (!QueryEngine.OPERATORS.includes(f.op)) throw badRequest(`Unknown operator '${f.op}'`);
      const value = f.op === 'exists' ? f.value
        : Array.isArray(f.value) ? f.value.map((v) => coerce(spec, v)) : coerce(spec, f.value);
      return { field: f.field, op: f.op, value };
    });
    for (const s of q.sort) {
      if (!this.fieldSpec_(s.field)) throw badRequest(`Unknown sort field '${s.field}'`);
    }
    if (q.fields) {
      for (const f of q.fields) {
        if (!this.fieldSpec_(f)) throw badRequest(`Unknown field '${f}'`);
      }
    }
    return q;
  }

  fieldSpec_(path) {
    let fields = this.schema.fields;
    let spec = null;
    for (const part of path.split('.')) {
      if (!fields) return spec && (spec.type === 'json' || (spec.type === 'object' && !spec.fields)) ? { type: 'json' } : null;
      spec = fields[part];
      if (!spec) return null;
      fields = spec.type === 'object' ? spec.fields : (spec.type === 'array' && spec.items && spec.items.type === 'object' ? spec.items.fields : null);
    }
    return spec;
  }

  checkVersion_(doc, expectedVersion) {
    if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== doc.version) {
      throw versionConflict(Number(expectedVersion), doc.version);
    }
  }

  async afterWrite_(doc) {
    await this.cacheDoc_(doc);
    await this.indexSearch_(doc);
  }

  async cacheDoc_(doc) {
    if (this.cacheDocuments) await this.cache.put(this.docKey_(doc.id), clone(doc));
  }

  docKey_(id) {
    return `${this.container}:doc:${id}`;
  }

  async indexSearch_(doc) {
    if (!this.search || !this.schema.search.length || doc.deletedAt) return;
    const entry = { id: doc.id, tenantId: doc.tenantId };
    for (const path of this.schema.search) {
      const v = getPath(doc, path);
      if (v !== undefined && v !== null) entry[path.replace(/\./g, '_')] = Array.isArray(v) ? v.join(' ') : v;
    }
    try {
      await this.search.remove(doc.id, this.container);
      await this.search.add(doc.id, entry, this.container);
    } catch (err) {
      this.logger?.warn?.(`[BaseRepository] search index failed on ${this.container}`, { error: err.message });
    }
  }

  async unindexSearch_(id) {
    if (!this.search || !this.schema.search.length) return;
    try {
      await this.search.remove(id, this.container);
    } catch (err) {
      this.logger?.warn?.(`[BaseRepository] search remove failed on ${this.container}`, { error: err.message });
    }
  }

  emit_(action, doc, ctx, changes) {
    if (!this.events) return;
    this.events.publish(`${this.schema.name}.${action}`, {
      module: this.module,
      subject: { entity: this.schema.name, id: doc.id },
      data: mask(this.schema, doc),
      changes
    }, ctx);
  }
}

function stripEnvelope(doc, schema) {
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    const spec = schema.fields[key];
    if (spec && !spec.readOnly) out[key] = value;
  }
  return out;
}

function envelopeOf(doc, schema) {
  const out = {};
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (spec.readOnly && doc[key] !== undefined) out[key] = doc[key];
  }
  return out;
}

/** Applies trusted system fields; null removes the field. */
function applySystem(doc, system) {
  for (const [key, value] of Object.entries(system)) {
    if (value === null) delete doc[key];
    else doc[key] = clone(value);
  }
  return doc;
}

function sameContent(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function coerce(spec, value) {
  if (typeof value !== 'string') return value;
  switch (spec.type) {
    case 'number':
    case 'integer': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw badRequest(`'${value}' is not a number`);
      return n;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw badRequest(`'${value}' is not a boolean`);
    default:
      return value;
  }
}

module.exports = BaseRepository;
