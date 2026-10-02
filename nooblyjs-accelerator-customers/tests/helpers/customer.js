'use strict';

/**
 * Mounts the customer module on a fresh app with the in-memory registry.
 * Requests choose their roles with the `x-role` header (comma-separated).
 */

const express = require('express');
const request = require('supertest');
const customers = require('../..');
const { createServices, createMockRegistry } = require('./registry');
const { systemContext, createContext } = require('../../src/shared/context');
const { DEFAULT_ROLES } = require('../../src/shared/rbac');

const API = '/applications/customer/api/v1';

async function mountCustomer(options = {}, servicesOpts = {}) {
  const services = createServices(undefined, servicesOpts);
  const registry = createMockRegistry(services);
  const app = express();
  const cx = await customers.mount(app, services.eventEmitter, registry, {
    modules: ['customer'],
    auth: { roleResolver: (req) => String(req.headers['x-role'] || '').split(',').filter(Boolean) },
    ...options
  });
  const svc = cx.customer.services;
  const as = (role) => {
    const call = (method) => (path) => request(app)[method](`${API}${path}`).set('x-role', role);
    return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
  };
  return { app, cx, svc, services, registry, admin: as('admin'), as, sys: systemContext('test') };
}

/** A context with a role's default permissions. */
function roleContext(role, tenantId) {
  return createContext({ actor: { type: 'user', id: `u-${role}` }, roles: [role], permissions: DEFAULT_ROLES[role], tenantId });
}

module.exports = { mountCustomer, roleContext, API };
