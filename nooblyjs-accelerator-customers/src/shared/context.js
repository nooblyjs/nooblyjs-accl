/**
 * @fileoverview Request/operation context.
 *
 * Every service and repository call takes a context describing who is acting,
 * for which tenant, with which permissions, and under which correlation id.
 * HTTP routes build one from the request; jobs and in-process callers use
 * `systemContext()`.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { randomUUID } = require('crypto');

const DEFAULT_TENANT = 'default';

/**
 * Creates an immutable operation context.
 *
 * @param {Object} [init]
 * @param {string} [init.tenantId='default'] - Tenant the operation runs in
 * @param {{type: string, id: string}} [init.actor] - Who is acting
 * @param {string[]} [init.roles] - Resolved role names
 * @param {Set<string>|string[]} [init.permissions] - Resolved permissions ('*' grants all)
 * @param {string} [init.correlationId] - Correlation id (generated when absent)
 * @return {Readonly<Object>} Context with a `can(permission)` helper
 */
function createContext(init = {}) {
  const permissions = new Set(init.permissions || []);
  const ctx = {
    tenantId: init.tenantId || DEFAULT_TENANT,
    actor: init.actor || { type: 'anonymous', id: 'anonymous' },
    roles: Object.freeze([...(init.roles || [])]),
    permissions,
    correlationId: init.correlationId || randomUUID(),
    can(permission) {
      return hasPermission(permissions, permission);
    }
  };
  return Object.freeze(ctx);
}

/**
 * Context for jobs, seeders and in-process API calls. Holds every permission.
 *
 * @param {string} [job='internal'] - Name recorded as the actor id (`system:<job>`)
 * @param {Object} [overrides] - Extra context fields (tenantId, correlationId)
 * @return {Readonly<Object>} System context
 */
function systemContext(job = 'internal', overrides = {}) {
  return createContext({
    actor: { type: 'system', id: `system:${job}` },
    roles: ['system'],
    permissions: ['*'],
    ...overrides
  });
}

/**
 * Returns the string recorded in `createdBy` / `updatedBy` for a context.
 *
 * @param {Object} ctx - Operation context
 * @return {string} Actor id
 */
function actorId(ctx) {
  return (ctx && ctx.actor && ctx.actor.id) || 'anonymous';
}

/**
 * Checks a permission against a set that may contain wildcards
 * (`*`, `customer:*`).
 *
 * @param {Set<string>} permissions - Granted permissions
 * @param {string} permission - Required permission, e.g. `customer:read`
 * @return {boolean} Whether it is granted
 */
function hasPermission(permissions, permission) {
  if (permissions.has('*') || permissions.has(permission)) return true;
  const [resource] = permission.split(':');
  return permissions.has(`${resource}:*`);
}

module.exports = { DEFAULT_TENANT, createContext, systemContext, actorId, hasPermission };
