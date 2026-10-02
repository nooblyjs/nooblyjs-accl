/**
 * @fileoverview Append-only audit log.
 *
 * Every repository write records who did what, when, and a JSON-patch-style
 * diff. Values of PII fields are replaced with `[REDACTED]`, so the audit log
 * itself never holds personal data. Entries live in `{prefix}_audit` and are
 * never updated or deleted by the accelerator.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { piiPaths, clone } = require('../schema');
const QueryEngine = require('../repository/queryEngine');

const REDACTED = '[REDACTED]';
/** Bookkeeping fields left out of diffs. */
const IGNORED = new Set(['updatedAt', 'updatedBy', 'version', 'createdAt', 'createdBy', 'tenantId', 'id']);
const ACTIONS = Object.freeze(['create', 'update', 'delete', 'merge', 'export', 'erase', 'view_pii']);

class AuditService {
  /**
   * @param {Object} deps
   * @param {Object} deps.dataService - Core dataService
   * @param {string} [deps.containerPrefix='cx'] - Container namespace
   * @param {Object} [deps.logger] - Core logger
   */
  constructor({ dataService, containerPrefix = 'cx', logger = null }) {
    this.dataService = dataService;
    this.logger = logger;
    this.container = `${containerPrefix}_audit`;
  }

  /**
   * Records an audit entry.
   *
   * @param {Object} entry
   * @param {Object} entry.schema - Entity schema (for PII redaction)
   * @param {string} entry.entityId - Subject id
   * @param {string} entry.action - One of ACTIONS
   * @param {?Object} entry.before - Previous version (null on create)
   * @param {?Object} entry.after - New version (null on erase)
   * @param {Object} entry.ctx - Operation context
   * @param {Object} [entry.meta] - Extra non-PII details (e.g. export format)
   * @return {Promise<Object>} Stored entry
   */
  async record({ schema, entityId, action, before, after, ctx, meta }) {
    const parentId = schema.parentField ? ((after && after[schema.parentField]) || (before && before[schema.parentField]) || null) : null;
    if (!ACTIONS.includes(action)) throw new Error(`AuditService: unknown action '${action}'`);
    const doc = {
      tenantId: ctx.tenantId,
      entity: schema.name,
      entityId,
      parentId,
      action,
      actor: clone(ctx.actor),
      at: new Date().toISOString(),
      changes: diff(before, after, piiPaths(schema)),
      correlationId: ctx.correlationId || null
    };
    if (meta) doc.meta = clone(meta);
    const id = await this.dataService.add(this.container, doc);
    const stored = { ...doc, id };
    await this.dataService.update(this.container, id, stored);
    return stored;
  }

  /**
   * Lists audit entries, newest first.
   *
   * @param {Object} [filter]
   * @param {string} [filter.entity] - Entity name
   * @param {string} [filter.entityId] - Subject id
   * @param {string[]} [filter.entityIds] - Any of these subject ids
   * @param {string} [filter.relatedTo] - Entries about this record or its children (`parentId`)
   * @param {string} [filter.action] - Action
   * @param {number} [filter.limit=50] - Page size
   * @param {number} [filter.offset=0] - Offset
   * @param {Object} ctx - Operation context (tenant)
   * @return {Promise<{items: Object[], total: number, limit: number, offset: number, nextCursor: ?string}>} Page
   */
  async list({ entity, entityId, entityIds, relatedTo, action, limit = 50, offset = 0 } = {}, ctx) {
    const filters = [];
    if (entity) filters.push({ field: 'entity', op: 'eq', value: entity });
    if (entityId) filters.push({ field: 'entityId', op: 'eq', value: entityId });
    if (entityIds) filters.push({ field: 'entityId', op: 'in', value: entityIds });
    if (action) filters.push({ field: 'action', op: 'eq', value: action });
    const docs = (await this.dataService.listAll(this.container))
      .filter((d) => d.tenantId === ctx.tenantId && (!relatedTo || d.entityId === relatedTo || d.parentId === relatedTo));
    return QueryEngine.execute(docs, { filters, sort: [{ field: 'at', dir: -1 }], limit, offset });
  }
}

/**
 * Computes a flat JSON-patch-style diff between two documents.
 *
 * @param {?Object} before - Previous version
 * @param {?Object} after - New version
 * @param {Set<string>} [pii] - Dotted paths whose values are redacted
 * @return {Array<{op: string, path: string, from?: *, value?: *}>} Changes
 */
function diff(before, after, pii = new Set()) {
  const a = flatten(before || {});
  const b = flatten(after || {});
  const changes = [];
  const redact = (path, value) => (isPii(path, pii) && value !== undefined && value !== null ? REDACTED : value);
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (IGNORED.has(path.split('.')[0])) continue;
    const inA = Object.prototype.hasOwnProperty.call(a, path);
    const inB = Object.prototype.hasOwnProperty.call(b, path);
    if (inA && !inB) changes.push({ op: 'remove', path: `/${path.replace(/\./g, '/')}`, from: redact(path, a[path]) });
    else if (!inA && inB) changes.push({ op: 'add', path: `/${path.replace(/\./g, '/')}`, value: redact(path, b[path]) });
    else if (JSON.stringify(a[path]) !== JSON.stringify(b[path])) {
      changes.push({ op: 'replace', path: `/${path.replace(/\./g, '/')}`, from: redact(path, a[path]), value: redact(path, b[path]) });
    }
  }
  return changes;
}

function isPii(path, pii) {
  const parts = path.split('.');
  for (let i = 1; i <= parts.length; i++) {
    if (pii.has(parts.slice(0, i).join('.'))) return true;
  }
  return false;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

module.exports = { AuditService, diff, REDACTED, ACTIONS };
