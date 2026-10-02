/**
 * @fileoverview Declarative schemas.
 *
 * A schema describes one entity: its fields (type, required, enum, PII flag,
 * defaults), its secondary/unique indexes and its searchable fields. Validation,
 * defaults, PII masking, indexing and OpenAPI generation are all driven from it.
 *
 * Field types: string, number, integer, boolean, date (YYYY-MM-DD),
 * datetime (ISO-8601), enum, ref (id string), object, array, json.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { validationError } = require('../errors');

const FIELD_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'date', 'datetime', 'enum', 'ref', 'object', 'array', 'json'
]);

/** Fields every object carries (Architecture §5.1). */
const ENVELOPE_FIELDS = Object.freeze({
  id: { type: 'string', readOnly: true, description: 'Unique id' },
  tenantId: { type: 'string', readOnly: true },
  createdAt: { type: 'datetime', readOnly: true },
  updatedAt: { type: 'datetime', readOnly: true },
  createdBy: { type: 'string', readOnly: true },
  updatedBy: { type: 'string', readOnly: true },
  version: { type: 'integer', readOnly: true },
  deletedAt: { type: 'datetime', readOnly: true, nullable: true },
  tags: { type: 'array', items: { type: 'string', maxLength: 64 }, default: () => [] },
  customFields: { type: 'json', default: () => ({}) }
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MASK = '***';

/**
 * Defines an entity schema.
 *
 * @param {Object} def
 * @param {string} def.name - Entity name, e.g. `customer`
 * @param {string} [def.plural] - Plural used for REST paths and containers (default `${name}s`)
 * @param {Object<string, Object>} def.fields - Field specs (envelope fields are added)
 * @param {Array<{name: string, fields: string[], unique?: boolean}>} [def.indexes]
 * @param {string[]} [def.search] - Field paths indexed for text search
 * @param {string} [def.numberPrefix] - Prefix for human-readable numbers (`CUS`)
 * @param {boolean} [def.appendOnly] - Ledger entity: no update or delete
 * @param {string} [def.parentField] - Field holding the owning record's id (audit entries are filed under it too)
 * @return {Readonly<Object>} Schema
 * @throws {Error} On an invalid definition
 *
 * @example
 * const note = defineSchema({
 *   name: 'note',
 *   fields: { body: { type: 'string', required: true, maxLength: 10000, pii: true } },
 *   indexes: [{ name: 'subject', fields: ['subjectId'] }]
 * });
 */
function defineSchema(def) {
  if (!def || typeof def.name !== 'string' || !def.name) {
    throw new Error('defineSchema: name is required');
  }
  if (!def.fields || typeof def.fields !== 'object') {
    throw new Error(`defineSchema(${def.name}): fields are required`);
  }
  for (const key of Object.keys(def.fields)) {
    if (ENVELOPE_FIELDS[key]) throw new Error(`defineSchema(${def.name}): '${key}' is an envelope field`);
  }
  const fields = { ...ENVELOPE_FIELDS, ...def.fields };
  if (def.numberPrefix && !fields.number) {
    fields.number = { type: 'string', readOnly: true, description: `Human-readable number (${def.numberPrefix}-000001)` };
  }
  checkFieldSpecs(def.name, fields);

  const indexes = (def.indexes || []).map((ix) => {
    if (!ix.name || !Array.isArray(ix.fields) || ix.fields.length === 0) {
      throw new Error(`defineSchema(${def.name}): index needs a name and fields`);
    }
    return Object.freeze({ name: ix.name, fields: [...ix.fields], unique: Boolean(ix.unique) });
  });

  return Object.freeze({
    name: def.name,
    plural: def.plural || `${def.name}s`,
    description: def.description || '',
    fields,
    indexes,
    search: [...(def.search || [])],
    numberPrefix: def.numberPrefix || null,
    appendOnly: Boolean(def.appendOnly),
    parentField: def.parentField || null
  });
}

function checkFieldSpecs(entity, fields, prefix = '') {
  for (const [key, spec] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!spec || !FIELD_TYPES.has(spec.type)) {
      throw new Error(`defineSchema(${entity}): field '${path}' has an unknown type '${spec && spec.type}'`);
    }
    if (spec.type === 'enum' && (!Array.isArray(spec.values) || spec.values.length === 0)) {
      throw new Error(`defineSchema(${entity}): enum field '${path}' needs values`);
    }
    if (spec.type === 'object' && spec.fields) checkFieldSpecs(entity, spec.fields, path);
    if (spec.type === 'array' && spec.items) checkFieldSpecs(entity, { '[]': spec.items }, path);
  }
}

/**
 * Validates and normalises input against a schema. Read-only fields are
 * dropped silently (clients often echo them back); unknown fields are errors.
 *
 * @param {Object} schema - Schema from defineSchema()
 * @param {Object} input - Candidate document or patch
 * @param {Object} [opts]
 * @param {boolean} [opts.partial=false] - Patch mode: no required checks, no defaults
 * @return {Object} Normalised copy of the input
 * @throws {ClientError} 422 with `details[]` listing every violation
 */
function validate(schema, input, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    throw validationError(`${schema.name} must be a JSON object`, [{ path: '', message: 'must be an object' }]);
  }
  const value = validateObject(schema.fields, input, '', errors, partial, true);
  if (errors.length) {
    throw validationError(`Invalid ${schema.name}: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`, errors);
  }
  return value;
}

