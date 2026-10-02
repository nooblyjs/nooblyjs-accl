/**
 * @fileoverview The customer module (PRD §6.2, roadmap Phase 1).
 *
 * Customers, organizations, addresses / phones / emails, identities, the
 * consent ledger, notes and the customer 360 timeline, with a REST API at
 * `{basePath}/customer/api/v1` and an admin UI at `{basePath}/customer/`.
 *
 * In-process API (returned by `mount()` as `cx.customer`):
 *   create, get, update, list, remove, setStatus, lookup, typeahead,
 *   upsertByIdentity, canContact, getConsentState, recordConsent,
 *   timeline, registerTimelineProvider, services, schemas
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const path = require('path');
const { createModule } = require('../shared/module');
const { BaseRepository } = require('../shared/repository');
const { systemContext } = require('../shared/context');
const schemas = require('./schemas');
const { ContactPointService } = require('./services/contactPointService');
const { IdentityService } = require('./services/identityService');
const { ConsentService } = require('./services/consentService');
const { CustomerService } = require('./services/customerService');
const { OrganizationService } = require('./services/organizationService');
const { NoteService } = require('./services/noteService');
const { TimelineService } = require('./services/timelineService');
const { registerRoutes } = require('./routes');
const { seedCustomers } = require('./seed');

/**
 * Creates the customer module and mounts its API and UI.
 *
 * Module options (`options.customer`): `{ defaultCountry?: 'ZA' }` for
 * national-format phone numbers. `options.seed` (true or
 * `{ customers, organizations }`) seeds demo data into an empty store.
 *
 * @param {Object} params
 * @param {Object} params.app - Host Express app
 * @param {Object} params.shared - Shared mount context (see index.js)
 * @return {{name: string, api: Object, services: Object, apiBase: string, uiBase: string, init: function(): Promise<void>, shutdown: function(): Promise<void>}} Module
 */
module.exports = function createCustomerModule({ app, shared }) {
  const scaffold = createModule({ name: 'customer', app, shared, viewsDir: path.join(__dirname, 'views') });
  const moduleOptions = shared.options.customer || {};
  const deps = shared.repositoryDeps('customer');

  const repos = {};
  for (const key of ['customer', 'organization', 'address', 'phone', 'email', 'identity', 'consent', 'note']) {
    repos[key] = new BaseRepository(schemas[key], deps);
  }

  const contactPoints = {
    address: new ContactPointService('address', { repos, options: moduleOptions }),
    phone: new ContactPointService('phone', { repos, options: moduleOptions }),
    email: new ContactPointService('email', { repos, options: moduleOptions })
  };
  const identities = new IdentityService({ repos, options: moduleOptions });
  const consents = new ConsentService({ repos, events: shared.events });
  const notes = new NoteService({ repos });
  const customers = new CustomerService({ repos, contactPoints, identities, consents, notes, events: shared.events, options: moduleOptions });
  const organizations = new OrganizationService({ repos, contactPoints });
  const timeline = new TimelineService({ repos, audit: shared.audit });
  const services = { customers, organizations, contactPoints, identities, consents, notes, timeline, repos };

  registerRoutes({ router: scaffold.router, rbac: shared.rbac, services, audit: shared.audit, openapi: scaffold.openapi });
  scaffold.finalize();

  const sys = (ctx) => ctx || systemContext('customer');
  const api = {
    services,
    schemas,
    create: (input, ctx) => customers.create(input, sys(ctx)),
    get: (id, opts, ctx) => customers.get(id, sys(ctx), opts),
    update: (id, patch, ctx, opts) => customers.update(id, patch, sys(ctx), opts),
    list: (query, ctx) => customers.list(query || {}, sys(ctx)),
    remove: (id, ctx) => customers.remove(id, sys(ctx)),
    setStatus: (id, status, ctx, opts) => customers.setStatus(id, status, sys(ctx), opts),
    lookup: (params, ctx) => customers.lookup(params, sys(ctx)),
    typeahead: (text, ctx, opts) => customers.typeahead(text, sys(ctx), opts),
    upsertByIdentity: (identity, profile, ctx) => customers.upsertByIdentity(identity, profile, sys(ctx)),
    recordConsent: (customerId, input, ctx) => consents.record(customerId, input, sys(ctx)),
    getConsentState: (customerId, ctx) => consents.getConsentState(customerId, sys(ctx)),
    canContact: (customerId, request, ctx) => consents.canContact(customerId, request, sys(ctx)),
    timeline: (customerId, opts, ctx) => timeline.list(customerId, sys(ctx), opts),
    registerTimelineProvider: (type, provider) => timeline.register(type, provider)
  };

  return {
    name: 'customer',
    api,
    services,
    apiBase: scaffold.apiBase,
    uiBase: scaffold.uiBase,
    async init() {
      for (const repo of Object.values(repos)) await repo.init();
      const seed = shared.options.seed;
      if (seed) {
        const result = await seedCustomers(services, typeof seed === 'object' ? seed : {});
        if (!result.skipped) shared.logger?.info?.(`[accel-customers] seeded ${result.customers} customers, ${result.organizations} organizations`);
      }
    },
    async shutdown() {}
  };
};
