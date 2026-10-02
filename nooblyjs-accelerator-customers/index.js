/**
 * @fileoverview nooblyjs-accel-customers: customer data, marketing and
 * contact-centre modules for NooblyJS applications.
 *
 * The package is a library. The host owns the Express app, the shared
 * EventEmitter and the core ServiceRegistry, and calls `mount()`:
 *
 * @example
 * const serviceRegistry = require('nooblyjs-core');
 * const customers = require('nooblyjs-accel-customers');
 *
 * serviceRegistry.initialize(app, eventEmitter, { ... });
 * const cx = await customers.mount(app, eventEmitter, serviceRegistry, {
 *   modules: ['customer', 'marketing', 'support'],
 *   basePath: '/applications'
 * });
 * cx.events.on('customer.created', (evt) => { ... });
 * await cx.shutdown();
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const path = require('path');
const express = require('express');
const { version } = require('./package.json');
const schema = require('./src/shared/schema');
const repository = require('./src/shared/repository');
const http = require('./src/shared/http');
const errors = require('./src/shared/errors');
const { createContext, systemContext } = require('./src/shared/context');
const { DomainEventBus } = require('./src/shared/events');
const { AuditService } = require('./src/shared/audit');
const { createRbac, DEFAULT_ROLES, PERMISSIONS } = require('./src/shared/rbac');
const { adapters, ChannelAdapter } = require('./src/marketing/channels');

const MODULES = Object.freeze({
  customer: { factory: () => require('./src/customer'), requires: [] },
  marketing: { factory: () => require('./src/marketing'), requires: ['customer'] },
  support: { factory: () => require('./src/support'), requires: ['customer'] }
});

const DEFAULT_OPTIONS = Object.freeze({
  modules: ['customer', 'marketing', 'support'],
  basePath: '/applications',
  containerPrefix: 'cx',
  bodyLimit: '1mb',
  ui: true,
  cacheDocuments: false
});

/**
 * Validates and fills in mount options.
 *
 * @param {Object} [options] - Caller options
 * @return {Object} Normalised options
 * @throws {Error} On invalid options
 */
function normaliseOptions(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  opts.providers = { ...(options.providers || {}) };
  opts.tenancy = { enabled: false, ...(options.tenancy || {}) };
  opts.auth = { ...(options.auth || {}) };

  if (!Array.isArray(opts.modules) || opts.modules.length === 0) {
    throw new Error('mount: options.modules must be a non-empty array');
  }
  for (const name of opts.modules) {
    if (!MODULES[name]) throw new Error(`mount: unknown module '${name}' (expected ${Object.keys(MODULES).join(', ')})`);
    for (const dep of MODULES[name].requires) {
      if (!opts.modules.includes(dep)) throw new Error(`mount: module '${name}' requires '${dep}'`);
    }
  }
  if (typeof opts.basePath !== 'string' || !/^(\/[A-Za-z0-9_-]+)*$/.test(opts.basePath)) {
    throw new Error("mount: options.basePath must look like '/applications' (no trailing slash), or '' for the root");
  }
  if (!/^[a-z][a-z0-9]{0,15}$/.test(opts.containerPrefix)) {
    throw new Error('mount: options.containerPrefix must be 1-16 lower-case letters/digits, starting with a letter');
  }
  // Customer is the hub: mount it first.
  opts.modules = Object.keys(MODULES).filter((m) => opts.modules.includes(m));
  return opts;
}

/**
 * Resolves the core services the accelerator uses, honouring `options.providers`.
 *
 * @param {Object} serviceRegistry - Initialised core ServiceRegistry
 * @param {Object} opts - Normalised options
 * @return {Object} Core services
 */
function resolveCoreServices(serviceRegistry, opts) {
  const p = opts.providers;
  const pick = (key, fallback) => ({ type: (p[key] && p[key].type) || fallback, options: (p[key] && p[key].options) || {} });
  const data = pick('data', 'memory');
  const cache = pick('cache', 'memory');
  const search = pick('search', 'memory');
  const notify = pick('notifying', 'memory');
  const queue = pick('queue', 'memory');
  const logging = pick('logging', 'console');
  return {
    serviceRegistry,
    logger: serviceRegistry.logger(logging.type, logging.options),
    dataService: serviceRegistry.dataService(data.type, data.options),
    // A dedicated cache instance keeps index keys apart from the host's cache.
    cache: serviceRegistry.cache(cache.type, { instanceName: opts.containerPrefix, ...cache.options }),
    search: serviceRegistry.searching(search.type, search.options),
    notifying: serviceRegistry.notifying(notify.type, notify.options),
    queue: typeof serviceRegistry.queue === 'function' ? serviceRegistry.queue(queue.type, queue.options) : null
  };
}