function validateObject(fields, input, prefix, errors, partial, topLevel) {
  const out = {};
  for (const key of Object.keys(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const spec = fields[key];
    if (!spec) {
      errors.push({ path, message: 'is not a known field' });
      continue;
    }
    if (spec.readOnly && topLevel) continue;
    const raw = input[key];
    if (raw === null) {
      // null clears an optional field (merge-patch semantics)
      if (spec.required && !partial) errors.push({ path, message: 'is required' });
      else out[key] = null;
      continue;
    }
    if (raw === undefined) continue;
    const v = validateValue(spec, raw, path, errors, partial);
    if (v !== undefined) out[key] = v;
  }
  if (!partial) {
    for (const [key, spec] of Object.entries(fields)) {
      if (spec.readOnly && topLevel) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (out[key] === undefined || out[key] === null) {
        if (spec.default !== undefined && out[key] === undefined) {
          out[key] = typeof spec.default === 'function' ? spec.default() : clone(spec.default);
        } else if (spec.required) {
          errors.push({ path, message: 'is required' });
        }
      }
    }
  }
  return out;
}

function validateValue(spec, raw, path, errors, partial) {
  const fail = (message) => { errors.push({ path, message }); return undefined; };
  switch (spec.type) {
    case 'string':
    case 'ref': {
      if (typeof raw !== 'string') return fail('must be a string');
      const trimmed = spec.trim === false ? raw : raw.trim();
      const v = spec.lowercase ? trimmed.toLowerCase() : (spec.uppercase ? trimmed.toUpperCase() : trimmed);
      if (spec.required && v === '' && !partial) return fail('is required');
      if (spec.minLength !== undefined && v.length < spec.minLength) return fail(`must have at least ${spec.minLength} characters`);
      if (v.length > (spec.maxLength || 2000)) return fail(`must have at most ${spec.maxLength || 2000} characters`);
      if (spec.pattern && !spec.pattern.test(v)) return fail('has an invalid format');
      return v;
    }
    case 'number':
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail(`must be a ${spec.type}`);
      if (spec.type === 'integer' && !Number.isInteger(raw)) return fail('must be an integer');
      if (spec.min !== undefined && raw < spec.min) return fail(`must be >= ${spec.min}`);
      if (spec.max !== undefined && raw > spec.max) return fail(`must be <= ${spec.max}`);
      return raw;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : fail('must be a boolean');
    case 'date': {
      if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
        || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
        return fail('must be a date (YYYY-MM-DD)');
      }
      return raw;
    }
    case 'datetime': {
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) return fail('must be an ISO-8601 date-time');
      return new Date(raw).toISOString();
    }
    case 'enum':
      return spec.values.includes(raw) ? raw : fail(`must be one of: ${spec.values.join(', ')}`);
    case 'object': {
      if (!isPlainObject(raw)) return fail('must be an object');
      if (!spec.fields) return clone(raw);
      return validateObject(spec.fields, raw, path, errors, partial, false);
    }
    case 'array': {
      if (!Array.isArray(raw)) return fail('must be an array');
      if (spec.maxItems !== undefined && raw.length > spec.maxItems) return fail(`must have at most ${spec.maxItems} items`);
      if (!spec.items) return clone(raw);
      // array items are always validated in full: a patch replaces the whole array
      return raw.map((item, i) => validateValue(spec.items, item, `${path}[${i}]`, errors, false));
    }
    case 'json':
    default:
      return clone(raw);
  }
}

/**
 * Returns a copy with PII fields masked. Strings keep a hint of their shape
 * (`j***@example.com`, `+27***89`); other values become `***`.
 *
 * @param {Object} schema - Schema from defineSchema()
 * @param {Object} doc - Stored document
 * @return {Object} Masked copy
 */
function mask(schema, doc) {
  if (!doc) return doc;
  return maskObject(schema.fields, doc);
}

