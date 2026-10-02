/**
 * @fileoverview Outbound Operations Module
 *
 * Handles all outbound warehouse operations including:
 * - Order Processing and Validation
 * - Wave Planning and Management
 * - Picking Operations
 * - Packing and Shipping
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

class OutboundModule {
  constructor(services, eventEmitter) {
    this.services = services;
    this.eventEmitter = eventEmitter;
    this.logger = services.logger;
    this.dataServe = services.dataServe;
    this.cache = services.cache;
    this.queue = services.queue;
    this.workflow = services.workflow;
  }

  // =================== ORDER MANAGEMENT ===================

  /**
   * Create a new outbound order
   * @param {Object} orderData - Order data
   * @returns {Promise<string>} Order UUID
   */
  async createOrder(orderData) {
    try {
      const order = {
        id: orderData.id || uuidv4(),
        orderNumber: orderData.orderNumber,
        customer: {
          id: orderData.customer.id,
          name: orderData.customer.name,
          address: orderData.customer.address,
          contact: orderData.customer.contact
        },
        orderDate: orderData.orderDate || new Date().toISOString(),
        requiredDate: orderData.requiredDate,
        priority: orderData.priority || 'normal', // low, normal, high, urgent
        items: orderData.items.map(item => ({
          id: uuidv4(),
          productSku: item.productSku,
          description: item.description,
          orderedQuantity: item.orderedQuantity,
          allocatedQuantity: 0,
          pickedQuantity: 0,
          packedQuantity: 0,
          unitPrice: item.unitPrice,
          totalPrice: item.orderedQuantity * item.unitPrice
        })),
        shippingMethod: orderData.shippingMethod,
        carrier: orderData.carrier,
        status: 'pending', // pending, validated, allocated, released, picking, picked, packed, shipped, delivered, cancelled
        totalValue: orderData.items.reduce((sum, item) => sum + (item.orderedQuantity * item.unitPrice), 0),
        specialInstructions: orderData.specialInstructions || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const orderId = await this.dataServe.add('orders', order);

      // Queue for validation
      await this.queue.push('order_validation_queue', {
        orderId,
        type: 'validate_order',
        priority: order.priority
      });

      this.eventEmitter.emit('order.created', { orderId, order });
      this.logger.info(`Order created: ${order.orderNumber} (${orderId})`);

      return orderId;
    } catch (error) {
      this.logger.error('Error creating order:', error);
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  /**
   * Validate order for inventory availability and business rules
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Validation result
   */
  async validateOrder(orderId) {
    try {
      // Get order details
      const orders = await this.dataServe.jsonFind('orders', {
        predicate: `obj.id === '${orderId}'`
      });

      if (orders.length === 0) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const order = orders[0];
      const validationResult = {
        orderId,
        isValid: true,
        issues: [],
        availabilityCheck: []
      };

      // Check inventory availability for each item
      const inventoryModule = this.services.modules?.inventory;
      if (!inventoryModule) {
        throw new Error('Inventory module not available');
      }

      for (const item of order.items) {
        const inventory = await inventoryModule.getInventory(item.productSku);

        const availability = {
          productSku: item.productSku,
          orderedQuantity: item.orderedQuantity,
          availableQuantity: inventory.availableQuantity,
          sufficient: inventory.availableQuantity >= item.orderedQuantity
        };

        validationResult.availabilityCheck.push(availability);

        if (!availability.sufficient) {
          validationResult.isValid = false;
          validationResult.issues.push({
            type: 'insufficient_inventory',
            productSku: item.productSku,
            shortfall: item.orderedQuantity - inventory.availableQuantity
          });
        }
      }

      // Business rule validations
      if (order.requiredDate && new Date(order.requiredDate) < new Date()) {
        validationResult.isValid = false;
        validationResult.issues.push({
          type: 'past_required_date',
          message: 'Required date is in the past'
        });
      }

      // Update order status
      const updatedOrder = {
        ...order,
        status: validationResult.isValid ? 'validated' : 'validation_failed',
        validationResult,
        updatedAt: new Date().toISOString()
      };

      // Find and update order
      const allOrders = await this.dataServe.list('orders');
      const orderEntry = allOrders.find(entry => entry.data.id === orderId);
      if (orderEntry) {
        await this.dataServe.add('orders', updatedOrder, orderEntry.id);
      }

      if (validationResult.isValid) {
        // Queue for allocation
        await this.queue.push('order_allocation_queue', {
          orderId,
          type: 'allocate_order',
          priority: order.priority
        });
      }

      this.eventEmitter.emit('order.validated', { orderId, validationResult });
      this.logger.info(`Order validated: ${order.orderNumber} - ${validationResult.isValid ? 'PASSED' : 'FAILED'}`);

      return validationResult;
    } catch (error) {
      this.logger.error('Error validating order:', error);
      throw new Error(`Failed to validate order: ${error.message}`);
    }
  }

  /**
   * Allocate inventory for validated order
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Allocation result
   */
  async allocateOrder(orderId) {
    try {
      const orders = await this.dataServe.jsonFind('orders', {
        predicate: `obj.id === '${orderId}'`
      });

      if (orders.length === 0) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const order = orders[0];
      const allocationResult = {
        orderId,
        allocations: [],
        fullyAllocated: true
      };

      const inventoryModule = this.services.modules?.inventory;
      if (!inventoryModule) {
        throw new Error('Inventory module not available');
      }

      // Allocate inventory for each item
      for (const item of order.items) {
        try {
          const allocations = await inventoryModule.allocateInventory(
            item.productSku,
            item.orderedQuantity,
            orderId
          );

          const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.quantity, 0);

          // Update item allocation
          item.allocatedQuantity = totalAllocated;
          allocationResult.allocations.push({
            productSku: item.productSku,
            orderedQuantity: item.orderedQuantity,
            allocatedQuantity: totalAllocated,
            allocations
          });

          if (totalAllocated < item.orderedQuantity) {
            allocationResult.fullyAllocated = false;
          }
        } catch (error) {
          this.logger.warn(`Failed to allocate ${item.productSku}: ${error.message}`);
          allocationResult.fullyAllocated = false;
          allocationResult.allocations.push({
            productSku: item.productSku,
            orderedQuantity: item.orderedQuantity,
            allocatedQuantity: 0,
            error: error.message
          });
        }
      }

      // Update order status
      const updatedOrder = {
        ...order,
        status: allocationResult.fullyAllocated ? 'allocated' : 'partially_allocated',
        allocationResult,
        updatedAt: new Date().toISOString()
      };

      // Find and update order
      const allOrders = await this.dataServe.list('orders');
      const orderEntry = allOrders.find(entry => entry.data.id === orderId);
      if (orderEntry) {
        await this.dataServe.add('orders', updatedOrder, orderEntry.id);
      }

      this.eventEmitter.emit('order.allocated', { orderId, allocationResult });
      this.logger.info(`Order allocated: ${order.orderNumber} - ${allocationResult.fullyAllocated ? 'FULL' : 'PARTIAL'}`);

      return allocationResult;
    } catch (error) {
      this.logger.error('Error allocating order:', error);
      throw new Error(`Failed to allocate order: ${error.message}`);
    }
  }

  // =================== WAVE MANAGEMENT ===================

  /**
   * Create a new wave for order fulfillment
   * @param {Object} waveData - Wave configuration
   * @returns {Promise<string>} Wave UUID
   */
  async createWave(waveData) {
    try {
      const wave = {
        id: waveData.id || uuidv4(),
        waveNumber: waveData.waveNumber || `WAVE-${Date.now()}`,
        type: waveData.type || 'standard', // standard, priority, bulk, consolidation
        strategy: waveData.strategy || 'zone_based', // zone_based, product_based, route_based
        targetShipDate: waveData.targetShipDate,
        cutoffTime: waveData.cutoffTime,
        orders: [],
        status: 'planning', // planning, released, picking, completed, cancelled
        metrics: {
          totalOrders: 0,
          totalLines: 0,
          totalUnits: 0,
          estimatedPickTime: 0
        },
        createdBy: waveData.createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const waveId = await this.dataServe.add('waves', wave);

      this.eventEmitter.emit('wave.created', { waveId, wave });
      this.logger.info(`Wave created: ${wave.waveNumber} (${waveId})`);

      return waveId;
    } catch (error) {
      this.logger.error('Error creating wave:', error);
      throw new Error(`Failed to create wave: ${error.message}`);
    }
  }

  /**
   * Add orders to wave based on criteria
   * @param {string} waveId - Wave ID
   * @param {Object} criteria - Selection criteria
   * @returns {Promise<Object>} Wave planning result
   */
  async planWave(waveId, criteria) {
    try {
      // Get wave details
      const waves = await this.dataServe.jsonFind('waves', {
        predicate: `obj.id === '${waveId}'`
      });

      if (waves.length === 0) {
        throw new Error(`Wave not found: ${waveId}`);
      }

      const wave = waves[0];

      // Find eligible orders
      let orderPredicate = `obj.status === 'allocated'`;

      if (criteria.priority) {
        orderPredicate += ` && obj.priority === '${criteria.priority}'`;
      }

      if (criteria.carrier) {
        orderPredicate += ` && obj.carrier === '${criteria.carrier}'`;
      }

      if (criteria.maxOrders) {
        // Will limit after retrieval
      }

      const eligibleOrders = await this.dataServe.jsonFind('orders', { predicate: orderPredicate });

      // Apply wave strategy
      const selectedOrders = await this.applyWaveStrategy(wave.strategy, eligibleOrders, criteria);

      // Update wave with selected orders
      const updatedWave = {
        ...wave,
        orders: selectedOrders.map(order => ({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customer: order.customer.name,
          priority: order.priority,
          lineCount: order.items.length,
          unitCount: order.items.reduce((sum, item) => sum + item.orderedQuantity, 0)
        })),
        metrics: {
          totalOrders: selectedOrders.length,
          totalLines: selectedOrders.reduce((sum, order) => sum + order.items.length, 0),
          totalUnits: selectedOrders.reduce((sum, order) =>
            sum + order.items.reduce((itemSum, item) => itemSum + item.orderedQuantity, 0), 0),
          estimatedPickTime: this.calculateEstimatedPickTime(selectedOrders)
        },
        updatedAt: new Date().toISOString()
      };

      // Find and update wave
      const allWaves = await this.dataServe.list('waves');
      const waveEntry = allWaves.find(entry => entry.data.id === waveId);
      if (waveEntry) {
        await this.dataServe.add('waves', updatedWave, waveEntry.id);
      }

      // Update order statuses
      for (const order of selectedOrders) {
        const updatedOrder = {
          ...order,
          status: 'released',
          waveId,
          waveNumber: wave.waveNumber,
          updatedAt: new Date().toISOString()
        };

        const allOrders = await this.dataServe.list('orders');
        const orderEntry = allOrders.find(entry => entry.data.id === order.id);
        if (orderEntry) {
          await this.dataServe.add('orders', updatedOrder, orderEntry.id);
        }
      }

      const planningResult = {
        waveId,
        selectedOrders: selectedOrders.length,
        metrics: updatedWave.metrics
      };

      this.eventEmitter.emit('wave.planned', { waveId, planningResult });
      this.logger.info(`Wave planned: ${wave.waveNumber} with ${selectedOrders.length} orders`);

      return planningResult;
    } catch (error) {
      this.logger.error('Error planning wave:', error);
      throw new Error(`Failed to plan wave: ${error.message}`);
    }
  }

  /**
   * Apply wave strategy to select orders
   * @param {string} strategy - Wave strategy
   * @param {Array} orders - Available orders
   * @param {Object} criteria - Selection criteria
   * @returns {Promise<Array>} Selected orders
   */
  async applyWaveStrategy(strategy, orders, criteria) {
    try {
      let selectedOrders = [...orders];

      switch (strategy) {
        case 'zone_based':
          // Group by shipping zones and prioritize
          selectedOrders = this.groupByZone(selectedOrders);
          break;

        case 'product_based':
          // Group by common products for pick efficiency
          selectedOrders = this.groupByProduct(selectedOrders);
          break;

        case 'route_based':
          // Group by delivery routes
          selectedOrders = this.groupByRoute(selectedOrders);
          break;

        default:
          // Standard: FIFO with priority consideration
          selectedOrders.sort((a, b) => {
            const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(a.orderDate) - new Date(b.orderDate);
          });
      }

      // Apply limits
      if (criteria.maxOrders && selectedOrders.length > criteria.maxOrders) {
        selectedOrders = selectedOrders.slice(0, criteria.maxOrders);
      }

      return selectedOrders;
    } catch (error) {
      this.logger.error('Error applying wave strategy:', error);
      throw error;
    }
  }

  /**
   * Group orders by shipping zone
   * @param {Array} orders - Orders to group
   * @returns {Array} Grouped orders
   */
  groupByZone(orders) {
    // Simplified zone grouping - in reality would use postal codes or regions
    return orders.sort((a, b) => {
      const zoneA = a.customer.address.postalCode || 'ZZZ';
      const zoneB = b.customer.address.postalCode || 'ZZZ';
      return zoneA.localeCompare(zoneB);
    });
  }

  /**
   * Group orders by common products
   * @param {Array} orders - Orders to group
   * @returns {Array} Grouped orders
   */
  groupByProduct(orders) {
    // Score orders by product overlap
    const productCounts = {};

    // Count product frequency
    orders.forEach(order => {
      order.items.forEach(item => {
        productCounts[item.productSku] = (productCounts[item.productSku] || 0) + 1;
      });
    });

    // Score orders by common products
    const scoredOrders = orders.map(order => {
      const score = order.items.reduce((sum, item) => {
        return sum + (productCounts[item.productSku] || 0);
      }, 0);
      return { ...order, productScore: score };
    });

    return scoredOrders.sort((a, b) => b.productScore - a.productScore);
  }

  /**
   * Group orders by delivery route
   * @param {Array} orders - Orders to group
   * @returns {Array} Grouped orders
   */
  groupByRoute(orders) {
    // Simplified route grouping by carrier and region
    return orders.sort((a, b) => {
      if (a.carrier !== b.carrier) {
        return a.carrier.localeCompare(b.carrier);
      }
      const regionA = a.customer.address.state || 'ZZ';
      const regionB = b.customer.address.state || 'ZZ';
      return regionA.localeCompare(regionB);
    });
  }

  /**
   * Calculate estimated pick time for wave
   * @param {Array} orders - Orders in wave
   * @returns {number} Estimated time in minutes
   */
  calculateEstimatedPickTime(orders) {
    const totalUnits = orders.reduce((sum, order) =>
      sum + order.items.reduce((itemSum, item) => itemSum + item.orderedQuantity, 0), 0);

    const uniqueProducts = new Set();
    orders.forEach(order => {
      order.items.forEach(item => uniqueProducts.add(item.productSku));
    });

    // Simplified calculation: 30 seconds per unit + 2 minutes per unique product
    const unitTime = totalUnits * 0.5; // 30 seconds = 0.5 minutes
    const productTime = uniqueProducts.size * 2;

    return Math.ceil(unitTime + productTime);
  }

  // =================== PICKING OPERATIONS ===================

  /**
   * Generate pick tasks for a wave
   * @param {string} waveId - Wave ID
   * @returns {Promise<Array>} Pick task IDs
   */
  async generatePickTasks(waveId) {
    try {
      const waves = await this.dataServe.jsonFind('waves', {
        predicate: `obj.id === '${waveId}'`
      });

      if (waves.length === 0) {
        throw new Error(`Wave not found: ${waveId}`);
      }

      const wave = waves[0];
      const pickTasks = [];

      // Get detailed order information
      for (const waveOrder of wave.orders) {
        const orders = await this.dataServe.jsonFind('orders', {
          predicate: `obj.id === '${waveOrder.orderId}'`
        });

        if (orders.length === 0) continue;

        const order = orders[0];

        // Create pick tasks for each item
        for (const item of order.items) {
          if (item.allocatedQuantity > 0) {
            // Get allocation details to determine pick locations
            const allocations = await this.dataServe.jsonFind('allocations', {
              predicate: `obj.orderId === '${order.id}' && obj.productSku === '${item.productSku}'`
            });

            for (const allocation of allocations) {
              const pickTask = {
                id: uuidv4(),
                waveId,
                orderId: order.id,
                orderNumber: order.orderNumber,
                allocationId: allocation.id,
                productSku: item.productSku,
                description: item.description,
                pickLocation: allocation.locationCode,
                quantityToPick: allocation.quantity,
                quantityPicked: 0,
                status: 'pending', // pending, assigned, in_progress, completed, exception
                priority: order.priority,
                assignedTo: null,
                pickPath: null,
                estimatedTime: 3, // 3 minutes per pick task
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };

              const taskId = await this.dataServe.add('picks', pickTask);
              pickTasks.push(taskId);

              // Add to pick queue
              await this.queue.push('picking_queue', {
                taskId,
                type: 'pick',
                priority: pickTask.priority,
                location: pickTask.pickLocation,
                productSku: item.productSku,
                quantity: allocation.quantity
              });
            }
          }
        }
      }

      // Update wave status
      const updatedWave = {
        ...wave,
        status: 'picking',
        pickTasks: pickTasks.length,
        updatedAt: new Date().toISOString()
      };

      const allWaves = await this.dataServe.list('waves');
      const waveEntry = allWaves.find(entry => entry.data.id === waveId);
      if (waveEntry) {
        await this.dataServe.add('waves', updatedWave, waveEntry.id);
      }

      this.eventEmitter.emit('pick.tasks.generated', { waveId, taskCount: pickTasks.length });
      this.logger.info(`Generated ${pickTasks.length} pick tasks for wave ${wave.waveNumber}`);

      return pickTasks;
    } catch (error) {
      this.logger.error('Error generating pick tasks:', error);
      throw new Error(`Failed to generate pick tasks: ${error.message}`);
    }
  }

  /**
   * Optimize pick path for a picker
   * @param {Array} pickTasks - Pick tasks to optimize
   * @returns {Array} Optimized pick tasks
   */
  async optimizePickPath(pickTasks) {
    try {
      // Simplified pick path optimization
      // In reality, this would use warehouse layout and routing algorithms

      // Group by location zones
      const locationGroups = {};
      pickTasks.forEach(task => {
        const zone = task.pickLocation.split('-')[0] || 'DEFAULT';
        if (!locationGroups[zone]) {
          locationGroups[zone] = [];
        }
        locationGroups[zone].push(task);
      });

      // Optimize within each zone (sort by aisle/bay)
      const optimizedTasks = [];
      Object.keys(locationGroups).sort().forEach(zone => {
        const zoneTasks = locationGroups[zone].sort((a, b) =>
          a.pickLocation.localeCompare(b.pickLocation)
        );
        optimizedTasks.push(...zoneTasks);
      });

      // Assign sequence numbers
      optimizedTasks.forEach((task, index) => {
        task.pickSequence = index + 1;
      });

      this.logger.info(`Optimized pick path for ${optimizedTasks.length} tasks`);
      return optimizedTasks;
    } catch (error) {
      this.logger.error('Error optimizing pick path:', error);
      throw error;
    }
  }

  /**
   * Complete a pick task
   * @param {string} taskId - Pick task ID
   * @param {Object} pickData - Pick completion data
   * @returns {Promise<Object>} Completion result
   */
  async completePickTask(taskId, pickData) {
    try {
      const tasks = await this.dataServe.jsonFind('picks', {
        predicate: `obj.id === '${taskId}'`
      });

      if (tasks.length === 0) {
        throw new Error(`Pick task not found: ${taskId}`);
      }

      const task = tasks[0];

      // Validate pick quantity
      if (pickData.quantityPicked > task.quantityToPick) {
        throw new Error('Picked quantity exceeds required quantity');
      }

      // Update task
      const updatedTask = {
        ...task,
        quantityPicked: pickData.quantityPicked,
        status: pickData.quantityPicked === task.quantityToPick ? 'completed' : 'exception',
        pickedBy: pickData.pickedBy,
        pickTime: pickData.pickTime,
        notes: pickData.notes || '',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Find and update task
      const allTasks = await this.dataServe.list('picks');
      const taskEntry = allTasks.find(entry => entry.data.id === taskId);
      if (taskEntry) {
        await this.dataServe.add('picks', updatedTask, taskEntry.id);
      }

      // Update order item picked quantity
      await this.updateOrderPickProgress(task.orderId, task.productSku, pickData.quantityPicked);

      // Handle exceptions
      if (pickData.quantityPicked < task.quantityToPick) {
        await this.handlePickException(taskId, {
          shortfall: task.quantityToPick - pickData.quantityPicked,
          reason: pickData.exceptionReason || 'quantity_shortage'
        });
      }

      this.eventEmitter.emit('pick.completed', { taskId, task: updatedTask });
      this.logger.info(`Pick completed: ${task.productSku} from ${task.pickLocation} (${pickData.quantityPicked}/${task.quantityToPick})`);

      return updatedTask;
    } catch (error) {
      this.logger.error('Error completing pick task:', error);
      throw new Error(`Failed to complete pick task: ${error.message}`);
    }
  }

  /**
   * Update order pick progress
   * @param {string} orderId - Order ID
   * @param {string} productSku - Product SKU
   * @param {number} pickedQuantity - Quantity picked
   * @returns {Promise<void>}
   */
  async updateOrderPickProgress(orderId, productSku, pickedQuantity) {
    try {
      const orders = await this.dataServe.jsonFind('orders', {
        predicate: `obj.id === '${orderId}'`
      });

      if (orders.length === 0) return;

      const order = orders[0];
      const item = order.items.find(item => item.productSku === productSku);

      if (item) {
        item.pickedQuantity = (item.pickedQuantity || 0) + pickedQuantity;

        // Check if order is fully picked
        const fullyPicked = order.items.every(item =>
          item.pickedQuantity >= item.allocatedQuantity
        );

        const updatedOrder = {
          ...order,
          status: fullyPicked ? 'picked' : 'picking',
          updatedAt: new Date().toISOString()
        };

        // Find and update order
        const allOrders = await this.dataServe.list('orders');
        const orderEntry = allOrders.find(entry => entry.data.id === orderId);
        if (orderEntry) {
          await this.dataServe.add('orders', updatedOrder, orderEntry.id);
        }

        if (fullyPicked) {
          // Queue for packing
          await this.queue.push('packing_queue', {
            orderId,
            type: 'pack_order',
            priority: order.priority
          });
        }
      }
    } catch (error) {
      this.logger.error('Error updating order pick progress:', error);
      throw error;
    }
  }

  /**
   * Handle pick exception
   * @param {string} taskId - Pick task ID
   * @param {Object} exceptionData - Exception details
   * @returns {Promise<string>} Exception report UUID
   */
  async handlePickException(taskId, exceptionData) {
    try {
      const exception = {
        id: uuidv4(),
        taskId,
        type: 'pick_exception',
        reason: exceptionData.reason,
        shortfall: exceptionData.shortfall,
        status: 'open', // open, investigating, resolved
        reportedBy: exceptionData.reportedBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const exceptionId = await this.dataServe.add('pick_exceptions', exception);

      // Queue for investigation
      await this.queue.push('exception_queue', {
        exceptionId,
        type: 'investigate_pick_exception',
        priority: 'high'
      });

      this.eventEmitter.emit('pick.exception', { exceptionId, exception });
      this.logger.warn(`Pick exception: ${exceptionData.reason} - shortfall: ${exceptionData.shortfall}`);

      return exceptionId;
    } catch (error) {
      this.logger.error('Error handling pick exception:', error);
      throw error;
    }
  }

  // =================== PACKING OPERATIONS ===================

  /**
   * Create packing slip for order
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Packing slip
   */
  async createPackingSlip(orderId) {
    try {
      const orders = await this.dataServe.jsonFind('orders', {
        predicate: `obj.id === '${orderId}'`
      });

      if (orders.length === 0) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const order = orders[0];

      const packingSlip = {
        id: uuidv4(),
        orderId,
        orderNumber: order.orderNumber,
        customer: order.customer,
        items: order.items.map(item => ({
          productSku: item.productSku,
          description: item.description,
          orderedQuantity: item.orderedQuantity,
          pickedQuantity: item.pickedQuantity || 0,
          toPackQuantity: Math.min(item.orderedQuantity, item.pickedQuantity || 0)
        })),
        shippingMethod: order.shippingMethod,
        carrier: order.carrier,
        specialInstructions: order.specialInstructions,
        createdAt: new Date().toISOString()
      };

      const packingSlipId = await this.dataServe.add('packing_slips', packingSlip);

      this.eventEmitter.emit('packing.slip.created', { packingSlipId, packingSlip });
      this.logger.info(`Packing slip created for order ${order.orderNumber}`);

      return packingSlip;
    } catch (error) {
      this.logger.error('Error creating packing slip:', error);
      throw new Error(`Failed to create packing slip: ${error.message}`);
    }
  }

  /**
   * Complete packing for order
   * @param {string} orderId - Order ID
   * @param {Object} packingData - Packing completion data
   * @returns {Promise<Object>} Packing result
   */
  async completePackingOrder(orderId, packingData) {
    try {
      const orders = await this.dataServe.jsonFind('orders', {
        predicate: `obj.id === '${orderId}'`
      });

      if (orders.length === 0) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const order = orders[0];

      // Update order with packing information
      const updatedOrder = {
        ...order,
        status: 'packed',
        packingInfo: {
          packedBy: packingData.packedBy,
          packingDate: new Date().toISOString(),
          packages: packingData.packages || [],
          totalWeight: packingData.totalWeight || 0,
          totalDimensions: packingData.totalDimensions || {},
          trackingNumber: packingData.trackingNumber
        },
        updatedAt: new Date().toISOString()
      };

      // Update packed quantities
      if (packingData.packedItems) {
        packingData.packedItems.forEach(packedItem => {
          const orderItem = updatedOrder.items.find(item => item.productSku === packedItem.productSku);
          if (orderItem) {
            orderItem.packedQuantity = packedItem.packedQuantity;
          }
        });
      }

      // Find and update order
      const allOrders = await this.dataServe.list('orders');
      const orderEntry = allOrders.find(entry => entry.data.id === orderId);
      if (orderEntry) {
        await this.dataServe.add('orders', updatedOrder, orderEntry.id);
      }

      // Queue for shipping
      await this.queue.push('shipping_queue', {
        orderId,
        type: 'ship_order',
        priority: order.priority,
        carrier: order.carrier
      });

      this.eventEmitter.emit('packing.completed', { orderId, packingInfo: updatedOrder.packingInfo });
      this.logger.info(`Packing completed for order ${order.orderNumber}`);

      return updatedOrder.packingInfo;
    } catch (error) {
      this.logger.error('Error completing packing:', error);
      throw new Error(`Failed to complete packing: ${error.message}`);
    }
  }
}

module.exports = OutboundModule;