/**
 * @fileoverview Delivery Management Application
 * 
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const Routes = require('./routes');
const Views = require('./views');
const DataManager = require('./components/datamanager');

/**
 * Creates the Wharehouse Management Application
 * Automatically configures routes and views for the Wharehouse Management Application.
 * Integrates with noobly-core services for data persistence, file storage, caching, etc.
 * @param {Object} options - Configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @param {Object} serviceRegistry - NooblyJS Core service registry
 * @return {void}
 */
module.exports = (options, eventEmitter, serviceRegistry) => {
  const app_path = options.path || 'warehouse';

  const dataManager = new DataManager('./data');
  const filing = serviceRegistry.filing('local', { 
    baseDir: `./${app_path}-files` 
  });
  const cache = serviceRegistry.cache('memory');
  const logger = serviceRegistry.logger('console');
  const queue = serviceRegistry.queue('memory');
  const search = serviceRegistry.searching('memory');
  
  // Register routes and views
  Routes(options, eventEmitter, { dataManager, filing, cache, logger, queue, search });
  Views(options, eventEmitter, { dataManager, filing, cache, logger, queue, search });

  logger.info(`Nooblyjs ${app_path}  management app initialised`)
}