function maskObject(fields, doc) {
  const out = { ...doc };
  for (const [key, spec] of Object.entries(fields)) {
    if (out[key] === undefined || out[key] === null) continue;
    if (spec.pii) out[key] = maskValue(out[key]);
    else if (spec.type === 'object' && spec.fields && isPlainObject(out[key])) out[key] = maskObject(spec.fields, out[key]);
    else if (spec.type === 'array' && spec.items && spec.items.type === 'object' && spec.items.fields && Array.isArray(out[key])) {
      out[key] = out[key].map((item) => (isPlainObject(item) ? maskObject(spec.items.fields, item) : item));
    }
  }
  return out;
}

/**
 * Masks any value: strings by shape, objects/arrays recursively.
 *
 * @param {*} value - Value to mask
 * @return {*} Masked value
 */
function maskValue(value) {
  if (typeof value === 'string') return maskString(value);
  if (Array.isArray(value)) return value.map(maskValue);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskValue(v);
    return out;
  }
  return MASK;
}

function maskString(s) {
  if (!s) return s;
  const at = s.indexOf('@');
  if (at > 0) return `${s[0]}${MASK}${s.slice(at)}`;
  // Dates (e.g. date of birth) reveal nothing.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return MASK;
  if (/^\+?[\d\s()-]{6,}$/.test(s)) {
    const digits = s.replace(/\D/g, '');
    return `${s.startsWith('+') ? '+' : ''}${digits.slice(0, 2)}${MASK}${digits.slice(-2)}`;
  }
  return s.length <= 1 ? MASK : `${s[0]}${MASK}`;
}

/**
 * Lists the dotted paths of PII fields (used by audit redaction).
 *
 * @param {Object} schema - Schema from defineSchema()
 * @return {Set<string>} PII paths, e.g. `name`, `contact.email`
 */
function piiPaths(schema) {
  const paths = new Set();
  const walk = (fields, prefix) => {
    for (const [key, spec] of Object.entries(fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (spec.pii) paths.add(path);
      else if (spec.type === 'object' && spec.fields) walk(spec.fields, path);
    }
  };
  walk(schema.fields, '');
  return paths;
}

/**
 * Converts a schema to an OpenAPI 3 schema object.
 *
 * @param {Object} schema - Schema from defineSchema()
 * @param {Object} [opts]
 * @param {boolean} [opts.input=false] - Omit read-only fields (request bodies)
 * @return {Object} OpenAPI schema
 */
function toOpenApi(schema, { input = false } = {}) {
  return objectToOpenApi(schema.fields, input, true, schema.description);
}

function objectToOpenApi(fields, input, topLevel, description) {
  const properties = {};
  const required = [];
  for (const [key, spec] of Object.entries(fields)) {
    if (input && spec.readOnly && topLevel) continue;
    properties[key] = fieldToOpenApi(spec, input);
    if (spec.required) required.push(key);
  }
  const out = { type: 'object', properties };
  if (description) out.description = description;
  if (required.length) out.required = required;
  return out;
}

function fieldToOpenApi(spec, input) {
  let out;
  switch (spec.type) {
    case 'string':
    case 'ref':
      out = { type: 'string' };
      if (spec.maxLength) out.maxLength = spec.maxLength;
      if (spec.pattern) out.pattern = spec.pattern.source;
      break;
    case 'number': out = { type: 'number' }; break;
    case 'integer': out = { type: 'integer' }; break;
    case 'boolean': out = { type: 'boolean' }; break;
    case 'date': out = { type: 'string', format: 'date' }; break;
    case 'datetime': out = { type: 'string', format: 'date-time' }; break;
    case 'enum': out = { type: 'string', enum: [...spec.values] }; break;
    case 'object':
      out = spec.fields ? objectToOpenApi(spec.fields, input, false) : { type: 'object', additionalProperties: true };
      break;
    case 'array':
      out = { type: 'array', items: spec.items ? fieldToOpenApi(spec.items, input) : {} };
      break;
    default:
      out = {};
  }
  if (spec.description) out.description = spec.description;
  if (spec.readOnly) out.readOnly = true;
  if (spec.nullable) out.nullable = true;
  if (spec.pii) out['x-pii'] = true;
  return out;
}

/**
 * Reads a dotted path (`name.given`) from an object.
 *
 * @param {Object} obj - Source object
 * @param {string} path - Dotted path
 * @return {*} Value, or undefined
 */
function getPath(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Applies an RFC 7396 JSON merge patch (null removes a key) and returns a new object.
 *
 * @param {Object} target - Current document
 * @param {Object} patch - Patch
 * @return {Object} Patched copy
 */
function mergePatch(target, patch) {
  if (!isPlainObject(patch)) return clone(patch);
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isPlainObject(value)) out[key] = mergePatch(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  return v === undefined ? v : structuredClone(v);
}

module.exports = {
  ENVELOPE_FIELDS, defineSchema, validate, mask, maskValue, piiPaths, toOpenApi, getPath, mergePatch, clone
};
