/**
 * @fileoverview Delivery and Fulfillment Module
 *
 * Handles all delivery and fulfillment operations including:
 * - Carrier Management and Integration
 * - Shipping Operations and Tracking
 * - Last-Mile Delivery Coordination
 * - Returns Processing
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

class DeliveryModule {
  constructor(services, eventEmitter) {
    this.services = services;
    this.eventEmitter = eventEmitter;
    this.logger = services.logger;
    this.dataServe = services.dataServe;
    this.cache = services.cache;
    this.queue = services.queue;
    this.workflow = services.workflow;
  }

  // =================== CARRIER MANAGEMENT ===================

  /**
   * Create a new carrier profile
   * @param {Object} carrierData - Carrier information
   * @returns {Promise<string>} Carrier UUID
   */
  async createCarrier(carrierData) {
    try {
      const carrier = {
        id: carrierData.id || uuidv4(),
        carrierId: carrierData.carrierId,
        name: carrierData.name,
        type: carrierData.type || 'standard', // standard, express, freight, local
        serviceAreas: carrierData.serviceAreas || [],
        capabilities: {
          tracking: carrierData.capabilities?.tracking || false,
          signatureRequired: carrierData.capabilities?.signatureRequired || false,
          insurance: carrierData.capabilities?.insurance || false,
          cod: carrierData.capabilities?.cod || false, // Cash on Delivery
          refrigerated: carrierData.capabilities?.refrigerated || false
        },
        serviceLevels: carrierData.serviceLevels || [], // overnight, 2-day, ground, etc.
        rateStructure: carrierData.rateStructure || {},
        apiCredentials: {
          endpoint: carrierData.apiCredentials?.endpoint || null,
          username: carrierData.apiCredentials?.username || null,
          password: carrierData.apiCredentials?.password || null, // Should be encrypted
          apiKey: carrierData.apiCredentials?.apiKey || null
        },
        contactInfo: {
          phone: carrierData.contactInfo?.phone,
          email: carrierData.contactInfo?.email,
          accountNumber: carrierData.contactInfo?.accountNumber
        },
        status: carrierData.status || 'active', // active, inactive, suspended
        performance: {
          onTimeDelivery: 95.0,
          damageRate: 0.5,
          lostRate: 0.1,
          averageTransitTime: 0
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const carrierId = await this.dataServe.add('carriers', carrier);

      // Cache carrier data for quick access
      await this.cache.put(`carrier:${carrier.carrierId}`, carrier);

      this.eventEmitter.emit('carrier.created', { carrierId, carrier });
      this.logger.info(`Carrier created: ${carrier.name} (${carrier.carrierId})`);

      return carrierId;
    } catch (error) {
      this.logger.error('Error creating carrier:', error);
      throw new Error(`Failed to create carrier: ${error.message}`);
    }
  }

  /**
   * Get optimal carrier for shipment
   * @param {Object} shipmentRequirements - Shipment requirements
   * @returns {Promise<Object>} Optimal carrier selection
   */
  async selectOptimalCarrier(shipmentRequirements) {
    try {
      const {
        origin,
        destination,
        weight,
        dimensions,
        value,
        serviceLevel,
        specialRequirements
      } = shipmentRequirements;

      // Get available carriers
      const carriers = await this.dataServe.jsonFind('carriers', {
        predicate: `obj.status === 'active'`
      });

      if (carriers.length === 0) {
        throw new Error('No active carriers available');
      }

      const carrierOptions = [];

      for (const carrier of carriers) {
        // Check service area coverage
        const servicesArea = this.checkServiceArea(carrier, origin, destination);
        if (!servicesArea) continue;

        // Check capabilities
        const meetsRequirements = this.checkCarrierCapabilities(carrier, specialRequirements);
        if (!meetsRequirements) continue;

        // Calculate estimated cost and transit time
        const quote = await this.calculateShippingQuote(carrier, shipmentRequirements);

        carrierOptions.push({
          carrierId: carrier.carrierId,
          name: carrier.name,
          serviceLevel: quote.serviceLevel,
          estimatedCost: quote.cost,
          estimatedTransitTime: quote.transitTime,
          deliveryDate: quote.deliveryDate,
          score: this.calculateCarrierScore(carrier, quote, shipmentRequirements)
        });
      }

      if (carrierOptions.length === 0) {
        throw new Error('No suitable carriers found for this shipment');
      }

      // Sort by score (highest first)
      carrierOptions.sort((a, b) => b.score - a.score);

      const result = {
        recommendedCarrier: carrierOptions[0],
        alternatives: carrierOptions.slice(1, 3), // Top 2 alternatives
        allOptions: carrierOptions
      };

      this.logger.info(`Carrier selection: ${result.recommendedCarrier.name} recommended`);
      return result;
    } catch (error) {
      this.logger.error('Error selecting optimal carrier:', error);
      throw new Error(`Failed to select carrier: ${error.message}`);
    }
  }

  /**
   * Check if carrier services the route
   * @param {Object} carrier - Carrier data
   * @param {Object} origin - Origin location
   * @param {Object} destination - Destination location
   * @returns {boolean} Service availability
   */
  checkServiceArea(carrier, origin, destination) {
    // Simplified check - in reality would use postal codes, zones, etc.
    if (carrier.serviceAreas.length === 0) return true; // Global carrier

    const destinationArea = destination.country || destination.state || destination.postalCode;
    return carrier.serviceAreas.some(area =>
      destinationArea.toLowerCase().includes(area.toLowerCase())
    );
  }

  /**
   * Check carrier capabilities against requirements
   * @param {Object} carrier - Carrier data
   * @param {Object} requirements - Special requirements
   * @returns {boolean} Capability match
   */
  checkCarrierCapabilities(carrier, requirements = {}) {
    if (requirements.signatureRequired && !carrier.capabilities.signatureRequired) return false;
    if (requirements.insurance && !carrier.capabilities.insurance) return false;
    if (requirements.refrigerated && !carrier.capabilities.refrigerated) return false;
    if (requirements.cod && !carrier.capabilities.cod) return false;

    return true;
  }

  /**
   * Calculate shipping quote for carrier
   * @param {Object} carrier - Carrier data
   * @param {Object} requirements - Shipment requirements
   * @returns {Promise<Object>} Shipping quote
   */
  async calculateShippingQuote(carrier, requirements) {
    try {
      // Simplified rate calculation - in reality would call carrier APIs
      const baseRate = carrier.rateStructure.baseRate || 10.00;
      const weightRate = carrier.rateStructure.weightRate || 1.50;
      const dimensionRate = carrier.rateStructure.dimensionRate || 0.10;

      const weight = requirements.weight || 1;
      const volume = (requirements.dimensions?.length || 12) *
                    (requirements.dimensions?.width || 12) *
                    (requirements.dimensions?.height || 12);

      let cost = baseRate + (weight * weightRate) + (volume * dimensionRate);

      // Service level adjustments
      const serviceLevelMultipliers = {
        'overnight': 3.0,
        'express': 2.0,
        '2-day': 1.5,
        'ground': 1.0
      };

      const requestedLevel = requirements.serviceLevel || 'ground';
      const multiplier = serviceLevelMultipliers[requestedLevel] || 1.0;
      cost *= multiplier;

      // Transit time calculation
      const baseTransitTime = {
        'overnight': 1,
        'express': 1,
        '2-day': 2,
        'ground': 5
      };

      const transitTime = baseTransitTime[requestedLevel] || 5;

      // Calculate delivery date
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + transitTime);

      return {
        serviceLevel: requestedLevel,
        cost: Math.round(cost * 100) / 100,
        transitTime,
        deliveryDate: deliveryDate.toISOString(),
        currency: 'USD'
      };
    } catch (error) {
      this.logger.error('Error calculating shipping quote:', error);
      throw error;
    }
  }

  /**
   * Calculate carrier score for selection
   * @param {Object} carrier - Carrier data
   * @param {Object} quote - Shipping quote
   * @param {Object} requirements - Shipment requirements
   * @returns {number} Carrier score
   */
  calculateCarrierScore(carrier, quote, requirements) {
    let score = 0;

    // Performance metrics (40% weight)
    score += carrier.performance.onTimeDelivery * 0.4;
    score += (100 - carrier.performance.damageRate) * 0.4;
    score += (100 - carrier.performance.lostRate) * 0.4;

    // Cost competitiveness (30% weight)
    const costScore = Math.max(0, 100 - (quote.cost / 50 * 100)); // Normalize cost
    score += costScore * 0.3;

    // Transit time (20% weight)
    const timeScore = Math.max(0, 100 - (quote.transitTime * 10));
    score += timeScore * 0.2;

    // Special requirements match (10% weight)
    const requirementScore = this.checkCarrierCapabilities(carrier, requirements) ? 100 : 0;
    score += requirementScore * 0.1;

    return Math.round(score);
  }

  // =================== SHIPPING OPERATIONS ===================

  /**
   * Create shipment for order
   * @param {Object} shipmentData - Shipment data
   * @returns {Promise<string>} Shipment UUID
   */
  async createShipment(shipmentData) {
    try {
      const shipment = {
        id: shipmentData.id || uuidv4(),
        shipmentNumber: shipmentData.shipmentNumber || `SHIP-${Date.now()}`,
        orderId: shipmentData.orderId,
        orderNumber: shipmentData.orderNumber,
        carrierId: shipmentData.carrierId,
        carrierName: shipmentData.carrierName,
        serviceLevel: shipmentData.serviceLevel,
        origin: {
          name: shipmentData.origin?.name || 'Warehouse',
          address: shipmentData.origin?.address,
          contact: shipmentData.origin?.contact
        },
        destination: {
          name: shipmentData.destination.name,
          address: shipmentData.destination.address,
          contact: shipmentData.destination.contact
        },
        packages: shipmentData.packages.map(pkg => ({
          id: uuidv4(),
          trackingNumber: pkg.trackingNumber || null,
          weight: pkg.weight,
          dimensions: pkg.dimensions,
          contents: pkg.contents,
          value: pkg.value
        })),
        status: 'created', // created, manifested, picked_up, in_transit, delivered, exception
        estimatedCost: shipmentData.estimatedCost,
        actualCost: null,
        estimatedDeliveryDate: shipmentData.estimatedDeliveryDate,
        actualDeliveryDate: null,
        specialInstructions: shipmentData.specialInstructions || '',
        insurance: {
          required: shipmentData.insurance?.required || false,
          value: shipmentData.insurance?.value || 0,
          cost: shipmentData.insurance?.cost || 0
        },
        tracking: {
          events: [],
          lastUpdate: null,
          currentLocation: null
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const shipmentId = await this.dataServe.add('shipments', shipment);

      // Generate shipping labels
      if (shipmentData.generateLabels) {
        await this.generateShippingLabels(shipmentId);
      }

      this.eventEmitter.emit('shipment.created', { shipmentId, shipment });
      this.logger.info(`Shipment created: ${shipment.shipmentNumber} for order ${shipment.orderNumber}`);

      return shipmentId;
    } catch (error) {
      this.logger.error('Error creating shipment:', error);
      throw new Error(`Failed to create shipment: ${error.message}`);
    }
  }

  /**
   * Generate shipping labels for shipment
   * @param {string} shipmentId - Shipment ID
   * @returns {Promise<Object>} Label generation result
   */
  async generateShippingLabels(shipmentId) {
    try {
      const shipments = await this.dataServe.jsonFind('shipments', {
        predicate: `obj.id === '${shipmentId}'`
      });

      if (shipments.length === 0) {
        throw new Error(`Shipment not found: ${shipmentId}`);
      }

      const shipment = shipments[0];
      const labels = [];

      // Generate tracking numbers and labels for each package
      for (let i = 0; i < shipment.packages.length; i++) {
        const pkg = shipment.packages[i];

        // Generate tracking number (simplified)
        const trackingNumber = `${shipment.carrierId.toUpperCase()}${Date.now()}${i.toString().padStart(3, '0')}`;

        // Create label data
        const label = {
          packageId: pkg.id,
          trackingNumber,
          labelFormat: 'PDF',
          labelSize: '4x6',
          labelData: this.generateLabelData(shipment, pkg, trackingNumber),
          generatedAt: new Date().toISOString()
        };

        labels.push(label);

        // Update package with tracking number
        pkg.trackingNumber = trackingNumber;
      }

      // Update shipment with tracking numbers
      const updatedShipment = {
        ...shipment,
        packages: shipment.packages,
        status: 'manifested',
        labels,
        updatedAt: new Date().toISOString()
      };

      // Find and update shipment
      const allShipments = await this.dataServe.list('shipments');
      const shipmentEntry = allShipments.find(entry => entry.data.id === shipmentId);
      if (shipmentEntry) {
        await this.dataServe.add('shipments', updatedShipment, shipmentEntry.id);
      }

      // Store labels
      await this.services.filing.write(`labels/${shipmentId}.json`, JSON.stringify(labels, null, 2));

      this.eventEmitter.emit('labels.generated', { shipmentId, labels });
      this.logger.info(`Labels generated for shipment ${shipment.shipmentNumber}: ${labels.length} packages`);

      return { shipmentId, labels };
    } catch (error) {
      this.logger.error('Error generating shipping labels:', error);
      throw new Error(`Failed to generate labels: ${error.message}`);
    }
  }

  /**
   * Generate label data for package
   * @param {Object} shipment - Shipment data
   * @param {Object} package - Package data
   * @param {string} trackingNumber - Tracking number
   * @returns {Object} Label data
   */
  generateLabelData(shipment, pkg, trackingNumber) {
    return {
      trackingNumber,
      shipmentNumber: shipment.shipmentNumber,
      carrierName: shipment.carrierName,
      serviceLevel: shipment.serviceLevel,
      origin: shipment.origin,
      destination: shipment.destination,
      weight: pkg.weight,
      dimensions: pkg.dimensions,
      value: pkg.value,
      barcode: this.generateBarcode(trackingNumber),
      specialInstructions: shipment.specialInstructions
    };
  }

  /**
   * Generate barcode for tracking number
   * @param {string} trackingNumber - Tracking number
   * @returns {string} Barcode data
   */
  generateBarcode(trackingNumber) {
    // Simplified barcode generation - in reality would use proper barcode libraries
    return `|||| ||| |||| | ||| | ||||`; // Placeholder barcode pattern
  }

  /**
   * Update shipment tracking
   * @param {string} shipmentId - Shipment ID
   * @param {Object} trackingUpdate - Tracking update data
   * @returns {Promise<Object>} Updated tracking
   */
  async updateShipmentTracking(shipmentId, trackingUpdate) {
    try {
      const shipments = await this.dataServe.jsonFind('shipments', {
        predicate: `obj.id === '${shipmentId}'`
      });

      if (shipments.length === 0) {
        throw new Error(`Shipment not found: ${shipmentId}`);
      }

      const shipment = shipments[0];

      // Create tracking event
      const trackingEvent = {
        id: uuidv4(),
        timestamp: trackingUpdate.timestamp || new Date().toISOString(),
        status: trackingUpdate.status,
        location: trackingUpdate.location,
        description: trackingUpdate.description,
        source: trackingUpdate.source || 'manual'
      };

      // Update shipment tracking
      const updatedShipment = {
        ...shipment,
        status: this.mapTrackingStatusToShipmentStatus(trackingUpdate.status),
        tracking: {
          events: [...shipment.tracking.events, trackingEvent],
          lastUpdate: trackingEvent.timestamp,
          currentLocation: trackingUpdate.location
        },
        updatedAt: new Date().toISOString()
      };

      // Set actual delivery date if delivered
      if (trackingUpdate.status === 'delivered') {
        updatedShipment.actualDeliveryDate = trackingEvent.timestamp;
      }

      // Find and update shipment
      const allShipments = await this.dataServe.list('shipments');
      const shipmentEntry = allShipments.find(entry => entry.data.id === shipmentId);
      if (shipmentEntry) {
        await this.dataServe.add('shipments', updatedShipment, shipmentEntry.id);
      }

      // Cache tracking for quick access
      await this.cache.put(`tracking:${shipmentId}`, updatedShipment.tracking);

      this.eventEmitter.emit('tracking.updated', { shipmentId, trackingEvent, shipment: updatedShipment });
      this.logger.info(`Tracking updated: ${shipment.shipmentNumber} - ${trackingUpdate.status}`);

      return updatedShipment.tracking;
    } catch (error) {
      this.logger.error('Error updating shipment tracking:', error);
      throw new Error(`Failed to update tracking: ${error.message}`);
    }
  }

  /**
   * Map tracking status to shipment status
   * @param {string} trackingStatus - Tracking status
   * @returns {string} Shipment status
   */
  mapTrackingStatusToShipmentStatus(trackingStatus) {
    const statusMap = {
      'picked_up': 'picked_up',
      'in_transit': 'in_transit',
      'out_for_delivery': 'in_transit',
      'delivered': 'delivered',
      'delivery_attempted': 'exception',
      'exception': 'exception',
      'returned_to_sender': 'exception'
    };

    return statusMap[trackingStatus] || 'in_transit';
  }

  // =================== RETURNS PROCESSING ===================

  /**
   * Create return authorization (RMA)
   * @param {Object} returnData - Return request data
   * @returns {Promise<string>} RMA UUID
   */
  async createReturnAuthorization(returnData) {
    try {
      const rma = {
        id: returnData.id || uuidv4(),
        rmaNumber: returnData.rmaNumber || `RMA-${Date.now()}`,
        originalOrderId: returnData.originalOrderId,
        originalShipmentId: returnData.originalShipmentId,
        customer: returnData.customer,
        reason: returnData.reason, // defective, wrong_item, not_needed, damaged, other
        reasonDescription: returnData.reasonDescription || '',
        items: returnData.items.map(item => ({
          productSku: item.productSku,
          description: item.description,
          quantity: item.quantity,
          condition: item.condition || 'unknown', // new, used, damaged, defective
          refundAmount: item.refundAmount || 0,
          restockable: item.restockable !== false
        })),
        status: 'authorized', // authorized, label_sent, received, processing, completed, rejected
        returnType: returnData.returnType || 'refund', // refund, exchange, store_credit
        returnMethod: returnData.returnMethod || 'ship_back', // ship_back, drop_off, pickup
        estimatedRefund: returnData.items.reduce((sum, item) => sum + item.refundAmount, 0),
        actualRefund: null,
        returnShipment: null,
        expiryDate: this.calculateRMAExpiry(returnData.returnWindow || 30),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const rmaId = await this.dataServe.add('returns', rma);

      // Generate return shipping label if needed
      if (rma.returnMethod === 'ship_back') {
        await this.generateReturnShippingLabel(rmaId);
      }

      this.eventEmitter.emit('rma.created', { rmaId, rma });
      this.logger.info(`RMA created: ${rma.rmaNumber} for order ${rma.originalOrderId}`);

      return rmaId;
    } catch (error) {
      this.logger.error('Error creating return authorization:', error);
      throw new Error(`Failed to create RMA: ${error.message}`);
    }
  }

  /**
   * Calculate RMA expiry date
   * @param {number} days - Return window in days
   * @returns {string} Expiry date ISO string
   */
  calculateRMAExpiry(days) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    return expiryDate.toISOString();
  }

  /**
   * Generate return shipping label
   * @param {string} rmaId - RMA ID
   * @returns {Promise<Object>} Return label
   */
  async generateReturnShippingLabel(rmaId) {
    try {
      const returns = await this.dataServe.jsonFind('returns', {
        predicate: `obj.id === '${rmaId}'`
      });

      if (returns.length === 0) {
        throw new Error(`RMA not found: ${rmaId}`);
      }

      const rma = returns[0];

      // Create return shipment
      const returnShipment = {
        id: uuidv4(),
        rmaId,
        rmaNumber: rma.rmaNumber,
        trackingNumber: `RTN${Date.now()}`,
        carrierId: 'return_carrier', // Simplified
        origin: rma.customer.address,
        destination: {
          name: 'Returns Processing Center',
          address: {
            street: '123 Warehouse Street',
            city: 'Distribution City',
            state: 'DC',
            postalCode: '12345',
            country: 'USA'
          }
        },
        status: 'label_generated',
        createdAt: new Date().toISOString()
      };

      const returnShipmentId = await this.dataServe.add('return_shipments', returnShipment);

      // Update RMA with return shipment info
      const updatedRMA = {
        ...rma,
        status: 'label_sent',
        returnShipment: {
          id: returnShipmentId,
          trackingNumber: returnShipment.trackingNumber
        },
        updatedAt: new Date().toISOString()
      };

      // Find and update RMA
      const allReturns = await this.dataServe.list('returns');
      const rmaEntry = allReturns.find(entry => entry.data.id === rmaId);
      if (rmaEntry) {
        await this.dataServe.add('returns', updatedRMA, rmaEntry.id);
      }

      this.eventEmitter.emit('return.label.generated', { rmaId, returnShipment });
      this.logger.info(`Return label generated: ${rma.rmaNumber} - ${returnShipment.trackingNumber}`);

      return returnShipment;
    } catch (error) {
      this.logger.error('Error generating return shipping label:', error);
      throw new Error(`Failed to generate return label: ${error.message}`);
    }
  }

  /**
   * Process received return
   * @param {string} rmaId - RMA ID
   * @param {Object} receivingData - Return receiving data
   * @returns {Promise<Object>} Processing result
   */
  async processReceivedReturn(rmaId, receivingData) {
    try {
      const returns = await this.dataServe.jsonFind('returns', {
        predicate: `obj.id === '${rmaId}'`
      });

      if (returns.length === 0) {
        throw new Error(`RMA not found: ${rmaId}`);
      }

      const rma = returns[0];

      // Inspect received items
      const inspectionResults = [];
      let totalRefund = 0;

      for (const receivedItem of receivingData.items) {
        const originalItem = rma.items.find(item => item.productSku === receivedItem.productSku);

        if (!originalItem) {
          inspectionResults.push({
            productSku: receivedItem.productSku,
            status: 'not_authorized',
            refundAmount: 0,
            restockable: false,
            notes: 'Item not in original RMA'
          });
          continue;
        }

        // Determine refund based on condition
        let refundAmount = 0;
        let restockable = false;

        switch (receivedItem.actualCondition) {
          case 'new':
          case 'like_new':
            refundAmount = originalItem.refundAmount;
            restockable = originalItem.restockable;
            break;
          case 'used':
            refundAmount = originalItem.refundAmount * 0.8; // 20% restocking fee
            restockable = originalItem.restockable;
            break;
          case 'damaged':
            refundAmount = originalItem.refundAmount * 0.5; // 50% refund
            restockable = false;
            break;
          case 'defective':
            refundAmount = originalItem.refundAmount; // Full refund for defective
            restockable = false;
            break;
          default:
            refundAmount = 0;
            restockable = false;
        }

        inspectionResults.push({
          productSku: receivedItem.productSku,
          originalCondition: originalItem.condition,
          actualCondition: receivedItem.actualCondition,
          refundAmount,
          restockable,
          notes: receivedItem.notes || ''
        });

        totalRefund += refundAmount;

        // Restock if applicable
        if (restockable) {
          await this.restockReturnedItem(receivedItem.productSku, receivedItem.quantity);
        }
      }

      // Update RMA with processing results
      const updatedRMA = {
        ...rma,
        status: 'completed',
        actualRefund: totalRefund,
        inspectionResults,
        processedAt: new Date().toISOString(),
        processedBy: receivingData.processedBy,
        updatedAt: new Date().toISOString()
      };

      // Find and update RMA
      const allReturns = await this.dataServe.list('returns');
      const rmaEntry = allReturns.find(entry => entry.data.id === rmaId);
      if (rmaEntry) {
        await this.dataServe.add('returns', updatedRMA, rmaEntry.id);
      }

      // Queue refund processing
      if (totalRefund > 0) {
        await this.queue.push('refund_queue', {
          rmaId,
          customerId: rma.customer.id,
          refundAmount: totalRefund,
          type: 'process_refund'
        });
      }

      this.eventEmitter.emit('return.processed', { rmaId, rma: updatedRMA, inspectionResults });
      this.logger.info(`Return processed: ${rma.rmaNumber} - $${totalRefund} refund`);

      return { rmaId, inspectionResults, totalRefund };
    } catch (error) {
      this.logger.error('Error processing received return:', error);
      throw new Error(`Failed to process return: ${error.message}`);
    }
  }

  /**
   * Restock returned item
   * @param {string} productSku - Product SKU
   * @param {number} quantity - Quantity to restock
   * @returns {Promise<void>}
   */
  async restockReturnedItem(productSku, quantity) {
    try {
      const inventoryModule = this.services.modules?.inventory;
      if (!inventoryModule) {
        this.logger.warn('Inventory module not available for restocking');
        return;
      }

      // Add to returns/inspection location first
      await inventoryModule.adjustInventory(
        productSku,
        'RETURNS_INSPECTION',
        quantity,
        'Returned item received'
      );

      this.logger.info(`Restocked ${quantity} units of ${productSku} to returns inspection`);
    } catch (error) {
      this.logger.error('Error restocking returned item:', error);
      throw error;
    }
  }

  // =================== ANALYTICS AND REPORTING ===================

  /**
   * Generate delivery performance report
   * @param {Object} filters - Report filters
   * @returns {Promise<Object>} Performance report
   */
  async generateDeliveryPerformanceReport(filters = {}) {
    try {
      const reportPeriod = filters.days || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - reportPeriod);
      const cutoffIso = cutoffDate.toISOString();

      // Get shipments in period
      let predicate = `obj.createdAt >= '${cutoffIso}'`;
      if (filters.carrierId) {
        predicate += ` && obj.carrierId === '${filters.carrierId}'`;
      }

      const shipments = await this.dataServe.jsonFind('shipments', { predicate });

      const report = {
        generatedAt: new Date().toISOString(),
        period: `${reportPeriod} days`,
        filters,
        summary: {
          totalShipments: shipments.length,
          deliveredShipments: 0,
          onTimeDeliveries: 0,
          averageTransitTime: 0,
          exceptionRate: 0,
          carrierPerformance: {}
        },
        metrics: []
      };

      const carrierStats = {};
      let totalTransitTime = 0;
      let deliveredCount = 0;
      let onTimeCount = 0;
      let exceptionCount = 0;

      for (const shipment of shipments) {
        const carrier = shipment.carrierId;

        if (!carrierStats[carrier]) {
          carrierStats[carrier] = {
            name: shipment.carrierName,
            totalShipments: 0,
            delivered: 0,
            onTime: 0,
            exceptions: 0,
            totalTransitTime: 0
          };
        }

        carrierStats[carrier].totalShipments++;

        if (shipment.status === 'delivered') {
          deliveredCount++;
          carrierStats[carrier].delivered++;

          if (shipment.actualDeliveryDate && shipment.estimatedDeliveryDate) {
            const actualDate = new Date(shipment.actualDeliveryDate);
            const estimatedDate = new Date(shipment.estimatedDeliveryDate);
            const transitTime = Math.ceil((actualDate - new Date(shipment.createdAt)) / (1000 * 60 * 60 * 24));

            totalTransitTime += transitTime;
            carrierStats[carrier].totalTransitTime += transitTime;

            if (actualDate <= estimatedDate) {
              onTimeCount++;
              carrierStats[carrier].onTime++;
            }
          }
        } else if (shipment.status === 'exception') {
          exceptionCount++;
          carrierStats[carrier].exceptions++;
        }
      }

      // Calculate summary metrics
      report.summary.deliveredShipments = deliveredCount;
      report.summary.onTimeDeliveries = deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 100) : 0;
      report.summary.averageTransitTime = deliveredCount > 0 ? Math.round(totalTransitTime / deliveredCount) : 0;
      report.summary.exceptionRate = Math.round((exceptionCount / shipments.length) * 100);

      // Calculate carrier performance
      Object.keys(carrierStats).forEach(carrierId => {
        const stats = carrierStats[carrierId];
        report.summary.carrierPerformance[carrierId] = {
          name: stats.name,
          totalShipments: stats.totalShipments,
          onTimeRate: stats.delivered > 0 ? Math.round((stats.onTime / stats.delivered) * 100) : 0,
          exceptionRate: Math.round((stats.exceptions / stats.totalShipments) * 100),
          averageTransitTime: stats.delivered > 0 ? Math.round(stats.totalTransitTime / stats.delivered) : 0
        };
      });

      this.logger.info(`Delivery performance report generated for ${shipments.length} shipments`);
      return report;
    } catch (error) {
      this.logger.error('Error generating delivery performance report:', error);
      throw new Error(`Failed to generate delivery report: ${error.message}`);
    }
  }
}

module.exports = DeliveryModule;