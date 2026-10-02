/**
 * @fileoverview HTTP helpers shared by every module's routes: list-query
 * parsing, ETag / If-Match, async handlers and error mapping.
 *
 * Error responses use `{ error: { code, message, details[] } }`. Client-safe
 * errors are core `ClientError`s; anything else is a 500 with a generic
 * message, the detail going to the logger and core's `error-response` event.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { isClientError, GENERIC_SERVER_MESSAGE } = require('nooblyjs-core/src/shared/utils/httpErrors');
const { parseLimit, parseOffset } = require('nooblyjs-core/src/shared/utils/validation');
const { badRequest } = require('../errors');
const { OPERATORS } = require('../repository/queryEngine');

const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Parses list query-string parameters into a repository query.
 *
 * Supports `filter[field]=v`, `filter[field][op]=v` (ops: eq, ne, in, nin, gt,
 * gte, lt, lte, contains, prefix, exists; `in`/`nin` take comma lists),
 * `sort=-createdAt,name`, `limit`, `offset` (or `cursor`), `fields=a,b`,
 * `expand=a,b`, `q=text` and `includeDeleted=true`.
 *
 * @param {Object} query - `req.query` (Express extended parser)
 * @param {Object} [opts]
 * @param {number} [opts.defaultLimit=50] - Page size when none is given
 * @param {number} [opts.maxLimit=200] - Largest page size
 * @return {Object} `{ filters, sort, limit, offset, fields, expand, q, includeDeleted }`
 * @throws {ClientError} 400 on malformed parameters
 */
function parseListQuery(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const filters = [];
  const rawFilter = query.filter;
  if (rawFilter !== undefined) {
    if (!rawFilter || typeof rawFilter !== 'object' || Array.isArray(rawFilter)) {
      throw badRequest('filter must use filter[field]=value');
    }
    for (const [field, spec] of Object.entries(rawFilter)) {
      checkField(field);
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        for (const [op, value] of Object.entries(spec)) {
          if (!OPERATORS.includes(op)) throw badRequest(`Unknown operator '${op}'`);
          filters.push({ field, op, value: op === 'in' || op === 'nin' ? splitList(value) : scalar(value, field) });
        }
      } else if (Array.isArray(spec)) {
        filters.push({ field, op: 'in', value: spec.map((v) => scalar(v, field)) });
      } else {
        filters.push({ field, op: 'eq', value: scalar(spec, field) });
      }
    }
  }

  const sort = splitList(query.sort).map((s) => {
    const dir = s.startsWith('-') ? -1 : 1;
    const field = s.replace(/^[-+]/, '');
    checkField(field);
    return { field, dir };
  });

  const fields = query.fields !== undefined ? splitList(query.fields) : undefined;
  if (fields) fields.forEach(checkField);
  const expand = splitList(query.expand);
  expand.forEach(checkField);

  const q = query.q === undefined ? undefined : scalar(query.q, 'q');
  if (q !== undefined && q.length > 200) throw badRequest('q must have at most 200 characters');

  return {
    filters,
    sort,
    limit: parseLimit(query.limit, { defaultValue: defaultLimit, max: maxLimit }),
    offset: parseOffset(query.offset !== undefined ? query.offset : query.cursor),
    fields,
    expand,
    q,
    includeDeleted: query.includeDeleted === 'true'
  };
}

function splitList(value) {
  if (value === undefined || value === null || value === '') return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((s) => String(s).trim()).filter(Boolean);
}

function scalar(value, field) {
  if (typeof value !== 'string') throw badRequest(`Invalid value for '${field}'`);
  return value;
}

function checkField(field) {
  if (!FIELD_RE.test(field)) throw badRequest(`Invalid field name '${field}'`);
}

/**
 * @param {{version: number}} doc - Document
 * @return {string} Weak ETag for the document version
 */
function etagFor(doc) {
  return `W/"${doc.version}"`;
}

/**
 * Reads `If-Match` as an expected version.
 *
 * @param {Object} req - Express request
 * @return {number|undefined} Expected version, or undefined when absent
 * @throws {ClientError} 400 on a malformed header
 */
function expectedVersion(req) {
  const header = req.headers['if-match'];
  if (header === undefined || header === '*') return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(String(header).trim());
  if (!m) throw badRequest('If-Match must be a version ETag, e.g. W/"3"');
  return Number(m[1]);
}

/**
 * Sends a document with its ETag.
 *
 * @param {Object} res - Express response
 * @param {Object} doc - Presented document
 * @param {number} [status=200] - HTTP status
 * @return {Object} Response
 */
function sendDoc(res, doc, status = 200) {
  if (doc && Number.isInteger(doc.version)) res.setHeader('ETag', etagFor(doc));
  return res.status(status).json(doc);
}

/**
 * Wraps an async route handler so rejections reach the error middleware.
 *
 * @param {function(Object, Object, Function): Promise<*>} fn - Handler
 * @return {function(Object, Object, Function): void} Express handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve().then(() => fn(req, res, next)).catch(next);
  };
}

/**
 * Maps any error to a JSON response.
 *
 * @param {*} err - Thrown value
 * @return {{status: number, body: Object}} Status and body
 */
function toErrorResponse(err) {
  // body-parser / express.json failures carry a 4xx status and a `type`; their
  // messages quote parser internals, so replace them.
  if (err && typeof err.type === 'string' && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    const message = err.type === 'entity.parse.failed' ? 'Malformed JSON body'
      : err.type === 'entity.too.large' ? 'Request body too large' : 'Bad request';
    return { status: err.status, body: { error: { code: codeFor(err.status), message, details: [] } } };
  }
  if (isClientError(err)) {
    return {
      status: err.statusCode,
      body: { error: { code: err.code || codeFor(err.statusCode), message: err.message, details: err.details || [] } }
    };
  }
  return { status: 500, body: { error: { code: 'internal_error', message: GENERIC_SERVER_MESSAGE, details: [] } } };
}

function codeFor(status) {
  return {
    400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed',
    409: 'conflict', 412: 'version_conflict', 413: 'payload_too_large', 422: 'validation_failed', 429: 'rate_limited'
  }[status] || 'error';
}

/**
 * Express error middleware for module routers.
 *
 * @param {Object} [deps]
 * @param {Object} [deps.logger] - Core logger
 * @param {EventEmitter} [deps.eventEmitter] - Emits core's `error-response` for 5xx
 * @return {function(*, Object, Object, Function): void} Error middleware
 */
function errorMiddleware({ logger = null, eventEmitter = null } = {}) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const { status, body } = toErrorResponse(err);
    if (status >= 500) {
      const detail = { method: req.method, path: req.originalUrl, error: err && err.message, stack: err && err.stack };
      logger?.error?.('[accel-customers] request failed', detail);
      eventEmitter?.emit?.('error-response', { status, ...detail });
    }
    if (res.headersSent) return undefined;
    return res.status(status).json(body);
  };
}

/**
 * 404 handler for unmatched API paths.
 *
 * @return {function(Object, Object): void} Middleware
 */
function notFoundHandler() {
  return (req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route not found', details: [] } });
}

module.exports = {
  parseListQuery, etagFor, expectedVersion, sendDoc, asyncHandler, toErrorResponse, errorMiddleware, notFoundHandler,
  DEFAULT_LIMIT, MAX_LIMIT
};
