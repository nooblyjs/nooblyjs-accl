/**
 * @fileoverview List-query evaluation (filter / sort / paginate).
 *
 * v1 evaluates queries in memory over documents loaded from core
 * `dataService` (narrowed by an index when possible). A provider-specific
 * `QueryAdapter` can push queries down later (Architecture §6.2).
 *
 * Query shape (built by `src/shared/http/listQuery.js`):
 *   { filters: [{ field, op, value }], sort: [{ field, dir: 1|-1 }],
 *     limit, offset, fields?: string[], includeDeleted?: boolean }
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { getPath } = require('../schema');

const OPERATORS = Object.freeze(['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'prefix', 'exists']);

/**
 * Tests one document against one filter.
 *
 * @param {Object} doc - Document
 * @param {{field: string, op: string, value: *}} filter - Filter
 * @return {boolean} Whether it matches
 */
function matchFilter(doc, { field, op, value }) {
  const actual = getPath(doc, field);
  switch (op) {
    case 'eq': return equals(actual, value);
    case 'ne': return !equals(actual, value);
    case 'in': return [].concat(value).some((v) => equals(actual, v));
    case 'nin': return ![].concat(value).some((v) => equals(actual, v));
    case 'gt': return compare(actual, value) > 0 && actual != null;
    case 'gte': return compare(actual, value) >= 0 && actual != null;
    case 'lt': return compare(actual, value) < 0 && actual != null;
    case 'lte': return compare(actual, value) <= 0 && actual != null;
    case 'contains':
      if (Array.isArray(actual)) return actual.some((v) => equals(v, value));
      return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
    case 'prefix':
      return typeof actual === 'string' && actual.toLowerCase().startsWith(String(value).toLowerCase());
    case 'exists': {
      const want = value === true || value === 'true';
      return (actual !== undefined && actual !== null) === want;
    }
    default:
      throw new Error(`Unknown operator '${op}'`);
  }
}

function equals(a, b) {
  if (Array.isArray(a)) return a.some((v) => equals(v, b));
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * Orders two values; null/undefined sort last.
 *
 * @param {*} a - Left
 * @param {*} b - Right
 * @return {number} Negative, zero or positive
 */
function compare(a, b) {
  const aNil = a === undefined || a === null;
  const bNil = b === undefined || b === null;
  if (aNil || bNil) return aNil === bNil ? 0 : (aNil ? 1 : -1);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/**
 * Applies filters, sort and pagination.
 *
 * @param {Object[]} docs - Candidate documents
 * @param {Object} query - Parsed query
 * @return {{items: Object[], total: number, limit: number, offset: number, nextCursor: ?string}} Page
 */
function execute(docs, query = {}) {
  const { filters = [], sort = [], limit = 50, offset = 0 } = query;
  let items = filters.length ? docs.filter((d) => filters.every((f) => matchFilter(d, f))) : [...docs];
  if (sort.length) {
    items.sort((a, b) => {
      for (const { field, dir } of sort) {
        const av = getPath(a, field);
        const bv = getPath(b, field);
        // nulls last regardless of direction
        if ((av == null) !== (bv == null)) return av == null ? 1 : -1;
        const c = compare(av, bv);
        if (c !== 0) return c * dir;
      }
      return 0;
    });
  }
  const total = items.length;
  items = items.slice(offset, offset + limit);
  const next = offset + limit;
  return { items, total, limit, offset, nextCursor: next < total ? String(next) : null };
}

/**
 * Keeps only the requested fields (plus `id` and `version`, for ETags) on a document.
 *
 * @param {Object} doc - Document
 * @param {?string[]} fields - Top-level or dotted fields; falsy keeps all
 * @return {Object} Sparse copy
 */
function project(doc, fields) {
  if (!fields || fields.length === 0) return doc;
  const out = { id: doc.id };
  if (doc.version !== undefined) out.version = doc.version;
  for (const path of fields) {
    const value = getPath(doc, path);
    if (value === undefined) continue;
    const parts = path.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] && typeof cur[parts[i]] === 'object' ? cur[parts[i]] : {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

module.exports = { OPERATORS, matchFilter, compare, execute, project };