/**
 * Mounts the accelerator's modules on a host app.
 *
 * @param {Object} app - Host Express app
 * @param {EventEmitter} eventEmitter - Host's shared event emitter
 * @param {Object} serviceRegistry - Core ServiceRegistry, already `initialize()`d
 * @param {Object} [options]
 * @param {string[]} [options.modules] - Modules to enable (marketing/support require customer)
 * @param {string} [options.basePath='/applications'] - Mount prefix for APIs and UIs
 * @param {string} [options.containerPrefix='cx'] - dataService container namespace
 * @param {Object} [options.providers] - `{ data, cache, search, notifying, queue, logging }`, each `{ type, options }`
 * @param {{enabled?: boolean, resolve?: function(Object): string}} [options.tenancy] - Multi-tenancy
 * @param {{roleResolver?: function(Object): string[], roles?: Object<string, string[]>}} [options.auth] - RBAC
 * @param {boolean} [options.ui=true] - Serve the module UIs
 * @param {string} [options.bodyLimit='1mb'] - JSON body limit on module APIs
 * @param {boolean} [options.cacheDocuments=false] - Read-through document cache in repositories
 * @return {Promise<Object>} `{ customer, marketing, support, events, audit, schemas, context, options, shutdown }`
 * @throws {Error} On invalid options or an uninitialised registry
 */
async function mount(app, eventEmitter, serviceRegistry, options = {}) {
  if (!app || typeof app.use !== 'function') throw new Error('mount: an Express app is required');
  if (!eventEmitter || typeof eventEmitter.emit !== 'function') throw new Error('mount: an EventEmitter is required');
  if (!serviceRegistry || typeof serviceRegistry.dataService !== 'function') {
    throw new Error('mount: a nooblyjs-core ServiceRegistry is required');
  }
  if (serviceRegistry.initialized === false) {
    throw new Error('mount: call serviceRegistry.initialize(app, eventEmitter, ...) before mount()');
  }

  const opts = normaliseOptions(options);
  const core = resolveCoreServices(serviceRegistry, opts);
  const events = new DomainEventBus({
    eventEmitter, notifying: core.notifying, logger: core.logger, prefix: 'cx'
  });
  const audit = new AuditService({ dataService: core.dataService, containerPrefix: opts.containerPrefix, logger: core.logger });
  const counter = new repository.Counter(core.dataService, `${opts.containerPrefix}_counters`);
  const rbac = createRbac({ roles: opts.auth.roles, roleResolver: opts.auth.roleResolver, tenancy: opts.tenancy });

  const shared = {
    version,
    options: opts,
    eventEmitter,
    core,
    logger: core.logger,
    events,
    audit,
    counter,
    rbac,
    healthChecks: {
      dataService: () => core.dataService.count(`${opts.containerPrefix}_counters`)
    },
    /**
     * Dependencies for a module's BaseRepository instances.
     *
     * @param {string} module - Owning module
     * @return {Object} Repository deps
     */
    repositoryDeps(module) {
      return {
        dataService: core.dataService,
        cache: core.cache,
        search: core.search,
        logger: core.logger,
        events,
        audit,
        counter,
        module,
        containerPrefix: opts.containerPrefix,
        cacheDocuments: opts.cacheDocuments
      };
    }
  };

  // Theme, shared styles and UI helpers used by every module UI.
  if (opts.ui !== false) app.use(`${opts.basePath}/_cx`, express.static(path.join(__dirname, 'src', 'shared', 'views')));

  const modules = {};
  for (const name of opts.modules) {
    modules[name] = MODULES[name].factory()({ app, shared, modules });
  }
  for (const name of opts.modules) await modules[name].init();

  let closed = false;
  const result = {
    events,
    audit,
    options: opts,
    version,
    context: { create: createContext, system: systemContext },
    /**
     * Stops schedulers, routing loops and listeners. Idempotent.
     *
     * @return {Promise<void>}
     */
    async shutdown() {
      if (closed) return;
      closed = true;
      for (const name of [...opts.modules].reverse()) await modules[name].shutdown();
      events.close();
    }
  };
  for (const name of opts.modules) result[name] = modules[name].api;
  core.logger?.info?.(`[accel-customers] mounted ${opts.modules.join(', ')} at ${opts.basePath || '/'} (v${version})`);
  return result;
}

module.exports = {
  mount,
  version,
  normaliseOptions,
  schema,
  repository,
  http,
  errors,
  context: { createContext, systemContext },
  rbac: { createRbac, DEFAULT_ROLES, PERMISSIONS },
  adapters,
  ChannelAdapter,
  DomainEventBus,
  AuditService
};
