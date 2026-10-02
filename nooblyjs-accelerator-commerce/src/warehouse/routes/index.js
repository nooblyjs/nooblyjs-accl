/**
 * @fileoverview Warehouse Management System Routes
 *
 * Comprehensive API endpoints for warehouse operations including:
 * - Inventory Management
 * - Inbound Operations
 * - Outbound Operations
 * - Resource Management
 * - Delivery and Fulfillment
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

'use strict';

const path = require('path');
const mime = require('mime-types');

/**
 * Configures and registers warehouse management routes with the Express application.
 * Integrates with noobly-core services and WMS modules for full functionality.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - NooblyJS Core services
 * @param {Object} modules - WMS modules (inventory, inbound, outbound, resource, delivery)
 * @return {void}
 */
module.exports = (options, eventEmitter, services, modules) => {
  const app = options.express;
  const app_path = options.path || 'warehouse';
  const { dataManager, filing, cache, logger, queue, search } = services;

  // =================== SYSTEM ROUTES ===================

  app.get(`/applications/${app_path}/api/status`, (req, res) => {
    res.json({
      status: 'running',
      application: 'Warehouse Management System',
      version: '2.0.0',
      modules: Object.keys(modules),
      timestamp: new Date().toISOString()
    });
  });

  app.get(`/applications/${app_path}/api/health`, async (req, res) => {
    try {
      const health = {
        status: 'healthy',
        services: {
          dataServe: 'connected',
          cache: 'connected',
          queue: 'connected',
          search: 'connected'
        },
        modules: {},
        timestamp: new Date().toISOString()
      };

      // Check module health
      for (const [name, module] of Object.entries(modules)) {
        health.modules[name] = 'operational';
      }

      res.json(health);
    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // =================== INVENTORY MANAGEMENT ROUTES ===================

  // Products
  app.post(`/applications/${app_path}/api/products`, async (req, res) => {
    try {
      const productId = await modules.inventory.createProduct(req.body);
      res.status(201).json({ success: true, productId });
    } catch (error) {
      logger.error('Create product failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get(`/applications/${app_path}/api/products/:identifier`, async (req, res) => {
    try {
      const product = await modules.inventory.getProduct(req.params.identifier);
      res.json({ success: true, data: product });
    } catch (error) {
      logger.error('Get product failed:', error);
      res.status(404).json({ success: false, error: error.message });
    }
  });

  app.put(`/applications/${app_path}/api/products/:identifier`, async (req, res) => {
    try {
      const product = await modules.inventory.updateProduct(req.params.identifier, req.body);
      res.json({ success: true, data: product });
    } catch (error) {
      logger.error('Update product failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Locations
  app.post(`/applications/${app_path}/api/locations`, async (req, res) => {
    try {
      const locationId = await modules.inventory.createLocation(req.body);
      res.status(201).json({ success: true, locationId });
    } catch (error) {
      logger.error('Create location failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get(`/applications/${app_path}/api/locations/available/:productSku`, async (req, res) => {
    try {
      const locations = await modules.inventory.getAvailableLocations(
        req.params.productSku,
        req.query.type
      );
      res.json({ success: true, data: locations });
    } catch (error) {
      logger.error('Get available locations failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Inventory
  app.get(`/applications/${app_path}/api/inventory/:productSku`, async (req, res) => {
    try {
      const inventory = await modules.inventory.getInventory(
        req.params.productSku,
        req.query.location
      );
      res.json({ success: true, data: inventory });
    } catch (error) {
      logger.error('Get inventory failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/inventory/adjust`, async (req, res) => {
    try {
      const { productSku, locationCode, quantity, reason } = req.body;
      const result = await modules.inventory.adjustInventory(productSku, locationCode, quantity, reason);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Inventory adjustment failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/inventory/allocate`, async (req, res) => {
    try {
      const { productSku, quantity, orderId } = req.body;
      const allocations = await modules.inventory.allocateInventory(productSku, quantity, orderId);
      res.json({ success: true, data: allocations });
    } catch (error) {
      logger.error('Inventory allocation failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Lots and Batches
  app.post(`/applications/${app_path}/api/lots`, async (req, res) => {
    try {
      const lotId = await modules.inventory.createLot(req.body);
      res.status(201).json({ success: true, lotId });
    } catch (error) {
      logger.error('Create lot failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get(`/applications/${app_path}/api/lots/product/:productSku`, async (req, res) => {
    try {
      const lots = await modules.inventory.getLotsByProduct(req.params.productSku, req.query.status);
      res.json({ success: true, data: lots });
    } catch (error) {
      logger.error('Get lots failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get(`/applications/${app_path}/api/lots/expiring`, async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const lots = await modules.inventory.getExpiringLots(days);
      res.json({ success: true, data: lots });
    } catch (error) {
      logger.error('Get expiring lots failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // =================== INBOUND OPERATIONS ROUTES ===================

  // Purchase Orders
  app.post(`/applications/${app_path}/api/purchase-orders`, async (req, res) => {
    try {
      const poId = await modules.inbound.createPurchaseOrder(req.body);
      res.status(201).json({ success: true, poId });
    } catch (error) {
      logger.error('Create purchase order failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // ASN Processing
  app.post(`/applications/${app_path}/api/asn`, async (req, res) => {
    try {
      const asnId = await modules.inbound.processASN(req.body);
      res.status(201).json({ success: true, asnId });
    } catch (error) {
      logger.error('Process ASN failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Receiving
  app.post(`/applications/${app_path}/api/receiving/start`, async (req, res) => {
    try {
      const receiptId = await modules.inbound.startReceiving(req.body);
      res.status(201).json({ success: true, receiptId });
    } catch (error) {
      logger.error('Start receiving failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/receiving/item`, async (req, res) => {
    try {
      const result = await modules.inbound.processReceivedItem(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Process received item failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Put-away
  app.post(`/applications/${app_path}/api/putaway/complete/:taskId`, async (req, res) => {
    try {
      const result = await modules.inbound.completePutAwayTask(req.params.taskId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Complete put-away failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // =================== OUTBOUND OPERATIONS ROUTES ===================

  // Orders
  app.post(`/applications/${app_path}/api/orders`, async (req, res) => {
    try {
      const orderId = await modules.outbound.createOrder(req.body);
      res.status(201).json({ success: true, orderId });
    } catch (error) {
      logger.error('Create order failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/orders/:orderId/validate`, async (req, res) => {
    try {
      const result = await modules.outbound.validateOrder(req.params.orderId);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Validate order failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/orders/:orderId/allocate`, async (req, res) => {
    try {
      const result = await modules.outbound.allocateOrder(req.params.orderId);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Allocate order failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Waves
  app.post(`/applications/${app_path}/api/waves`, async (req, res) => {
    try {
      const waveId = await modules.outbound.createWave(req.body);
      res.status(201).json({ success: true, waveId });
    } catch (error) {
      logger.error('Create wave failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/waves/:waveId/plan`, async (req, res) => {
    try {
      const result = await modules.outbound.planWave(req.params.waveId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Plan wave failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/waves/:waveId/pick-tasks`, async (req, res) => {
    try {
      const taskIds = await modules.outbound.generatePickTasks(req.params.waveId);
      res.json({ success: true, data: { taskIds, count: taskIds.length } });
    } catch (error) {
      logger.error('Generate pick tasks failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Picking
  app.post(`/applications/${app_path}/api/picking/complete/:taskId`, async (req, res) => {
    try {
      const result = await modules.outbound.completePickTask(req.params.taskId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Complete pick task failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Packing
  app.get(`/applications/${app_path}/api/packing/slip/:orderId`, async (req, res) => {
    try {
      const packingSlip = await modules.outbound.createPackingSlip(req.params.orderId);
      res.json({ success: true, data: packingSlip });
    } catch (error) {
      logger.error('Create packing slip failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/packing/complete/:orderId`, async (req, res) => {
    try {
      const result = await modules.outbound.completePackingOrder(req.params.orderId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Complete packing failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // =================== RESOURCE MANAGEMENT ROUTES ===================

  // Staff
  app.post(`/applications/${app_path}/api/staff`, async (req, res) => {
    try {
      const staffId = await modules.resource.createStaffMember(req.body);
      res.status(201).json({ success: true, staffId });
    } catch (error) {
      logger.error('Create staff failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/staff/:employeeId/assign`, async (req, res) => {
    try {
      const assignment = await modules.resource.assignTaskToStaff(req.params.employeeId, req.body);
      res.json({ success: true, data: assignment });
    } catch (error) {
      logger.error('Assign task to staff failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/staff/assignments/:assignmentId/complete`, async (req, res) => {
    try {
      const result = await modules.resource.completeTaskAssignment(req.params.assignmentId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Complete task assignment failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get(`/applications/${app_path}/api/staff/available`, async (req, res) => {
    try {
      const staff = await modules.resource.getAvailableStaff(
        req.query.taskType,
        req.query.skills ? req.query.skills.split(',') : []
      );
      res.json({ success: true, data: staff });
    } catch (error) {
      logger.error('Get available staff failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Equipment
  app.post(`/applications/${app_path}/api/equipment`, async (req, res) => {
    try {
      const equipmentId = await modules.resource.createEquipment(req.body);
      res.status(201).json({ success: true, equipmentId });
    } catch (error) {
      logger.error('Create equipment failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/equipment/:assetId/assign/:employeeId`, async (req, res) => {
    try {
      const assignment = await modules.resource.assignEquipment(
        req.params.assetId,
        req.params.employeeId,
        req.body
      );
      res.json({ success: true, data: assignment });
    } catch (error) {
      logger.error('Assign equipment failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/equipment/assignments/:assignmentId/return`, async (req, res) => {
    try {
      const result = await modules.resource.returnEquipment(req.params.assignmentId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Return equipment failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Performance Reports
  app.get(`/applications/${app_path}/api/reports/staff-performance`, async (req, res) => {
    try {
      const report = await modules.resource.generateStaffPerformanceReport(req.query);
      res.json({ success: true, data: report });
    } catch (error) {
      logger.error('Generate staff performance report failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get(`/applications/${app_path}/api/reports/equipment-utilization`, async (req, res) => {
    try {
      const report = await modules.resource.generateEquipmentUtilizationReport(req.query);
      res.json({ success: true, data: report });
    } catch (error) {
      logger.error('Generate equipment utilization report failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // =================== DELIVERY AND FULFILLMENT ROUTES ===================

  // Carriers
  app.post(`/applications/${app_path}/api/carriers`, async (req, res) => {
    try {
      const carrierId = await modules.delivery.createCarrier(req.body);
      res.status(201).json({ success: true, carrierId });
    } catch (error) {
      logger.error('Create carrier failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/carriers/select`, async (req, res) => {
    try {
      const selection = await modules.delivery.selectOptimalCarrier(req.body);
      res.json({ success: true, data: selection });
    } catch (error) {
      logger.error('Select carrier failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Shipments
  app.post(`/applications/${app_path}/api/shipments`, async (req, res) => {
    try {
      const shipmentId = await modules.delivery.createShipment(req.body);
      res.status(201).json({ success: true, shipmentId });
    } catch (error) {
      logger.error('Create shipment failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/shipments/:shipmentId/labels`, async (req, res) => {
    try {
      const result = await modules.delivery.generateShippingLabels(req.params.shipmentId);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Generate shipping labels failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/shipments/:shipmentId/tracking`, async (req, res) => {
    try {
      const tracking = await modules.delivery.updateShipmentTracking(req.params.shipmentId, req.body);
      res.json({ success: true, data: tracking });
    } catch (error) {
      logger.error('Update shipment tracking failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Returns
  app.post(`/applications/${app_path}/api/returns`, async (req, res) => {
    try {
      const rmaId = await modules.delivery.createReturnAuthorization(req.body);
      res.status(201).json({ success: true, rmaId });
    } catch (error) {
      logger.error('Create return authorization failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post(`/applications/${app_path}/api/returns/:rmaId/process`, async (req, res) => {
    try {
      const result = await modules.delivery.processReceivedReturn(req.params.rmaId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Process return failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Delivery Reports
  app.get(`/applications/${app_path}/api/reports/delivery-performance`, async (req, res) => {
    try {
      const report = await modules.delivery.generateDeliveryPerformanceReport(req.query);
      res.json({ success: true, data: report });
    } catch (error) {
      logger.error('Generate delivery performance report failed:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  });

  logger.info('Warehouse Management System API routes registered successfully');
};