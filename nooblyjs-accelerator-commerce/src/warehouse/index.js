/**
 * @fileoverview Warehouse Management System (WMS)
 *
 * Comprehensive warehouse management application with:
 * - Real-time inventory tracking and management
 * - Inbound order processing and put-away optimization
 * - Outbound order picking and fulfillment
 * - Resource management (staff, equipment, space)
 * - Integration with delivery partners and external systems
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

'use strict';

const Routes = require('./routes');
const Views = require('./views');
const DataManager = require('./components/datamanager');

// Core modules
const InventoryModule = require('./modules/inventory');
const InboundModule = require('./modules/inbound');
const OutboundModule = require('./modules/outbound');
const ResourceModule = require('./modules/resource');
const DeliveryModule = require('./modules/delivery');

/**
 * Creates the Warehouse Management System (WMS)
 * Automatically configures routes and views for comprehensive warehouse operations.
 * Integrates with noobly-core services for data persistence, file storage, caching, etc.
 * @param {Object} options - Configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @param {Object} serviceRegistry - NooblyJS Core service registry
 * @return {void}
 */
module.exports = (options, eventEmitter, serviceRegistry) => {
  const app_path = options.path || 'warehouse';

  // Initialize NooblyJS Core services
  const dataServe = serviceRegistry.dataServe('memory');
  const filing = serviceRegistry.filing('local', {
    baseDir: `./${app_path}-files`
  });
  const cache = serviceRegistry.cache('memory');
  const logger = serviceRegistry.logger('console');
  const queue = serviceRegistry.queue('memory');
  const search = serviceRegistry.searching('memory');
  const measuring = serviceRegistry.measuring('memory');
  const workflow = serviceRegistry.workflow('memory');

  // Legacy DataManager for backward compatibility
  const dataManager = new DataManager('./data');

  const services = {
    dataServe,
    dataManager,
    filing,
    cache,
    logger,
    queue,
    search,
    measuring,
    workflow
  };

  // Initialize core WMS modules
  const inventoryModule = new InventoryModule(services, eventEmitter);
  const inboundModule = new InboundModule(services, eventEmitter);
  const outboundModule = new OutboundModule(services, eventEmitter);
  const resourceModule = new ResourceModule(services, eventEmitter);
  const deliveryModule = new DeliveryModule(services, eventEmitter);

  // Store module instances for routes
  const modules = {
    inventory: inventoryModule,
    inbound: inboundModule,
    outbound: outboundModule,
    resource: resourceModule,
    delivery: deliveryModule
  };

  // Register routes and views
  Routes(options, eventEmitter, services, modules);
  Views(options, eventEmitter, services);

  // Initialize data containers on startup
  initializeDataContainers(services.dataServe, logger).catch(error => {
    logger.error('Failed to initialize data containers:', error);
  });

  logger.info(`Warehouse Management System (WMS) v2.0.0 initialized successfully`);
  logger.info(`Available modules: ${Object.keys(modules).join(', ')}`);
};

/**
 * Initialize data containers for WMS entities
 */
async function initializeDataContainers(dataServe, logger) {
  const containers = [
    'products', 'locations', 'inventory', 'lots', 'batches',
    'purchase_orders', 'receipts', 'putaway_tasks',
    'orders', 'waves', 'picks', 'shipments',
    'staff', 'equipment', 'tasks',
    'carriers', 'deliveries', 'returns'
  ];

  try {
    for (const container of containers) {
      // Check if container exists by trying to retrieve status
      try {
        await dataServe.list(container);
        logger.info(`Container '${container}' already exists`);
      } catch (error) {
        // Container doesn't exist, create it using createContainer method
        try {
          await dataServe.createContainer(container);
          logger.info(`Container '${container}' created successfully`);
        } catch (createError) {
          // Fallback: create it by adding a dummy record and removing it
          const id = await dataServe.add(container, { _init: true });
          await dataServe.remove(container, id);
          logger.info(`Container '${container}' initialized via fallback method`);
        }
      }
    }
    logger.info('All WMS data containers initialized successfully');
  } catch (error) {
    logger.error('Error initializing data containers:', error);
    logger.error('Failed to initialize data containers:', error.message);
  }
}
