/**
 * @fileoverview Inventory Management Module
 *
 * Handles all inventory-related operations including:
 * - Product Master Data Management
 * - Location Management
 * - Stock Management
 * - Lot and Batch Tracking
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

class InventoryModule {
  constructor(services, eventEmitter) {
    this.services = services;
    this.eventEmitter = eventEmitter;
    this.logger = services.logger;
    this.dataServe = services.dataServe;
    this.cache = services.cache;
    this.search = services.search;
  }

  // =================== PRODUCT MASTER DATA ===================

  /**
   * Create a new product
   * @param {Object} productData - Product information
   * @returns {Promise<string>} Product UUID
   */
  async createProduct(productData) {
    try {
      const product = {
        id: productData.id || uuidv4(),
        sku: productData.sku,
        name: productData.name,
        description: productData.description,
        category: productData.category,
        subcategory: productData.subcategory,
        dimensions: {
          length: productData.dimensions?.length || 0,
          width: productData.dimensions?.width || 0,
          height: productData.dimensions?.height || 0,
          weight: productData.dimensions?.weight || 0
        },
        storageRequirements: {
          temperatureControlled: productData.storageRequirements?.temperatureControlled || false,
          hazardous: productData.storageRequirements?.hazardous || false,
          fragile: productData.storageRequirements?.fragile || false,
          securityLevel: productData.storageRequirements?.securityLevel || 'standard'
        },
        variants: productData.variants || [],
        lifecycle: productData.lifecycle || 'active',
        serialNumberTracking: productData.serialNumberTracking || false,
        batchTracking: productData.batchTracking || false,
        expiryTracking: productData.expiryTracking || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const productId = await this.dataServe.add('products', product);

      // Cache frequently accessed product data
      await this.cache.put(`product:${product.sku}`, product);

      // Index for search
      await this.search.add('products', productId, product);

      this.eventEmitter.emit('product.created', { productId, product });
      this.logger.info(`Product created: ${product.sku} (${productId})`);

      return productId;
    } catch (error) {
      this.logger.error('Error creating product:', error);
      throw new Error(`Failed to create product: ${error.message}`);
    }
  }

  /**
   * Get product by SKU or ID
   * @param {string} identifier - SKU or UUID
   * @returns {Promise<Object>} Product data
   */
  async getProduct(identifier) {
    try {
      // Try cache first
      const cached = await this.cache.get(`product:${identifier}`);
      if (cached) return cached;

      // Search by SKU in products container
      const products = await this.dataServe.jsonFind('products', {
        predicate: `obj.sku === '${identifier}' || obj.id === '${identifier}'`
      });

      if (products.length === 0) {
        throw new Error(`Product not found: ${identifier}`);
      }

      const product = products[0];

      // Cache for future access
      await this.cache.put(`product:${product.sku}`, product);

      return product;
    } catch (error) {
      this.logger.error('Error getting product:', error);
      throw new Error(`Failed to get product: ${error.message}`);
    }
  }

  /**
   * Update product information
   * @param {string} identifier - SKU or UUID
   * @param {Object} updates - Updated fields
   * @returns {Promise<Object>} Updated product
   */
  async updateProduct(identifier, updates) {
    try {
      const product = await this.getProduct(identifier);

      const updatedProduct = {
        ...product,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      // Find the UUID for this product
      const products = await this.dataServe.jsonFind('products', {
        predicate: `obj.sku === '${identifier}' || obj.id === '${identifier}'`
      });

      if (products.length === 0) {
        throw new Error(`Product not found: ${identifier}`);
      }

      // Update in dataServe (need to find UUID)
      const allProducts = await this.dataServe.list('products');
      const productEntry = allProducts.find(entry =>
        entry.data.sku === identifier || entry.data.id === identifier
      );

      if (!productEntry) {
        throw new Error(`Product UUID not found: ${identifier}`);
      }

      await this.dataServe.add('products', updatedProduct, productEntry.id);

      // Update cache
      await this.cache.put(`product:${updatedProduct.sku}`, updatedProduct);

      // Update search index
      await this.search.add('products', productEntry.id, updatedProduct);

      this.eventEmitter.emit('product.updated', { productId: productEntry.id, product: updatedProduct });
      this.logger.info(`Product updated: ${updatedProduct.sku}`);

      return updatedProduct;
    } catch (error) {
      this.logger.error('Error updating product:', error);
      throw new Error(`Failed to update product: ${error.message}`);
    }
  }

  // =================== LOCATION MANAGEMENT ===================

  /**
   * Create a new location
   * @param {Object} locationData - Location information
   * @returns {Promise<string>} Location UUID
   */
  async createLocation(locationData) {
    try {
      const location = {
        id: locationData.id || uuidv4(),
        code: locationData.code,
        name: locationData.name,
        warehouse: locationData.warehouse,
        zone: locationData.zone,
        aisle: locationData.aisle,
        bay: locationData.bay,
        shelf: locationData.shelf,
        bin: locationData.bin,
        type: locationData.type || 'storage', // storage, picking, receiving, shipping, quarantine
        capacity: {
          maxWeight: locationData.capacity?.maxWeight || 0,
          maxVolume: locationData.capacity?.maxVolume || 0,
          maxItems: locationData.capacity?.maxItems || 0
        },
        attributes: {
          temperatureControlled: locationData.attributes?.temperatureControlled || false,
          securityLevel: locationData.attributes?.securityLevel || 'standard',
          productRestrictions: locationData.attributes?.productRestrictions || []
        },
        status: locationData.status || 'active', // active, inactive, maintenance
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const locationId = await this.dataServe.add('locations', location);

      // Cache location data
      await this.cache.put(`location:${location.code}`, location);

      // Index for search
      await this.search.add('locations', locationId, location);

      this.eventEmitter.emit('location.created', { locationId, location });
      this.logger.info(`Location created: ${location.code} (${locationId})`);

      return locationId;
    } catch (error) {
      this.logger.error('Error creating location:', error);
      throw new Error(`Failed to create location: ${error.message}`);
    }
  }

  /**
   * Get available locations for a product
   * @param {string} productSku - Product SKU
   * @param {string} type - Location type (optional)
   * @returns {Promise<Array>} Available locations
   */
  async getAvailableLocations(productSku, type = null) {
    try {
      const product = await this.getProduct(productSku);

      let predicate = `obj.status === 'active'`;
      if (type) {
        predicate += ` && obj.type === '${type}'`;
      }

      // Add product-specific restrictions
      if (product.storageRequirements.temperatureControlled) {
        predicate += ` && obj.attributes.temperatureControlled === true`;
      }

      if (product.storageRequirements.securityLevel !== 'standard') {
        predicate += ` && obj.attributes.securityLevel === '${product.storageRequirements.securityLevel}'`;
      }

      const locations = await this.dataServe.jsonFind('locations', { predicate });

      return locations;
    } catch (error) {
      this.logger.error('Error getting available locations:', error);
      throw new Error(`Failed to get available locations: ${error.message}`);
    }
  }

  // =================== STOCK MANAGEMENT ===================

  /**
   * Get current inventory for a product
   * @param {string} productSku - Product SKU
   * @param {string} locationCode - Location code (optional)
   * @returns {Promise<Object>} Inventory data
   */
  async getInventory(productSku, locationCode = null) {
    try {
      let predicate = `obj.productSku === '${productSku}'`;
      if (locationCode) {
        predicate += ` && obj.locationCode === '${locationCode}'`;
      }

      const inventoryRecords = await this.dataServe.jsonFind('inventory', { predicate });

      const summary = {
        productSku,
        locationCode,
        totalQuantity: 0,
        availableQuantity: 0,
        allocatedQuantity: 0,
        onHoldQuantity: 0,
        locations: []
      };

      for (const record of inventoryRecords) {
        summary.totalQuantity += record.quantity;
        summary.availableQuantity += record.available;
        summary.allocatedQuantity += record.allocated;
        summary.onHoldQuantity += record.onHold;

        summary.locations.push({
          locationCode: record.locationCode,
          quantity: record.quantity,
          available: record.available,
          allocated: record.allocated,
          onHold: record.onHold,
          lastUpdated: record.updatedAt
        });
      }

      return summary;
    } catch (error) {
      this.logger.error('Error getting inventory:', error);
      throw new Error(`Failed to get inventory: ${error.message}`);
    }
  }

  /**
   * Adjust inventory levels
   * @param {string} productSku - Product SKU
   * @param {string} locationCode - Location code
   * @param {number} quantity - Quantity to adjust (positive or negative)
   * @param {string} reason - Reason for adjustment
   * @returns {Promise<Object>} Updated inventory record
   */
  async adjustInventory(productSku, locationCode, quantity, reason) {
    try {
      // Find existing inventory record
      const inventoryRecords = await this.dataServe.jsonFind('inventory', {
        predicate: `obj.productSku === '${productSku}' && obj.locationCode === '${locationCode}'`
      });

      let inventoryRecord;
      let isNew = false;

      if (inventoryRecords.length === 0) {
        // Create new inventory record
        inventoryRecord = {
          id: uuidv4(),
          productSku,
          locationCode,
          quantity: Math.max(0, quantity),
          available: Math.max(0, quantity),
          allocated: 0,
          onHold: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        isNew = true;
      } else {
        // Update existing record
        inventoryRecord = {
          ...inventoryRecords[0],
          quantity: Math.max(0, inventoryRecords[0].quantity + quantity),
          available: Math.max(0, inventoryRecords[0].available + quantity),
          updatedAt: new Date().toISOString()
        };
      }

      // Save inventory record
      let inventoryId;
      if (isNew) {
        inventoryId = await this.dataServe.add('inventory', inventoryRecord);
      } else {
        // Find UUID for existing record
        const allInventory = await this.dataServe.list('inventory');
        const inventoryEntry = allInventory.find(entry =>
          entry.data.productSku === productSku && entry.data.locationCode === locationCode
        );

        if (!inventoryEntry) {
          throw new Error(`Inventory record UUID not found: ${productSku}@${locationCode}`);
        }

        await this.dataServe.add('inventory', inventoryRecord, inventoryEntry.id);
        inventoryId = inventoryEntry.id;
      }

      // Log the transaction
      const transaction = {
        id: uuidv4(),
        type: 'adjustment',
        productSku,
        locationCode,
        quantity,
        reason,
        previousQuantity: isNew ? 0 : inventoryRecords[0].quantity,
        newQuantity: inventoryRecord.quantity,
        timestamp: new Date().toISOString()
      };

      await this.dataServe.add('inventory_transactions', transaction);

      this.eventEmitter.emit('inventory.adjusted', {
        inventoryId,
        inventoryRecord,
        transaction
      });

      this.logger.info(`Inventory adjusted: ${productSku}@${locationCode} by ${quantity} (${reason})`);

      return inventoryRecord;
    } catch (error) {
      this.logger.error('Error adjusting inventory:', error);
      throw new Error(`Failed to adjust inventory: ${error.message}`);
    }
  }

  /**
   * Allocate inventory for an order
   * @param {string} productSku - Product SKU
   * @param {number} quantity - Quantity to allocate
   * @param {string} orderId - Order ID
   * @returns {Promise<Array>} Allocation records
   */
  async allocateInventory(productSku, quantity, orderId) {
    try {
      // Find available inventory across all locations
      const inventoryRecords = await this.dataServe.jsonFind('inventory', {
        predicate: `obj.productSku === '${productSku}' && obj.available > 0`
      });

      if (inventoryRecords.length === 0) {
        throw new Error(`No available inventory for product: ${productSku}`);
      }

      // Sort by FIFO or location priority (simplified FIFO here)
      inventoryRecords.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const allocations = [];
      let remainingQuantity = quantity;

      for (const record of inventoryRecords) {
        if (remainingQuantity <= 0) break;

        const allocateQty = Math.min(record.available, remainingQuantity);

        // Update inventory record
        const updatedRecord = {
          ...record,
          available: record.available - allocateQty,
          allocated: record.allocated + allocateQty,
          updatedAt: new Date().toISOString()
        };

        // Find and update the record
        const allInventory = await this.dataServe.list('inventory');
        const inventoryEntry = allInventory.find(entry =>
          entry.data.productSku === productSku &&
          entry.data.locationCode === record.locationCode
        );

        if (inventoryEntry) {
          await this.dataServe.add('inventory', updatedRecord, inventoryEntry.id);
        }

        // Create allocation record
        const allocation = {
          id: uuidv4(),
          orderId,
          productSku,
          locationCode: record.locationCode,
          quantity: allocateQty,
          status: 'allocated',
          createdAt: new Date().toISOString()
        };

        await this.dataServe.add('allocations', allocation);
        allocations.push(allocation);

        remainingQuantity -= allocateQty;
      }

      if (remainingQuantity > 0) {
        throw new Error(`Insufficient inventory: ${remainingQuantity} units short for ${productSku}`);
      }

      this.eventEmitter.emit('inventory.allocated', {
        productSku,
        quantity,
        orderId,
        allocations
      });

      this.logger.info(`Inventory allocated: ${quantity} units of ${productSku} for order ${orderId}`);

      return allocations;
    } catch (error) {
      this.logger.error('Error allocating inventory:', error);
      throw new Error(`Failed to allocate inventory: ${error.message}`);
    }
  }

  // =================== LOT AND BATCH TRACKING ===================

  /**
   * Create a new lot/batch
   * @param {Object} lotData - Lot/batch information
   * @returns {Promise<string>} Lot UUID
   */
  async createLot(lotData) {
    try {
      const lot = {
        id: lotData.id || uuidv4(),
        lotNumber: lotData.lotNumber,
        batchNumber: lotData.batchNumber,
        productSku: lotData.productSku,
        quantity: lotData.quantity,
        manufacturingDate: lotData.manufacturingDate,
        expiryDate: lotData.expiryDate,
        supplierInfo: lotData.supplierInfo || {},
        qualityStatus: lotData.qualityStatus || 'pending', // pending, approved, rejected, quarantine
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const lotId = await this.dataServe.add('lots', lot);

      this.eventEmitter.emit('lot.created', { lotId, lot });
      this.logger.info(`Lot created: ${lot.lotNumber} for ${lot.productSku}`);

      return lotId;
    } catch (error) {
      this.logger.error('Error creating lot:', error);
      throw new Error(`Failed to create lot: ${error.message}`);
    }
  }

  /**
   * Get lots by product SKU
   * @param {string} productSku - Product SKU
   * @param {string} status - Quality status filter (optional)
   * @returns {Promise<Array>} Lot records
   */
  async getLotsByProduct(productSku, status = null) {
    try {
      let predicate = `obj.productSku === '${productSku}'`;
      if (status) {
        predicate += ` && obj.qualityStatus === '${status}'`;
      }

      const lots = await this.dataServe.jsonFind('lots', { predicate });

      return lots;
    } catch (error) {
      this.logger.error('Error getting lots:', error);
      throw new Error(`Failed to get lots: ${error.message}`);
    }
  }

  /**
   * Get expiring lots (FEFO - First Expired, First Out)
   * @param {number} days - Days ahead to check
   * @returns {Promise<Array>} Expiring lots
   */
  async getExpiringLots(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() + days);
      const cutoffIso = cutoffDate.toISOString();

      const lots = await this.dataServe.jsonFind('lots', {
        predicate: `obj.expiryDate && obj.expiryDate <= '${cutoffIso}' && obj.qualityStatus === 'approved'`
      });

      // Sort by expiry date (FEFO)
      lots.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

      return lots;
    } catch (error) {
      this.logger.error('Error getting expiring lots:', error);
      throw new Error(`Failed to get expiring lots: ${error.message}`);
    }
  }
}

module.exports = InventoryModule;