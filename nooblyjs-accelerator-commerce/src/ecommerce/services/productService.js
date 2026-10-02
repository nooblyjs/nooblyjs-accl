/**
 * @fileoverview Product Management Service
 *
 * @author NooblyJS eCommerce Team
 * @version 1.0.0
 */

'use strict';

/**
 * Product Management Service
 * Provides business logic for product operations using NooblyJS Core services
 */
class ProductService {
  constructor(services) {
    this.dataServe = services.dataServe;
    this.filing = services.filing;
    this.cache = services.cache;
    this.logger = services.logger;
    this.notifying = services.notifying;
    this.search = services.search;
  }

  /**
   * Create a new product with full validation and setup
   */
  async createProduct(productData, userId) {
    try {
      // Validate required fields
      const required = ['name', 'description', 'price', 'category'];
      for (const field of required) {
        if (!productData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Generate SKU if not provided
      if (!productData.sku) {
        productData.sku = await this.generateSKU(productData.category);
      }

      // Validate SKU uniqueness
      const existingProducts = await this.dataServe.jsonFindByPath('products', 'sku', productData.sku);
      if (existingProducts.length > 0) {
        throw new Error('SKU already exists');
      }

      // Create product object
      const product = {
        name: productData.name.trim(),
        description: productData.description.trim(),
        price: parseFloat(productData.price),
        salePrice: productData.salePrice ? parseFloat(productData.salePrice) : null,
        category: productData.category,
        brand: productData.brand || null,
        sku: productData.sku,
        tags: productData.tags || [],
        status: 'active',
        inventory: parseInt(productData.inventory || 0),
        weight: productData.weight || null,
        dimensions: productData.dimensions || null,
        seoTitle: productData.seoTitle || productData.name,
        seoDescription: productData.seoDescription || productData.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: userId
      };

      // Create product
      const productUuid = await this.dataServe.add('products', product);

      // Create initial inventory record
      await this.createInventoryRecord(productUuid, product.inventory);

      // Add to search index
      await this.addToSearchIndex(productUuid, product);

      // Clear product cache
      await this.clearProductCache();

      // Send notification
      this.notifying.notify('product-events', {
        type: 'product_created',
        productId: productUuid,
        productName: product.name,
        userId
      });

      this.logger.info(`Product created: ${product.name} (${productUuid})`);

      return { id: productUuid, ...product };
    } catch (error) {
      this.logger.error('Error creating product:', error);
      throw error;
    }
  }

  /**
   * Update an existing product
   */
  async updateProduct(productId, updateData, userId) {
    try {
      const product = await this.dataServe.getByUuid('products', productId);

      if (!product) {
        throw new Error('Product not found');
      }

      // Update fields
      const updatableFields = [
        'name', 'description', 'price', 'salePrice', 'category',
        'brand', 'tags', 'status', 'weight', 'dimensions',
        'seoTitle', 'seoDescription'
      ];

      updatableFields.forEach(field => {
        if (updateData[field] !== undefined) {
          if (field === 'price' || field === 'salePrice') {
            product[field] = updateData[field] ? parseFloat(updateData[field]) : null;
          } else if (field === 'name' || field === 'description') {
            product[field] = updateData[field].trim();
          } else {
            product[field] = updateData[field];
          }
        }
      });

      // Update inventory if provided
      if (updateData.inventory !== undefined) {
        const newInventory = parseInt(updateData.inventory);
        await this.updateInventory(productId, newInventory);
        product.inventory = newInventory;
      }

      product.updatedAt = new Date().toISOString();
      product.updatedBy = userId;

      // Update product
      await this.dataServe.remove('products', productId);
      const newProductUuid = await this.dataServe.add('products', product);

      // Update search index
      await this.updateSearchIndex(newProductUuid, product);

      // Clear caches
      await this.clearProductCache();
      await this.cache.delete(`product:${productId}`);

      // Send notification
      this.notifying.notify('product-events', {
        type: 'product_updated',
        productId: newProductUuid,
        productName: product.name,
        userId
      });

      this.logger.info(`Product updated: ${product.name} (${newProductUuid})`);

      return { id: newProductUuid, ...product };
    } catch (error) {
      this.logger.error('Error updating product:', error);
      throw error;
    }
  }

  /**
   * Get product with caching
   */
  async getProduct(productId, includeRelated = false) {
    try {
      // Try cache first
      const cacheKey = `product:${productId}`;
      let product = await this.cache.get(cacheKey);

      if (!product) {
        product = await this.dataServe.getByUuid('products', productId);
        if (product) {
          // Cache for 1 hour
          await this.cache.put(cacheKey, product, 3600);
        }
      }

      if (!product) {
        throw new Error('Product not found');
      }

      if (includeRelated) {
        // Get variants
        product.variants = await this.dataServe.jsonFindByPath('product_variants', 'productId', productId);

        // Get images
        product.images = await this.dataServe.jsonFindByPath('product_images', 'productId', productId);

        // Get inventory
        const inventory = await this.dataServe.jsonFindByPath('inventory', 'productId', productId);
        product.inventoryDetails = inventory[0] || null;

        // Get related products (same category)
        if (product.category) {
          const relatedProducts = await this.dataServe.jsonFind('products', p =>
            p.category === product.category && p.id !== productId && p.status === 'active'
          );
          product.relatedProducts = relatedProducts.slice(0, 4);
        }
      }

      return product;
    } catch (error) {
      this.logger.error('Error getting product:', error);
      throw error;
    }
  }

  /**
   * Search products with advanced filtering
   */
  async searchProducts(searchParams) {
    try {
      const {
        query,
        category,
        minPrice,
        maxPrice,
        brand,
        tags,
        status = 'active',
        sortBy = 'name',
        sortOrder = 'asc',
        page = 1,
        limit = 20
      } = searchParams;

      let products = await this.dataServe.jsonFindByCriteria('products', { status });

      // Apply filters
      if (query) {
        const searchTerm = query.toLowerCase();
        products = products.filter(p =>
          p.name.toLowerCase().includes(searchTerm) ||
          p.description.toLowerCase().includes(searchTerm) ||
          (p.brand && p.brand.toLowerCase().includes(searchTerm)) ||
          (p.tags && p.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
        );
      }

      if (category) {
        products = products.filter(p => p.category === category);
      }

      if (minPrice || maxPrice) {
        products = products.filter(p => {
          const price = p.salePrice || p.price;
          return (!minPrice || price >= parseFloat(minPrice)) &&
                 (!maxPrice || price <= parseFloat(maxPrice));
        });
      }

      if (brand) {
        products = products.filter(p => p.brand === brand);
      }

      if (tags && tags.length > 0) {
        products = products.filter(p =>
          p.tags && tags.some(tag => p.tags.includes(tag))
        );
      }

      // Sort products
      products.sort((a, b) => {
        let aValue = a[sortBy];
        let bValue = b[sortBy];

        if (sortBy === 'price') {
          aValue = a.salePrice || a.price;
          bValue = b.salePrice || b.price;
        }

        if (typeof aValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (sortOrder === 'desc') {
          return bValue > aValue ? 1 : -1;
        } else {
          return aValue > bValue ? 1 : -1;
        }
      });

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedProducts = products.slice(startIndex, endIndex);

      return {
        products: paginatedProducts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: products.length,
          totalPages: Math.ceil(products.length / limit)
        },
        filters: {
          query,
          category,
          minPrice,
          maxPrice,
          brand,
          tags,
          sortBy,
          sortOrder
        }
      };
    } catch (error) {
      this.logger.error('Error searching products:', error);
      throw error;
    }
  }

  /**
   * Get products by category with caching
   */
  async getProductsByCategory(category, limit = 20) {
    try {
      const cacheKey = `category:${category}:${limit}`;
      let products = await this.cache.get(cacheKey);

      if (!products) {
        products = await this.dataServe.jsonFind('products', p =>
          p.category === category && p.status === 'active'
        );

        // Sort by creation date (newest first)
        products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Limit results
        products = products.slice(0, limit);

        // Cache for 30 minutes
        await this.cache.put(cacheKey, products, 1800);
      }

      return products;
    } catch (error) {
      this.logger.error('Error getting products by category:', error);
      throw error;
    }
  }

  /**
   * Get featured products
   */
  async getFeaturedProducts(limit = 10) {
    try {
      const cacheKey = `featured:${limit}`;
      let products = await this.cache.get(cacheKey);

      if (!products) {
        // For now, get newest products as featured
        // In future, this could be based on a 'featured' flag
        products = await this.dataServe.jsonFind('products', p => p.status === 'active');

        products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        products = products.slice(0, limit);

        // Cache for 1 hour
        await this.cache.put(cacheKey, products, 3600);
      }

      return products;
    } catch (error) {
      this.logger.error('Error getting featured products:', error);
      throw error;
    }
  }

  /**
   * Generate unique SKU
   */
  async generateSKU(category) {
    const prefix = category.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();

    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Create inventory record
   */
  async createInventoryRecord(productId, quantity) {
    await this.dataServe.add('inventory', {
      productId,
      quantity: parseInt(quantity),
      reserved: 0,
      available: parseInt(quantity),
      reorderLevel: Math.max(5, Math.floor(quantity * 0.1)), // 10% of initial stock or 5, whichever is higher
      lastUpdated: new Date().toISOString()
    });
  }

  /**
   * Update inventory
   */
  async updateInventory(productId, newQuantity) {
    const inventoryRecords = await this.dataServe.jsonFindByPath('inventory', 'productId', productId);

    if (inventoryRecords.length > 0) {
      const inventory = inventoryRecords[0];
      const oldQuantity = inventory.quantity;

      inventory.quantity = parseInt(newQuantity);
      inventory.available = inventory.quantity - inventory.reserved;
      inventory.lastUpdated = new Date().toISOString();

      await this.dataServe.remove('inventory', inventory.id);
      await this.dataServe.add('inventory', inventory);

      // Log inventory change
      await this.dataServe.add('inventory_logs', {
        productId,
        oldQuantity,
        newQuantity: inventory.quantity,
        change: inventory.quantity - oldQuantity,
        reason: 'Product update',
        adjustedAt: new Date().toISOString()
      });

      // Check for low stock and send notification
      if (inventory.available <= inventory.reorderLevel) {
        this.notifying.notify('inventory-alerts', {
          type: 'low_stock',
          productId,
          availableQuantity: inventory.available,
          reorderLevel: inventory.reorderLevel
        });
      }
    }
  }

  /**
   * Add to search index
   */
  async addToSearchIndex(productId, product) {
    try {
      const searchDocument = {
        id: productId,
        title: product.name,
        content: `${product.name} ${product.description} ${product.brand || ''} ${(product.tags || []).join(' ')}`,
        category: product.category,
        price: product.salePrice || product.price,
        url: `/products/${productId}`
      };

      await this.search.index('products', productId, searchDocument);
    } catch (error) {
      this.logger.error('Error adding to search index:', error);
    }
  }

  /**
   * Update search index
   */
  async updateSearchIndex(productId, product) {
    await this.addToSearchIndex(productId, product);
  }

  /**
   * Clear product caches
   */
  async clearProductCache() {
    try {
      // Clear category caches
      const categories = await this.dataServe.jsonFind('categories', () => true);
      for (const category of categories) {
        await this.cache.delete(`category:${category.name}:20`);
      }

      // Clear featured cache
      await this.cache.delete('featured:10');
    } catch (error) {
      this.logger.error('Error clearing product cache:', error);
    }
  }

  /**
   * Get low stock products
   */
  async getLowStockProducts(threshold = 10) {
    try {
      const inventoryRecords = await this.dataServe.jsonFind('inventory',
        inv => inv.available <= threshold
      );

      const lowStockProducts = [];
      for (const inventory of inventoryRecords) {
        try {
          const product = await this.dataServe.getByUuid('products', inventory.productId);
          if (product && product.status === 'active') {
            lowStockProducts.push({
              ...product,
              inventory
            });
          }
        } catch (error) {
          // Product might have been deleted
        }
      }

      return lowStockProducts;
    } catch (error) {
      this.logger.error('Error getting low stock products:', error);
      throw error;
    }
  }

  /**
   * Bulk update product status
   */
  async bulkUpdateStatus(productIds, status, userId) {
    const results = [];

    for (const productId of productIds) {
      try {
        const updated = await this.updateProduct(productId, { status }, userId);
        results.push({ productId, success: true, product: updated });
      } catch (error) {
        results.push({ productId, success: false, error: error.message });
      }
    }

    return results;
  }
}

module.exports = ProductService;