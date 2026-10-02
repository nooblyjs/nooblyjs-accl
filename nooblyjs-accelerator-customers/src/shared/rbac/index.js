/**
 * @fileoverview Roles, permissions and request context resolution (PRD PL-10).
 *
 * Authentication belongs to the host (core session / API keys). This module
 * maps the resulting roles to permissions, builds a request context and
 * guards routes with `requirePermission()`.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { createContext, DEFAULT_TENANT } = require('../context');
const { ClientError } = require('../errors');

const PERMISSIONS = Object.freeze([
  'customer:read', 'customer:write', 'customer:delete', 'customer:merge', 'customer:import', 'customer:export',
  'consent:write',
  'pii:read', 'pii:export',
  'audit:read',
  'marketing:read', 'marketing:write', 'marketing:send', 'marketing:admin',
  'support:read', 'support:write', 'support:supervise', 'support:admin'
]);

/** Default role → permission map (Architecture §10). Hosts can override per role. */
const DEFAULT_ROLES = Object.freeze({
  admin: ['*'],
  'data-steward': ['customer:*', 'consent:write', 'pii:read', 'pii:export', 'audit:read', 'marketing:read', 'support:read'],
  marketer: ['customer:read', 'consent:write', 'marketing:read', 'marketing:write', 'marketing:send'],
  agent: ['customer:read', 'customer:write', 'consent:write', 'support:read', 'support:write'],
  supervisor: ['customer:read', 'customer:write', 'consent:write', 'pii:read', 'audit:read',
    'support:read', 'support:write', 'support:supervise'],
  readonly: ['customer:read', 'marketing:read', 'support:read'],
  service: ['customer:read', 'customer:write', 'consent:write', 'pii:read',
    'marketing:read', 'marketing:send', 'support:read', 'support:write']
});

const CORRELATION_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Default role resolver: core session user roles, else `service` for a
 * request authenticated by a core API key.
 *
 * @param {Object} req - Express request
 * @return {string[]} Role names
 */
function defaultRoleResolver(req) {
  const user = req.user;
  if (user) {
    if (Array.isArray(user.roles) && user.roles.length) return user.roles;
    if (typeof user.role === 'string' && user.role) return [user.role];
  }
  if (Array.isArray(req.userRoles) && req.userRoles.length) return req.userRoles;
  if (req.apiKey) return ['service'];
  return [];
}

/**
 * Creates the RBAC helpers for one mount.
 *
 * @param {Object} [options]
 * @param {Object<string, string[]>} [options.roles] - Role overrides/additions merged over DEFAULT_ROLES
 * @param {function(Object): string[]} [options.roleResolver] - Request → roles
 * @param {{enabled?: boolean, resolve?: function(Object): string}} [options.tenancy] - Tenant resolution
 * @return {Object} `{ roles, permissionsFor, contextFromRequest, attachContext, requirePermission }`
 */
function createRbac({ roles = {}, roleResolver = defaultRoleResolver, tenancy = {} } = {}) {
  const roleMap = { ...DEFAULT_ROLES, ...roles };

  const permissionsFor = (roleNames) => {
    const set = new Set();
    for (const role of roleNames) for (const p of roleMap[role] || []) set.add(p);
    return set;
  };

  const actorFor = (req) => {
    const user = req.user;
    if (user) return { type: 'user', id: String(user.id || user._id || user.email || user.username || 'user') };
    if (req.apiKey) return { type: 'api_key', id: `apikey:${String(req.apiKey).slice(0, 8)}` };
    return { type: 'anonymous', id: 'anonymous' };
  };

  const contextFromRequest = (req) => {
    let roleNames = roleResolver(req) || [];
    if (!Array.isArray(roleNames)) roleNames = [roleNames];
    let tenantId = DEFAULT_TENANT;
    if (tenancy.enabled) {
      tenantId = tenancy.resolve ? tenancy.resolve(req) : req.headers['x-tenant-id'];
      if (!tenantId || typeof tenantId !== 'string' || !CORRELATION_RE.test(tenantId)) {
        throw new ClientError(400, 'A valid tenant is required', { code: 'tenant_required' });
      }
    }
    const header = req.headers['x-correlation-id'];
    return createContext({
      tenantId,
      actor: actorFor(req),
      roles: roleNames,
      permissions: permissionsFor(roleNames),
      correlationId: typeof header === 'string' && CORRELATION_RE.test(header) ? header : undefined
    });
  };

  /** Middleware: builds `req.cx` and echoes the correlation id. */
  const attachContext = (req, res, next) => {
    try {
      req.cx = contextFromRequest(req);
      res.setHeader('X-Correlation-Id', req.cx.correlationId);
      next();
    } catch (err) {
      next(err);
    }
  };

  /**
   * Middleware factory: 401 without roles, 403 without the permission.
   *
   * @param {...string} required - Permissions, all of which are needed
   * @return {function(Object, Object, Function): void} Middleware
   */
  const requirePermission = (...required) => (req, res, next) => {
    try {
      const ctx = req.cx || contextFromRequest(req);
      req.cx = ctx;
      if (ctx.roles.length === 0) {
        return next(new ClientError(401, 'Authentication required', { code: 'unauthenticated' }));
      }
      const missing = required.filter((p) => !ctx.can(p));
      if (missing.length) {
        return next(new ClientError(403, `Missing permission: ${missing.join(', ')}`, { code: 'forbidden' }));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };

  return { roles: roleMap, permissionsFor, contextFromRequest, attachContext, requirePermission };
}

module.exports = { PERMISSIONS, DEFAULT_ROLES, defaultRoleResolver, createRbac };
