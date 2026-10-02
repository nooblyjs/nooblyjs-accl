/**
 * @fileoverview In-memory ServiceRegistry stand-in for unit tests.
 *
 * Builds core's real memory providers directly (no singleton, no routes, no
 * timers), so repository and mount tests run against the same behaviour as
 * production memory providers.
 */

'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const MemoryDataService = require('nooblyjs-core/src/dataservice/providers/dataservice');
const FileDataService = require('nooblyjs-core/src/dataservice/providers/dataservicefiles');
const MemoryCache = require('nooblyjs-core/src/caching/providers/caching');
const MemorySearch = require('nooblyjs-core/src/searching/providers/searching');
const MemoryNotifying = require('nooblyjs-core/src/notifying/providers/notifying');
const MemoryQueue = require('nooblyjs-core/src/queueing/providers/queueing');

/** Logger that records calls instead of printing. */
function createSilentLogger() {
  const calls = [];
  const log = (level) => (message, meta) => { calls.push({ level, message, meta }); };
  return { calls, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

/**
 * A fresh directory under `.temp/tests/` for file-provider tests.
 *
 * @param {string} name - Directory name prefix
 * @return {string} Absolute path (created, empty)
 */
function tempDir(name) {
  const dir = path.join(__dirname, '..', '..', '.temp', 'tests', `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Creates core services wired to one emitter: memory providers, or the file
 * data provider when `CX_TEST_DATA=file` (or `data: 'file'`).
 *
 * @param {EventEmitter} [eventEmitter] - Shared emitter
 * @param {Object} [opts] - `{ data: 'memory' | 'file' }`
 * @return {{eventEmitter: EventEmitter, dataService: Object, cache: Object, search: Object, notifying: Object, logger: Object}} Services
 */
function createServices(eventEmitter = new EventEmitter(), { data = process.env.CX_TEST_DATA || 'memory' } = {}) {
  return {
    eventEmitter,
    dataService: data === 'file'
      ? new FileDataService({ dataDir: tempDir('data') }, eventEmitter)
      : new MemoryDataService({}, eventEmitter),
    cache: new MemoryCache({ instanceName: 'test' }, eventEmitter),
    search: new MemorySearch({}, eventEmitter),
    notifying: new MemoryNotifying({}, eventEmitter),
    queue: new MemoryQueue({}, eventEmitter),
    logger: createSilentLogger()
  };
}

/**
 * Minimal ServiceRegistry with the factory methods `mount()` calls.
 *
 * @param {Object} [services] - From createServices()
 * @return {Object} Registry stand-in (records the provider types requested)
 */
function createMockRegistry(services = createServices()) {
  const requested = {};
  const factory = (name, instance) => (type, options) => {
    requested[name] = { type, options };
    return instance;
  };
  return {
    initialized: true,
    requested,
    services,
    logger: factory('logger', services.logger),
    dataService: factory('dataService', services.dataService),
    cache: factory('cache', services.cache),
    searching: factory('searching', services.search),
    notifying: factory('notifying', services.notifying),
    queue: factory('queue', services.queue)
  };
}

module.exports = { createServices, createMockRegistry, createSilentLogger, tempDir };
