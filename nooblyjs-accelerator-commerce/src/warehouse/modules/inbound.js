/**
 * @fileoverview Inbound Operations Module
 *
 * Handles all inbound warehouse operations including:
 * - Purchase Order Management
 * - Receiving Process
 * - Put-away Operations
 * - Cross-docking
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

class InboundModule {
  constructor(services, eventEmitter) {
    this.services = services;
    this.eventEmitter = eventEmitter;
    this.logger = services.logger;
    this.dataServe = services.dataServe;
    this.cache = services.cache;
    this.queue = services.queue;
    this.workflow = services.workflow;
  }

  // =================== PURCHASE ORDER MANAGEMENT ===================

  /**
   * Create a new purchase order
   * @param {Object} poData - Purchase order data
   * @returns {Promise<string>} PO UUID
   */
  async createPurchaseOrder(poData) {
    try {
      const po = {
        id: poData.id || uuidv4(),
        poNumber: poData.poNumber,
        supplier: {
          id: poData.supplier.id,
          name: poData.supplier.name,
          contact: poData.supplier.contact
        },
        expectedDeliveryDate: poData.expectedDeliveryDate,
        items: poData.items.map(item => ({
          productSku: item.productSku,
          description: item.description,
          orderedQuantity: item.orderedQuantity,
          receivedQuantity: 0,
          unitCost: item.unitCost,
          totalCost: item.orderedQuantity * item.unitCost
        })),
        status: 'pending', // pending, confirmed, partially_received, received, closed
        totalValue: poData.items.reduce((sum, item) => sum + (item.orderedQuantity * item.unitCost), 0),
        notes: poData.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const poId = await this.dataServe.add('purchase_orders', po);

      this.eventEmitter.emit('po.created', { poId, po });
      this.logger.info(`Purchase Order created: ${po.poNumber} (${poId})`);

      return poId;
    } catch (error) {
      this.logger.error('Error creating purchase order:', error);
      throw new Error(`Failed to create purchase order: ${error.message}`);
    }
  }

  /**
   * Process Advanced Shipping Notice (ASN)
   * @param {Object} asnData - ASN data
   * @returns {Promise<string>} ASN UUID
   */
  async processASN(asnData) {
    try {
      const asn = {
        id: asnData.id || uuidv4(),
        asnNumber: asnData.asnNumber,
        poNumber: asnData.poNumber,
        carrier: asnData.carrier,
        trackingNumber: asnData.trackingNumber,
        expectedArrival: asnData.expectedArrival,
        items: asnData.items,
        status: 'in_transit', // in_transit, arrived, received
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const asnId = await this.dataServe.add('asns', asn);

      // Schedule dock appointment if needed
      if (asnData.scheduleDockAppointment) {
        await this.scheduleDockAppointment(asnId, asnData.expectedArrival);
      }

      this.eventEmitter.emit('asn.processed', { asnId, asn });
      this.logger.info(`ASN processed: ${asn.asnNumber} for PO ${asn.poNumber}`);

      return asnId;
    } catch (error) {
      this.logger.error('Error processing ASN:', error);
      throw new Error(`Failed to process ASN: ${error.message}`);
    }
  }

  /**
   * Schedule dock door appointment
   * @param {string} asnId - ASN ID
   * @param {string} expectedArrival - Expected arrival time
   * @returns {Promise<string>} Appointment UUID
   */
  async scheduleDockAppointment(asnId, expectedArrival) {
    try {
      // Find available dock door
      const availableDock = await this.findAvailableDockDoor(expectedArrival);

      const appointment = {
        id: uuidv4(),
        asnId,
        dockDoor: availableDock.door,
        scheduledTime: expectedArrival,
        duration: 120, // minutes
        status: 'scheduled', // scheduled, in_progress, completed, cancelled
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const appointmentId = await this.dataServe.add('dock_appointments', appointment);

      this.eventEmitter.emit('dock.appointment.scheduled', { appointmentId, appointment });
      this.logger.info(`Dock appointment scheduled: Door ${availableDock.door} at ${expectedArrival}`);

      return appointmentId;
    } catch (error) {
      this.logger.error('Error scheduling dock appointment:', error);
      throw new Error(`Failed to schedule dock appointment: ${error.message}`);
    }
  }

  /**
   * Find available dock door for appointment
   * @param {string} timeSlot - Requested time slot
   * @returns {Promise<Object>} Available dock door
   */
  async findAvailableDockDoor(timeSlot) {
    try {
      // Get all dock doors
      const dockDoors = await this.dataServe.jsonFind('dock_doors', {
        predicate: `obj.status === 'active'`
      });

      // Check for conflicts with existing appointments
      const requestedTime = new Date(timeSlot);
      const bufferTime = 2 * 60 * 60 * 1000; // 2 hours buffer

      for (const dock of dockDoors) {
        const conflictingAppointments = await this.dataServe.jsonFind('dock_appointments', {
          predicate: `obj.dockDoor === '${dock.door}' && obj.status !== 'cancelled'`
        });

        const hasConflict = conflictingAppointments.some(appointment => {
          const appointmentTime = new Date(appointment.scheduledTime);
          const timeDiff = Math.abs(appointmentTime - requestedTime);
          return timeDiff < bufferTime;
        });

        if (!hasConflict) {
          return dock;
        }
      }

      throw new Error('No available dock doors for the requested time slot');
    } catch (error) {
      this.logger.error('Error finding available dock door:', error);
      throw error;
    }
  }

  // =================== RECEIVING PROCESS ===================

  /**
   * Start receiving process for a delivery
   * @param {Object} receivingData - Receiving data
   * @returns {Promise<string>} Receipt UUID
   */
  async startReceiving(receivingData) {
    try {
      const receipt = {
        id: receivingData.id || uuidv4(),
        poNumber: receivingData.poNumber,
        asnNumber: receivingData.asnNumber,
        receivedBy: receivingData.receivedBy,
        dockDoor: receivingData.dockDoor,
        receivingMode: receivingData.receivingMode || 'standard', // standard, cross_dock, bulk
        items: [],
        status: 'in_progress', // in_progress, completed, discrepancy
        startTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const receiptId = await this.dataServe.add('receipts', receipt);

      // Create receiving tasks for each expected item
      if (receivingData.expectedItems) {
        for (const item of receivingData.expectedItems) {
          await this.createReceivingTask(receiptId, item);
        }
      }

      this.eventEmitter.emit('receiving.started', { receiptId, receipt });
      this.logger.info(`Receiving started: ${receipt.poNumber} at dock ${receipt.dockDoor}`);

      return receiptId;
    } catch (error) {
      this.logger.error('Error starting receiving:', error);
      throw new Error(`Failed to start receiving: ${error.message}`);
    }
  }

  /**
   * Create a receiving task for an item
   * @param {string} receiptId - Receipt ID
   * @param {Object} item - Item to receive
   * @returns {Promise<string>} Task UUID
   */
  async createReceivingTask(receiptId, item) {
    try {
      const task = {
        id: uuidv4(),
        receiptId,
        type: 'receive_item',
        productSku: item.productSku,
        expectedQuantity: item.expectedQuantity,
        receivedQuantity: 0,
        status: 'pending', // pending, in_progress, completed, exception
        assignedTo: null,
        priority: item.priority || 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const taskId = await this.dataServe.add('receiving_tasks', task);

      // Add to work queue
      await this.queue.push('receiving_queue', {
        taskId,
        type: 'receive_item',
        priority: task.priority,
        productSku: item.productSku,
        receiptId
      });

      this.eventEmitter.emit('receiving.task.created', { taskId, task });

      return taskId;
    } catch (error) {
      this.logger.error('Error creating receiving task:', error);
      throw error;
    }
  }

  /**
   * Process received item
   * @param {Object} receivedItem - Received item data
   * @returns {Promise<Object>} Processing result
   */
  async processReceivedItem(receivedItem) {
    try {
      const result = {
        productSku: receivedItem.productSku,
        receivedQuantity: receivedItem.receivedQuantity,
        expectedQuantity: receivedItem.expectedQuantity,
        discrepancy: receivedItem.receivedQuantity - receivedItem.expectedQuantity,
        qualityCheck: receivedItem.qualityCheck || 'pending',
        damageReport: receivedItem.damageReport || null,
        lotNumber: receivedItem.lotNumber || null,
        expiryDate: receivedItem.expiryDate || null,
        processedAt: new Date().toISOString()
      };

      // Update receiving task
      const tasks = await this.dataServe.jsonFind('receiving_tasks', {
        predicate: `obj.receiptId === '${receivedItem.receiptId}' && obj.productSku === '${receivedItem.productSku}'`
      });

      if (tasks.length > 0) {
        const task = tasks[0];
        const updatedTask = {
          ...task,
          receivedQuantity: receivedItem.receivedQuantity,
          status: 'completed',
          updatedAt: new Date().toISOString()
        };

        // Find and update task
        const allTasks = await this.dataServe.list('receiving_tasks');
        const taskEntry = allTasks.find(entry => entry.data.id === task.id);
        if (taskEntry) {
          await this.dataServe.add('receiving_tasks', updatedTask, taskEntry.id);
        }
      }

      // Handle discrepancies
      if (result.discrepancy !== 0) {
        await this.handleReceivingDiscrepancy(receivedItem.receiptId, result);
      }

      // Create lot if lot tracking is enabled
      if (receivedItem.lotNumber) {
        await this.createReceivingLot(receivedItem);
      }

      // Generate put-away tasks if quality check passed
      if (result.qualityCheck === 'passed' || result.qualityCheck === 'pending') {
        await this.generatePutAwayTasks(receivedItem);
      }

      this.eventEmitter.emit('item.received', { receivedItem, result });
      this.logger.info(`Item received: ${result.receivedQuantity} units of ${result.productSku}`);

      return result;
    } catch (error) {
      this.logger.error('Error processing received item:', error);
      throw new Error(`Failed to process received item: ${error.message}`);
    }
  }

  /**
   * Handle receiving discrepancy
   * @param {string} receiptId - Receipt ID
   * @param {Object} discrepancyData - Discrepancy information
   * @returns {Promise<string>} Discrepancy report UUID
   */
  async handleReceivingDiscrepancy(receiptId, discrepancyData) {
    try {
      const discrepancyReport = {
        id: uuidv4(),
        receiptId,
        productSku: discrepancyData.productSku,
        expectedQuantity: discrepancyData.expectedQuantity,
        receivedQuantity: discrepancyData.receivedQuantity,
        discrepancy: discrepancyData.discrepancy,
        type: discrepancyData.discrepancy > 0 ? 'overage' : 'shortage',
        status: 'open', // open, investigating, resolved
        reportedBy: discrepancyData.reportedBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const reportId = await this.dataServe.add('discrepancy_reports', discrepancyReport);

      // Queue for investigation
      await this.queue.push('discrepancy_queue', {
        reportId,
        type: 'investigate_discrepancy',
        priority: 'high'
      });

      this.eventEmitter.emit('discrepancy.reported', { reportId, discrepancyReport });
      this.logger.warn(`Receiving discrepancy: ${discrepancyData.discrepancy} units of ${discrepancyData.productSku}`);

      return reportId;
    } catch (error) {
      this.logger.error('Error handling receiving discrepancy:', error);
      throw error;
    }
  }

  // =================== PUT-AWAY OPERATIONS ===================

  /**
   * Generate put-away tasks for received items
   * @param {Object} receivedItem - Received item data
   * @returns {Promise<Array>} Put-away task IDs
   */
  async generatePutAwayTasks(receivedItem) {
    try {
      // Get available locations using inventory module
      const inventoryModule = this.services.modules?.inventory;
      if (!inventoryModule) {
        throw new Error('Inventory module not available');
      }

      const availableLocations = await inventoryModule.getAvailableLocations(
        receivedItem.productSku,
        'storage'
      );

      if (availableLocations.length === 0) {
        throw new Error(`No available storage locations for ${receivedItem.productSku}`);
      }

      // Apply put-away strategy
      const optimalLocation = await this.applyPutAwayStrategy(
        receivedItem.productSku,
        availableLocations,
        receivedItem.receivedQuantity
      );

      const putAwayTask = {
        id: uuidv4(),
        receiptId: receivedItem.receiptId,
        productSku: receivedItem.productSku,
        quantity: receivedItem.receivedQuantity,
        fromLocation: receivedItem.stagingLocation || 'RECEIVING',
        toLocation: optimalLocation.code,
        strategy: 'optimal_placement',
        status: 'pending', // pending, assigned, in_progress, completed
        priority: receivedItem.priority || 'normal',
        assignedTo: null,
        estimatedTime: this.calculatePutAwayTime(receivedItem.stagingLocation, optimalLocation.code),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const taskId = await this.dataServe.add('putaway_tasks', putAwayTask);

      // Add to put-away queue
      await this.queue.push('putaway_queue', {
        taskId,
        type: 'putaway',
        priority: putAwayTask.priority,
        fromLocation: putAwayTask.fromLocation,
        toLocation: putAwayTask.toLocation,
        productSku: receivedItem.productSku,
        quantity: receivedItem.receivedQuantity
      });

      this.eventEmitter.emit('putaway.task.created', { taskId, putAwayTask });
      this.logger.info(`Put-away task created: ${receivedItem.productSku} to ${optimalLocation.code}`);

      return [taskId];
    } catch (error) {
      this.logger.error('Error generating put-away tasks:', error);
      throw new Error(`Failed to generate put-away tasks: ${error.message}`);
    }
  }

  /**
   * Apply put-away strategy to find optimal location
   * @param {string} productSku - Product SKU
   * @param {Array} availableLocations - Available locations
   * @param {number} quantity - Quantity to store
   * @returns {Promise<Object>} Optimal location
   */
  async applyPutAwayStrategy(productSku, availableLocations, quantity) {
    try {
      // Strategy: Prioritize by proximity to picking locations and capacity
      const scoredLocations = availableLocations.map(location => {
        let score = 0;

        // Prefer locations in forward pick zones
        if (location.type === 'picking') score += 100;
        else if (location.zone === 'forward_pick') score += 50;

        // Prefer locations with adequate capacity
        if (location.capacity.maxItems >= quantity) score += 20;

        // Prefer locations closer to shipping (simplified scoring)
        if (location.zone === 'shipping') score += 10;

        return { ...location, score };
      });

      // Sort by score (highest first)
      scoredLocations.sort((a, b) => b.score - a.score);

      return scoredLocations[0];
    } catch (error) {
      this.logger.error('Error applying put-away strategy:', error);
      throw error;
    }
  }

  /**
   * Calculate estimated put-away time
   * @param {string} fromLocation - Source location
   * @param {string} toLocation - Destination location
   * @returns {number} Estimated time in minutes
   */
  calculatePutAwayTime(fromLocation, toLocation) {
    // Simplified calculation - in reality this would use warehouse layout
    const baseTime = 5; // Base 5 minutes
    const travelTime = Math.floor(Math.random() * 10) + 1; // Random 1-10 minutes
    return baseTime + travelTime;
  }

  /**
   * Complete put-away task
   * @param {string} taskId - Task ID
   * @param {Object} completionData - Completion data
   * @returns {Promise<Object>} Completion result
   */
  async completePutAwayTask(taskId, completionData) {
    try {
      // Get task details
      const tasks = await this.dataServe.jsonFind('putaway_tasks', {
        predicate: `obj.id === '${taskId}'`
      });

      if (tasks.length === 0) {
        throw new Error(`Put-away task not found: ${taskId}`);
      }

      const task = tasks[0];

      // Update task status
      const updatedTask = {
        ...task,
        status: 'completed',
        completedBy: completionData.completedBy,
        actualTime: completionData.actualTime,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Find and update task
      const allTasks = await this.dataServe.list('putaway_tasks');
      const taskEntry = allTasks.find(entry => entry.data.id === taskId);
      if (taskEntry) {
        await this.dataServe.add('putaway_tasks', updatedTask, taskEntry.id);
      }

      // Update inventory using inventory module
      const inventoryModule = this.services.modules?.inventory;
      if (inventoryModule) {
        await inventoryModule.adjustInventory(
          task.productSku,
          task.toLocation,
          task.quantity,
          `Put-away completed from ${task.fromLocation}`
        );
      }

      this.eventEmitter.emit('putaway.completed', { taskId, task: updatedTask });
      this.logger.info(`Put-away completed: ${task.productSku} to ${task.toLocation}`);

      return updatedTask;
    } catch (error) {
      this.logger.error('Error completing put-away task:', error);
      throw new Error(`Failed to complete put-away task: ${error.message}`);
    }
  }

  /**
   * Create receiving lot for lot-tracked items
   * @param {Object} receivedItem - Received item with lot information
   * @returns {Promise<string>} Lot UUID
   */
  async createReceivingLot(receivedItem) {
    try {
      const inventoryModule = this.services.modules?.inventory;
      if (!inventoryModule) {
        throw new Error('Inventory module not available for lot creation');
      }

      const lotData = {
        lotNumber: receivedItem.lotNumber,
        batchNumber: receivedItem.batchNumber,
        productSku: receivedItem.productSku,
        quantity: receivedItem.receivedQuantity,
        manufacturingDate: receivedItem.manufacturingDate,
        expiryDate: receivedItem.expiryDate,
        supplierInfo: receivedItem.supplierInfo || {},
        qualityStatus: receivedItem.qualityCheck === 'passed' ? 'approved' : 'pending'
      };

      const lotId = await inventoryModule.createLot(lotData);
      this.logger.info(`Receiving lot created: ${receivedItem.lotNumber} for ${receivedItem.productSku}`);

      return lotId;
    } catch (error) {
      this.logger.error('Error creating receiving lot:', error);
      throw error;
    }
  }
}

module.exports = InboundModule;