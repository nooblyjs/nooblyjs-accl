/**
 * @fileoverview eCommerce Management Application
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const Routes = require('./routes');
const Views = require('./views');
const DataManager = require('./components/datamanager');

/**
 * Creates the eCommerce Management Application
 * Automatically configures routes and views for the eCommerce Management Application.
 * Integrates with noobly-core services for data persistence, file storage, caching, etc.
 * @param {Object} options - Configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @param {Object} serviceRegistry - NooblyJS Core service registry
 * @return {void}
 */
module.exports = (options, eventEmitter, serviceRegistry) => {
  const app_path = options.path || 'ecommerce';

  // Initialize data manager for file-based operations
  const dataManager = new DataManager('./data');

  // Get all required services from service registry
  const dataServe = serviceRegistry.dataServe('memory');
  const filing = serviceRegistry.filing('local', {
    baseDir: `./${app_path}-files`
  });
  const cache = serviceRegistry.cache('memory');
  const logger = serviceRegistry.logger('console');
  const queue = serviceRegistry.queue('memory');
  const search = serviceRegistry.searching('memory');
  const notifying = serviceRegistry.notifying('memory');
  const measuring = serviceRegistry.measuring('memory');
  const workflow = serviceRegistry.workflow('memory');
  const scheduling = serviceRegistry.scheduling('memory');

  // Initialize eCommerce data containers
  initializeDataContainers(dataServe, logger);

  // Initialize services
  const SeedService = require('./services/seedService');
  const seedService = new SeedService(services);

  // Seed initial data
  seedService.seedAll().catch(error => {
    logger.error('Failed to seed initial data:', error);
  });

  // Set up services object for routes and views
  const services = {
    dataManager,
    dataServe,
    filing,
    cache,
    logger,
    queue,
    search,
    notifying,
    measuring,
    workflow,
    scheduling
  };

  // Register routes and views
  Routes(options, eventEmitter, services);
  Views(options, eventEmitter, services);

  logger.info(`NooblyJS ${app_path} management app initialized with full service registry`);
};

/**
 * Initialize data containers for eCommerce application
 * @param {Object} dataServe - DataServe service instance
 * @param {Object} logger - Logger service instance
 */
async function initializeDataContainers(dataServe, logger) {
  const containers = [
    'products',
    'categories',
    'users',
    'orders',
    'order_items',
    'inventory',
    'product_images',
    'product_variants',
    'carts',
    'reviews',
    'addresses',
    'payment_methods',
    'promotions',
    'analytics'
  ];

  for (const container of containers) {
    try {
      await dataServe.createContainer(container);
      logger.info(`Container '${container}' initialized`);
    } catch (error) {
      // Container may already exist
      logger.debug(`Container '${container}' already exists or failed to create: ${error.message}`);
    }
  }
}
