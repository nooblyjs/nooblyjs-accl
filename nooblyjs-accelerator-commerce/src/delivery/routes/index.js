/**
 * @fileoverview Delivery Management System Routes
 *
 * Handles all API routes for delivery operations including:
 * - Order management (create, update, assign, track)
 * - Driver management (registration, scheduling, performance)
 * - Delivery operations (pickup, delivery, tracking)
 * - Customer communication and notifications
 * - Analytics and reporting
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 */

'use strict';
const path = require('path');
const mime = require('mime-types');

/**
 * Configures and registers delivery management routes with the Express application.
 * Integrates with noobly-core services for comprehensive delivery operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express - The Express application instance
 * @param {string} options.path - Base path for the delivery app
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - NooblyJS Core services object
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.express;
  const app_path = options.path || 'delivery';
  const {
    dataManager,
    dataServe,
    filing,
    cache,
    logger,
    queueing,
    scheduling,
    searching,
    notifying,
    workflow,
    working,
    measuring
  } = services;

  // Base path for all delivery API routes
  const basePath = `/applications/${app_path}/api`;

  // ================================
  // SYSTEM STATUS & HEALTH
  // ================================

  app.get(`${basePath}/status`, (req, res) => {
    res.json({
      status: 'running',
      application: 'Delivery Management System',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      services: {
        dataServe: 'active',
        cache: 'active',
        queueing: 'active',
        scheduling: 'active',
        searching: 'active',
        notifying: 'active',
        workflow: 'active',
        working: 'active',
        measuring: 'active'
      }
    });
  });

  // ================================
  // ORDER MANAGEMENT ROUTES
  // ================================

  // Create new order
  app.post(`${basePath}/orders`, async (req, res) => {
    try {
      const orderData = req.body;
      const orderId = await dataServe.create('orders', {
        ...orderData,
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Cache the order for quick access
      await cache.put(`order:${orderId}`, orderData);

      // Queue for processing
      await queueing.enqueue('order_processing', { orderId, action: 'validate' });

      logger.info(`Order created: ${orderId}`);

      res.status(201).json({
        success: true,
        orderId,
        message: 'Order created successfully'
      });
    } catch (error) {
      logger.error('Error creating order:', error);
      res.status(500).json({ success: false, error: 'Failed to create order' });
    }
  });

  // Get order by ID
  app.get(`${basePath}/orders/:orderId`, async (req, res) => {
    try {
      const { orderId } = req.params;

      // Try cache first
      let order = await cache.get(`order:${orderId}`);

      if (!order) {
        order = await dataServe.read('orders', orderId);
        if (order) {
          await cache.put(`order:${orderId}`, order);
        }
      }

      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      res.json({ success: true, order });
    } catch (error) {
      logger.error('Error retrieving order:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve order' });
    }
  });

  // Update order status
  app.patch(`${basePath}/orders/:orderId/status`, async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status, location, notes } = req.body;

      const updateData = {
        status,
        updatedAt: new Date().toISOString()
      };

      if (location) updateData.currentLocation = location;
      if (notes) updateData.notes = notes;

      await dataServe.update('orders', orderId, updateData);

      // Update cache
      const cachedOrder = await cache.get(`order:${orderId}`);
      if (cachedOrder) {
        await cache.put(`order:${orderId}`, { ...cachedOrder, ...updateData });
      }

      // Notify subscribers about status change
      await notifying.publish('order_status_update', {
        orderId,
        status,
        timestamp: updateData.updatedAt
      });

      logger.info(`Order ${orderId} status updated to: ${status}`);

      res.json({ success: true, message: 'Order status updated' });
    } catch (error) {
      logger.error('Error updating order status:', error);
      res.status(500).json({ success: false, error: 'Failed to update order status' });
    }
  });

  // Search orders
  app.get(`${basePath}/orders`, async (req, res) => {
    try {
      const { status, driverId, customerId, search: searchTerm } = req.query;

      let results;
      if (searchTerm) {
        results = await searching.search('orders', searchTerm);
      } else {
        // Filter by criteria
        results = await dataServe.list('orders');

        if (status) {
          results = results.filter(order => order.status === status);
        }
        if (driverId) {
          results = results.filter(order => order.driverId === driverId);
        }
        if (customerId) {
          results = results.filter(order => order.customerId === customerId);
        }
      }

      res.json({ success: true, orders: results });
    } catch (error) {
      logger.error('Error searching orders:', error);
      res.status(500).json({ success: false, error: 'Failed to search orders' });
    }
  });

  // ================================
  // DRIVER MANAGEMENT ROUTES
  // ================================

  // Register new driver
  app.post(`${basePath}/drivers`, async (req, res) => {
    try {
      const driverData = req.body;
      const driverId = await dataServe.create('drivers', {
        ...driverData,
        status: 'pending_verification',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Start onboarding workflow
      await workflow.start('driver_onboarding', { driverId });

      logger.info(`Driver registered: ${driverId}`);

      res.status(201).json({
        success: true,
        driverId,
        message: 'Driver registration initiated'
      });
    } catch (error) {
      logger.error('Error registering driver:', error);
      res.status(500).json({ success: false, error: 'Failed to register driver' });
    }
  });

  // Get driver by ID
  app.get(`${basePath}/drivers/:driverId`, async (req, res) => {
    try {
      const { driverId } = req.params;
      const driver = await dataServe.read('drivers', driverId);

      if (!driver) {
        return res.status(404).json({ success: false, error: 'Driver not found' });
      }

      res.json({ success: true, driver });
    } catch (error) {
      logger.error('Error retrieving driver:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve driver' });
    }
  });

  // Update driver status
  app.patch(`${basePath}/drivers/:driverId/status`, async (req, res) => {
    try {
      const { driverId } = req.params;
      const { status, location } = req.body;

      const updateData = {
        status,
        updatedAt: new Date().toISOString()
      };

      if (location) updateData.currentLocation = location;

      await dataServe.update('drivers', driverId, updateData);

      // Notify about driver status change
      await notifying.publish('driver_status_update', {
        driverId,
        status,
        location,
        timestamp: updateData.updatedAt
      });

      logger.info(`Driver ${driverId} status updated to: ${status}`);

      res.json({ success: true, message: 'Driver status updated' });
    } catch (error) {
      logger.error('Error updating driver status:', error);
      res.status(500).json({ success: false, error: 'Failed to update driver status' });
    }
  });

  // Get available drivers
  app.get(`${basePath}/drivers/available`, async (req, res) => {
    try {
      const drivers = await dataServe.list('drivers');
      const availableDrivers = drivers.filter(driver =>
        driver.status === 'available' || driver.status === 'online'
      );

      res.json({ success: true, drivers: availableDrivers });
    } catch (error) {
      logger.error('Error getting available drivers:', error);
      res.status(500).json({ success: false, error: 'Failed to get available drivers' });
    }
  });

  // ================================
  // DELIVERY TRACKING ROUTES
  // ================================

  // Track delivery in real-time
  app.get(`${basePath}/tracking/:orderId`, async (req, res) => {
    try {
      const { orderId } = req.params;

      const order = await dataServe.read('orders', orderId);
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const driver = order.driverId ? await dataServe.read('drivers', order.driverId) : null;

      const trackingInfo = {
        orderId,
        status: order.status,
        estimatedDelivery: order.estimatedDelivery,
        currentLocation: order.currentLocation,
        driver: driver ? {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          currentLocation: driver.currentLocation
        } : null
      };

      res.json({ success: true, tracking: trackingInfo });
    } catch (error) {
      logger.error('Error getting tracking info:', error);
      res.status(500).json({ success: false, error: 'Failed to get tracking info' });
    }
  });

  // ================================
  // ANALYTICS ROUTES
  // ================================

  // Get delivery analytics
  app.get(`${basePath}/analytics/overview`, async (req, res) => {
    try {
      const orders = await dataServe.list('orders');
      const drivers = await dataServe.list('drivers');

      const analytics = {
        totalOrders: orders.length,
        activeOrders: orders.filter(o => ['assigned', 'picked_up', 'in_transit'].includes(o.status)).length,
        completedOrders: orders.filter(o => o.status === 'delivered').length,
        totalDrivers: drivers.length,
        activeDrivers: drivers.filter(d => ['available', 'busy'].includes(d.status)).length,
        timestamp: new Date().toISOString()
      };

      // Store analytics metrics
      await measuring.record('delivery_analytics', analytics);

      res.json({ success: true, analytics });
    } catch (error) {
      logger.error('Error getting analytics:', error);
      res.status(500).json({ success: false, error: 'Failed to get analytics' });
    }
  });

  // ================================
  // NOTIFICATION ROUTES
  // ================================

  // Send notification
  app.post(`${basePath}/notifications`, async (req, res) => {
    try {
      const { type, recipient, message, data } = req.body;

      await notifying.publish(`notification_${type}`, {
        recipient,
        message,
        data,
        timestamp: new Date().toISOString()
      });

      logger.info(`Notification sent: ${type} to ${recipient}`);

      res.json({ success: true, message: 'Notification sent' });
    } catch (error) {
      logger.error('Error sending notification:', error);
      res.status(500).json({ success: false, error: 'Failed to send notification' });
    }
  });

  logger.info(`Delivery Management System routes registered at: ${basePath}`);
};