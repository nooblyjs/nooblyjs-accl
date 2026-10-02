/**
 * @fileoverview Domain errors, built on core's client-safe `ClientError`.
 *
 * Services throw these; the HTTP layer maps them to
 * `{ error: { code, message, details[] } }`.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { ClientError } = require('nooblyjs-core/src/shared/utils/httpErrors');

/**
 * @param {string} message - Client-safe message
 * @param {Array<{path: string, message: string}>} [details] - Field violations
 * @return {ClientError} 422 validation error
 */
function validationError(message, details = []) {
  return new ClientError(422, message, { code: 'validation_failed', details });
}

/**
 * @param {string} entity - Entity name
 * @param {string} id - Requested id
 * @return {ClientError} 404 error
 */
function notFound(entity, id) {
  return new ClientError(404, `${entity} ${id} not found`, { code: 'not_found' });
}

/**
 * @param {string} message - Client-safe message
 * @param {Object} [extra] - Extra fields (e.g. { field })
 * @return {ClientError} 409 conflict
 */
function conflict(message, extra = {}) {
  return new ClientError(409, message, { code: 'conflict', ...extra });
}

/**
 * @param {number} expected - Version the caller sent
 * @param {number} actual - Stored version
 * @return {ClientError} 412 precondition failed
 */
function versionConflict(expected, actual) {
  return new ClientError(412, `Version mismatch: expected ${expected}, current ${actual}`, {
    code: 'version_conflict', currentVersion: actual
  });
}

/**
 * @param {string} message - Client-safe message
 * @return {ClientError} 400 bad request
 */
function badRequest(message, details = []) {
  return new ClientError(400, message, { code: 'bad_request', details });
}

module.exports = { ClientError, validationError, notFound, conflict, versionConflict, badRequest };
