/**
 * @fileoverview eCommerce Routes Manager
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 */

'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const JWT_SECRET = process.env.JWT_SECRET || 'ecommerce-secret-key';

/**
 * Configures and registers eCommerce routes with the Express application.
 * Implements comprehensive API endpoints for storefront and admin functionality.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - NooblyJS Core services
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.express;
  const app_path = options.path || 'ecommerce';
  const { dataServe, filing, cache, logger, queue, search, notifying, measuring } = services;

  // Middleware for API key validation (admin routes)
  const requireAuth = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await dataServe.getByUuid('users', decoded.userId);

      if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  const requireAdmin = async (req, res, next) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // ===== UTILITY FUNCTIONS =====

  const generateOrderNumber = () => {
    return 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
  };

  const calculateOrderTotal = (items) => {
    return items.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  // ===== PUBLIC API ENDPOINTS =====

  // System status
  app.get(`/applications/${app_path}/api/status`, (req, res) => {
    res.json({
      status: 'running',
      application: 'eCommerce Platform',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // ===== PRODUCTS API =====

  // Get all products with filtering and pagination
  app.get(`/applications/${app_path}/api/products`, async (req, res) => {
    try {
      const { category, minPrice, maxPrice, search: searchTerm, page = 1, limit = 20 } = req.query;

      let products = await dataServe.jsonFindByCriteria('products', { status: 'active' });

      // Apply filters
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

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        products = products.filter(p =>
          p.name.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term) ||
          (p.tags && p.tags.some(tag => tag.toLowerCase().includes(term)))
        );
      }

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedProducts = products.slice(startIndex, endIndex);

      res.json({
        products: paginatedProducts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: products.length,
          totalPages: Math.ceil(products.length / limit)
        }
      });
    } catch (error) {
      logger.error('Error fetching products:', error);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  // Get product by ID
  app.get(`/applications/${app_path}/api/products/:id`, async (req, res) => {
    try {
      const product = await dataServe.getByUuid('products', req.params.id);

      if (!product || product.status !== 'active') {
        return res.status(404).json({ error: 'Product not found' });
      }

      // Get product variants
      const variants = await dataServe.jsonFindByPath('product_variants', 'productId', req.params.id);

      // Get product images
      const images = await dataServe.jsonFindByPath('product_images', 'productId', req.params.id);

      res.json({
        ...product,
        variants,
        images
      });
    } catch (error) {
      logger.error('Error fetching product:', error);
      res.status(500).json({ error: 'Failed to fetch product' });
    }
  });

  // Get categories
  app.get(`/applications/${app_path}/api/categories`, async (req, res) => {
    try {
      const categories = await dataServe.jsonFindByCriteria('categories', { status: 'active' });
      res.json({ categories });
    } catch (error) {
      logger.error('Error fetching categories:', error);
      res.status(500).json({ error: 'Failed to fetch categories' });
    }
  });

  // Search products
  app.get(`/applications/${app_path}/api/search`, async (req, res) => {
    try {
      const { q: query, category, limit = 20 } = req.query;

      if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
      }

      let products = await dataServe.jsonFind('products', product => {
        if (product.status !== 'active') return false;

        const searchableText = [
          product.name,
          product.description,
          product.brand || '',
          (product.tags || []).join(' ')
        ].join(' ').toLowerCase();

        return searchableText.includes(query.toLowerCase());
      });

      if (category) {
        products = products.filter(p => p.category === category);
      }

      res.json({
        query,
        results: products.slice(0, limit),
        total: products.length
      });
    } catch (error) {
      logger.error('Error searching products:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // ===== CART API =====

  // Add item to cart
  app.post(`/applications/${app_path}/api/cart/add`, async (req, res) => {
    try {
      const { sessionId, productId, variantId, quantity = 1 } = req.body;

      if (!sessionId || !productId) {
        return res.status(400).json({ error: 'Session ID and product ID are required' });
      }

      // Get or create cart
      let cart = await cache.get(`cart:${sessionId}`);
      if (!cart) {
        cart = { sessionId, items: [], createdAt: new Date().toISOString() };
      }

      // Get product details
      const product = await dataServe.getByUuid('products', productId);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      // Check if item already exists in cart
      const existingItemIndex = cart.items.findIndex(item =>
        item.productId === productId && item.variantId === variantId
      );

      if (existingItemIndex >= 0) {
        cart.items[existingItemIndex].quantity += quantity;
      } else {
        cart.items.push({
          productId,
          variantId,
          name: product.name,
          price: product.salePrice || product.price,
          quantity,
          addedAt: new Date().toISOString()
        });
      }

      cart.updatedAt = new Date().toISOString();

      // Save cart to cache with 24 hour expiry
      await cache.put(`cart:${sessionId}`, cart, 86400);

      res.json({ cart });
    } catch (error) {
      logger.error('Error adding to cart:', error);
      res.status(500).json({ error: 'Failed to add item to cart' });
    }
  });

  // Get cart
  app.get(`/applications/${app_path}/api/cart/:sessionId`, async (req, res) => {
    try {
      const cart = await cache.get(`cart:${req.params.sessionId}`);

      if (!cart) {
        return res.json({ sessionId: req.params.sessionId, items: [] });
      }

      res.json({ cart });
    } catch (error) {
      logger.error('Error fetching cart:', error);
      res.status(500).json({ error: 'Failed to fetch cart' });
    }
  });

  // Update cart item quantity
  app.put(`/applications/${app_path}/api/cart/update`, async (req, res) => {
    try {
      const { sessionId, productId, variantId, quantity } = req.body;

      const cart = await cache.get(`cart:${sessionId}`);
      if (!cart) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      const itemIndex = cart.items.findIndex(item =>
        item.productId === productId && item.variantId === variantId
      );

      if (itemIndex === -1) {
        return res.status(404).json({ error: 'Item not found in cart' });
      }

      if (quantity <= 0) {
        cart.items.splice(itemIndex, 1);
      } else {
        cart.items[itemIndex].quantity = quantity;
      }

      cart.updatedAt = new Date().toISOString();
      await cache.put(`cart:${sessionId}`, cart, 86400);

      res.json({ cart });
    } catch (error) {
      logger.error('Error updating cart:', error);
      res.status(500).json({ error: 'Failed to update cart' });
    }
  });

  // Remove item from cart
  app.delete(`/applications/${app_path}/api/cart/remove`, async (req, res) => {
    try {
      const { sessionId, productId, variantId } = req.body;

      const cart = await cache.get(`cart:${sessionId}`);
      if (!cart) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      cart.items = cart.items.filter(item =>
        !(item.productId === productId && item.variantId === variantId)
      );

      cart.updatedAt = new Date().toISOString();
      await cache.put(`cart:${sessionId}`, cart, 86400);

      res.json({ cart });
    } catch (error) {
      logger.error('Error removing from cart:', error);
      res.status(500).json({ error: 'Failed to remove item from cart' });
    }
  });

  // ===== USER API =====

  // User registration
  app.post(`/applications/${app_path}/api/auth/register`, async (req, res) => {
    try {
      const { email, password, firstName, lastName, phone } = req.body;

      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ error: 'Email, password, first name, and last name are required' });
      }

      // Check if user already exists
      const existingUsers = await dataServe.jsonFindByPath('users', 'email', email);
      if (existingUsers.length > 0) {
        return res.status(409).json({ error: 'User with this email already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone: phone || null,
        isAdmin: false,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const userUuid = await dataServe.add('users', user);

      // Generate JWT token
      const token = jwt.sign({ userId: userUuid }, JWT_SECRET, { expiresIn: '24h' });

      // Remove password from response
      delete user.password;

      res.status(201).json({
        user: { id: userUuid, ...user },
        token
      });
    } catch (error) {
      logger.error('Error registering user:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // User login
  app.post(`/applications/${app_path}/api/auth/login`, async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Find user by email
      const users = await dataServe.jsonFindByPath('users', 'email', email);
      if (users.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = users[0];

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

      // Remove password from response
      delete user.password;

      res.json({
        user,
        token
      });
    } catch (error) {
      logger.error('Error logging in user:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // Get user profile
  app.get(`/applications/${app_path}/api/user/profile`, requireAuth, async (req, res) => {
    try {
      const user = { ...req.user };
      delete user.password;
      res.json({ user });
    } catch (error) {
      logger.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  // Update user profile
  app.put(`/applications/${app_path}/api/user/profile`, requireAuth, async (req, res) => {
    try {
      const { firstName, lastName, phone } = req.body;

      const user = req.user;
      user.firstName = firstName || user.firstName;
      user.lastName = lastName || user.lastName;
      user.phone = phone || user.phone;
      user.updatedAt = new Date().toISOString();

      await dataServe.remove('users', user.id);
      const newUserUuid = await dataServe.add('users', user);

      delete user.password;
      res.json({ user: { id: newUserUuid, ...user } });
    } catch (error) {
      logger.error('Error updating user profile:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  // ===== ORDERS API =====

  // Create new order
  app.post(`/applications/${app_path}/api/orders`, requireAuth, async (req, res) => {
    try {
      const { items, shippingAddress, billingAddress, paymentMethod } = req.body;

      if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Order items are required' });
      }

      if (!shippingAddress) {
        return res.status(400).json({ error: 'Shipping address is required' });
      }

      // Calculate order total
      const subtotal = calculateOrderTotal(items);
      const taxAmount = subtotal * 0.08; // 8% tax
      const shippingCost = subtotal > 100 ? 0 : 10; // Free shipping over $100
      const totalAmount = subtotal + taxAmount + shippingCost;

      // Generate order number
      const orderNumber = generateOrderNumber();

      // Create order
      const order = {
        orderNumber,
        userId: req.user.id,
        status: 'created',
        items,
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        shippingCost,
        totalAmount: Math.round(totalAmount * 100) / 100,
        shippingAddress,
        billingAddress: billingAddress || shippingAddress,
        paymentMethod,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const orderUuid = await dataServe.add('orders', order);

      // Store order items
      for (const item of items) {
        await dataServe.add('order_items', {
          orderId: orderUuid,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * item.quantity
        });
      }

      // Send order confirmation notification
      notifying.notify('order-events', {
        type: 'order_placed',
        orderId: orderUuid,
        orderNumber,
        userId: req.user.id,
        totalAmount
      });

      res.status(201).json({
        order: { id: orderUuid, ...order }
      });
    } catch (error) {
      logger.error('Error creating order:', error);
      res.status(500).json({ error: 'Failed to create order' });
    }
  });

  // Get order details
  app.get(`/applications/${app_path}/api/orders/:id`, requireAuth, async (req, res) => {
    try {
      const order = await dataServe.getByUuid('orders', req.params.id);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Check if user owns this order (or is admin)
      if (order.userId !== req.user.id && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get order items
      const orderItems = await dataServe.jsonFindByPath('order_items', 'orderId', req.params.id);

      res.json({
        order: { ...order, items: orderItems }
      });
    } catch (error) {
      logger.error('Error fetching order:', error);
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  });

  // Track order status (public endpoint)
  app.get(`/applications/${app_path}/api/orders/track/:orderNumber`, async (req, res) => {
    try {
      const orders = await dataServe.jsonFindByPath('orders', 'orderNumber', req.params.orderNumber);

      if (orders.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const order = orders[0];

      res.json({
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        estimatedDelivery: order.estimatedDelivery || null
      });
    } catch (error) {
      logger.error('Error tracking order:', error);
      res.status(500).json({ error: 'Failed to track order' });
    }
  });

  // ===== ADMIN API ENDPOINTS =====

  // Admin Products API
  app.post(`/applications/${app_path}/api/admin/products`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const {
        name, description, price, salePrice, category, brand, sku,
        tags, status = 'active', inventory = 0
      } = req.body;

      if (!name || !description || !price || !category) {
        return res.status(400).json({ error: 'Name, description, price, and category are required' });
      }

      const product = {
        name,
        description,
        price: parseFloat(price),
        salePrice: salePrice ? parseFloat(salePrice) : null,
        category,
        brand: brand || null,
        sku: sku || `SKU-${Date.now()}`,
        tags: tags || [],
        status,
        inventory: parseInt(inventory),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.id
      };

      const productUuid = await dataServe.add('products', product);

      // Create initial inventory record
      await dataServe.add('inventory', {
        productId: productUuid,
        quantity: product.inventory,
        reserved: 0,
        available: product.inventory,
        lastUpdated: new Date().toISOString()
      });

      res.status(201).json({
        product: { id: productUuid, ...product }
      });
    } catch (error) {
      logger.error('Error creating product:', error);
      res.status(500).json({ error: 'Failed to create product' });
    }
  });

  app.put(`/applications/${app_path}/api/admin/products/:id`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const product = await dataServe.getByUuid('products', req.params.id);

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const {
        name, description, price, salePrice, category, brand,
        tags, status, inventory
      } = req.body;

      // Update product fields
      product.name = name || product.name;
      product.description = description || product.description;
      product.price = price ? parseFloat(price) : product.price;
      product.salePrice = salePrice ? parseFloat(salePrice) : product.salePrice;
      product.category = category || product.category;
      product.brand = brand || product.brand;
      product.tags = tags || product.tags;
      product.status = status || product.status;
      product.updatedAt = new Date().toISOString();
      product.updatedBy = req.user.id;

      // Update inventory if provided
      if (inventory !== undefined) {
        product.inventory = parseInt(inventory);

        // Update inventory record
        const inventoryRecords = await dataServe.jsonFindByPath('inventory', 'productId', req.params.id);
        if (inventoryRecords.length > 0) {
          const inventoryRecord = inventoryRecords[0];
          inventoryRecord.quantity = product.inventory;
          inventoryRecord.available = product.inventory - inventoryRecord.reserved;
          inventoryRecord.lastUpdated = new Date().toISOString();

          await dataServe.remove('inventory', inventoryRecord.id);
          await dataServe.add('inventory', inventoryRecord);
        }
      }

      await dataServe.remove('products', req.params.id);
      const newProductUuid = await dataServe.add('products', product);

      res.json({
        product: { id: newProductUuid, ...product }
      });
    } catch (error) {
      logger.error('Error updating product:', error);
      res.status(500).json({ error: 'Failed to update product' });
    }
  });

  app.delete(`/applications/${app_path}/api/admin/products/:id`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const product = await dataServe.getByUuid('products', req.params.id);

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      product.status = 'deleted';
      product.updatedAt = new Date().toISOString();
      product.deletedBy = req.user.id;

      await dataServe.remove('products', req.params.id);
      await dataServe.add('products', product);

      res.json({ message: 'Product deleted successfully' });
    } catch (error) {
      logger.error('Error deleting product:', error);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  });

  // Upload product images
  app.post(`/applications/${app_path}/api/admin/products/:id/images`, requireAuth, requireAdmin, upload.array('images', 10), async (req, res) => {
    try {
      const product = await dataServe.getByUuid('products', req.params.id);

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const uploadedImages = [];

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const fileName = `product_${req.params.id}_${Date.now()}_${i}.${file.originalname.split('.').pop()}`;
        const filePath = `products/${req.params.id}/${fileName}`;

        // Upload image using filing service
        await filing.create(filePath, require('stream').Readable.from(file.buffer));

        // Create image record
        const imageRecord = {
          productId: req.params.id,
          fileName,
          filePath,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          sortOrder: i,
          isPrimary: i === 0, // First image is primary
          uploadedAt: new Date().toISOString(),
          uploadedBy: req.user.id
        };

        const imageUuid = await dataServe.add('product_images', imageRecord);
        uploadedImages.push({ id: imageUuid, ...imageRecord });
      }

      res.status(201).json({
        message: 'Images uploaded successfully',
        images: uploadedImages
      });
    } catch (error) {
      logger.error('Error uploading product images:', error);
      res.status(500).json({ error: 'Failed to upload images' });
    }
  });

  // Admin Orders API
  app.get(`/applications/${app_path}/api/admin/orders`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { status, page = 1, limit = 50 } = req.query;

      let orders = [];
      if (status) {
        orders = await dataServe.jsonFindByCriteria('orders', { status });
      } else {
        orders = await dataServe.jsonFind('orders', () => true);
      }

      // Sort by creation date (newest first)
      orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedOrders = orders.slice(startIndex, endIndex);

      res.json({
        orders: paginatedOrders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: orders.length,
          totalPages: Math.ceil(orders.length / limit)
        }
      });
    } catch (error) {
      logger.error('Error fetching admin orders:', error);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  app.put(`/applications/${app_path}/api/admin/orders/:id/status`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { status, trackingNumber } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }

      const order = await dataServe.getByUuid('orders', req.params.id);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      order.status = status;
      order.updatedAt = new Date().toISOString();
      order.updatedBy = req.user.id;

      if (trackingNumber) {
        order.trackingNumber = trackingNumber;
      }

      if (status === 'shipped') {
        order.shippedAt = new Date().toISOString();
        // Calculate estimated delivery (5 business days)
        const estimatedDelivery = new Date();
        estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);
        order.estimatedDelivery = estimatedDelivery.toISOString();
      }

      await dataServe.remove('orders', req.params.id);
      const newOrderUuid = await dataServe.add('orders', order);

      // Send notification about order status change
      notifying.notify('order-events', {
        type: 'order_status_changed',
        orderId: newOrderUuid,
        orderNumber: order.orderNumber,
        oldStatus: req.body.oldStatus,
        newStatus: status,
        userId: order.userId
      });

      res.json({
        order: { id: newOrderUuid, ...order }
      });
    } catch (error) {
      logger.error('Error updating order status:', error);
      res.status(500).json({ error: 'Failed to update order status' });
    }
  });

  // Process refund
  app.post(`/applications/${app_path}/api/admin/orders/:id/refund`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { amount, reason } = req.body;

      const order = await dataServe.getByUuid('orders', req.params.id);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const refundAmount = amount || order.totalAmount;

      // Create refund record
      const refund = {
        orderId: req.params.id,
        orderNumber: order.orderNumber,
        amount: refundAmount,
        reason: reason || 'Admin refund',
        status: 'processed',
        processedAt: new Date().toISOString(),
        processedBy: req.user.id
      };

      const refundUuid = await dataServe.add('refunds', refund);

      // Update order status
      order.status = 'refunded';
      order.refundAmount = refundAmount;
      order.refundedAt = new Date().toISOString();
      order.updatedAt = new Date().toISOString();

      await dataServe.remove('orders', req.params.id);
      await dataServe.add('orders', order);

      res.json({
        message: 'Refund processed successfully',
        refund: { id: refundUuid, ...refund }
      });
    } catch (error) {
      logger.error('Error processing refund:', error);
      res.status(500).json({ error: 'Failed to process refund' });
    }
  });

  // Admin Analytics API
  app.get(`/applications/${app_path}/api/admin/analytics/sales`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      let orders = await dataServe.jsonFind('orders', order => {
        if (order.status === 'cancelled' || order.status === 'refunded') return false;

        if (startDate || endDate) {
          const orderDate = new Date(order.createdAt);
          if (startDate && orderDate < new Date(startDate)) return false;
          if (endDate && orderDate > new Date(endDate)) return false;
        }

        return true;
      });

      const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Group by date for trend analysis
      const dailySales = {};
      orders.forEach(order => {
        const date = order.createdAt.split('T')[0];
        if (!dailySales[date]) {
          dailySales[date] = { revenue: 0, orders: 0 };
        }
        dailySales[date].revenue += order.totalAmount;
        dailySales[date].orders += 1;
      });

      res.json({
        summary: {
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalOrders,
          averageOrderValue: Math.round(averageOrderValue * 100) / 100
        },
        dailySales,
        period: {
          startDate: startDate || orders[orders.length - 1]?.createdAt?.split('T')[0],
          endDate: endDate || orders[0]?.createdAt?.split('T')[0]
        }
      });
    } catch (error) {
      logger.error('Error fetching sales analytics:', error);
      res.status(500).json({ error: 'Failed to fetch sales analytics' });
    }
  });

  app.get(`/applications/${app_path}/api/admin/analytics/products`, requireAuth, requireAdmin, async (req, res) => {
    try {
      // Get all order items to analyze product performance
      const orderItems = await dataServe.jsonFind('order_items', () => true);

      // Group by product
      const productStats = {};
      for (const item of orderItems) {
        if (!productStats[item.productId]) {
          productStats[item.productId] = {
            productId: item.productId,
            totalQuantitySold: 0,
            totalRevenue: 0,
            orderCount: 0
          };
        }

        productStats[item.productId].totalQuantitySold += item.quantity;
        productStats[item.productId].totalRevenue += item.totalPrice;
        productStats[item.productId].orderCount += 1;
      }

      // Get product details and combine with stats
      const productPerformance = [];
      for (const [productId, stats] of Object.entries(productStats)) {
        try {
          const product = await dataServe.getByUuid('products', productId);
          if (product) {
            productPerformance.push({
              ...stats,
              productName: product.name,
              category: product.category,
              price: product.price
            });
          }
        } catch (error) {
          // Product might have been deleted, skip it
        }
      }

      // Sort by revenue
      productPerformance.sort((a, b) => b.totalRevenue - a.totalRevenue);

      res.json({
        topSellingProducts: productPerformance.slice(0, 10),
        allProductPerformance: productPerformance
      });
    } catch (error) {
      logger.error('Error fetching product analytics:', error);
      res.status(500).json({ error: 'Failed to fetch product analytics' });
    }
  });

  app.get(`/applications/${app_path}/api/admin/analytics/customers`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await dataServe.jsonFindByCriteria('users', { status: 'active' });
      const orders = await dataServe.jsonFind('orders', () => true);

      const totalCustomers = users.length;
      const totalOrders = orders.length;

      // Calculate customer lifetime value
      const customerStats = {};
      orders.forEach(order => {
        if (!customerStats[order.userId]) {
          customerStats[order.userId] = {
            totalOrders: 0,
            totalSpent: 0,
            firstOrder: order.createdAt,
            lastOrder: order.createdAt
          };
        }

        customerStats[order.userId].totalOrders += 1;
        customerStats[order.userId].totalSpent += order.totalAmount;

        if (order.createdAt < customerStats[order.userId].firstOrder) {
          customerStats[order.userId].firstOrder = order.createdAt;
        }
        if (order.createdAt > customerStats[order.userId].lastOrder) {
          customerStats[order.userId].lastOrder = order.createdAt;
        }
      });

      const customersWithOrders = Object.keys(customerStats).length;
      const averageOrdersPerCustomer = customersWithOrders > 0 ? totalOrders / customersWithOrders : 0;

      res.json({
        summary: {
          totalCustomers,
          customersWithOrders,
          averageOrdersPerCustomer: Math.round(averageOrdersPerCustomer * 100) / 100
        },
        customerStats: Object.entries(customerStats).map(([userId, stats]) => ({
          userId,
          ...stats,
          averageOrderValue: stats.totalOrders > 0 ? stats.totalSpent / stats.totalOrders : 0
        })).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 50) // Top 50 customers
      });
    } catch (error) {
      logger.error('Error fetching customer analytics:', error);
      res.status(500).json({ error: 'Failed to fetch customer analytics' });
    }
  });

  // ===== INVENTORY MANAGEMENT =====

  app.get(`/applications/${app_path}/api/admin/inventory`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { lowStock = 10 } = req.query;

      const inventoryRecords = await dataServe.jsonFind('inventory', () => true);
      const lowStockItems = inventoryRecords.filter(item => item.available <= parseInt(lowStock));

      // Get product details for low stock items
      const lowStockWithProducts = [];
      for (const item of lowStockItems) {
        try {
          const product = await dataServe.getByUuid('products', item.productId);
          if (product) {
            lowStockWithProducts.push({
              ...item,
              productName: product.name,
              productSku: product.sku
            });
          }
        } catch (error) {
          // Product might have been deleted
        }
      }

      res.json({
        lowStockItems: lowStockWithProducts,
        totalInventoryItems: inventoryRecords.length,
        lowStockCount: lowStockItems.length
      });
    } catch (error) {
      logger.error('Error fetching inventory:', error);
      res.status(500).json({ error: 'Failed to fetch inventory' });
    }
  });

  app.put(`/applications/${app_path}/api/admin/inventory/:productId`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { quantity, reason = 'Admin adjustment' } = req.body;

      if (quantity === undefined) {
        return res.status(400).json({ error: 'Quantity is required' });
      }

      const inventoryRecords = await dataServe.jsonFindByPath('inventory', 'productId', req.params.productId);

      if (inventoryRecords.length === 0) {
        return res.status(404).json({ error: 'Inventory record not found' });
      }

      const inventoryRecord = inventoryRecords[0];
      const oldQuantity = inventoryRecord.quantity;

      inventoryRecord.quantity = parseInt(quantity);
      inventoryRecord.available = inventoryRecord.quantity - inventoryRecord.reserved;
      inventoryRecord.lastUpdated = new Date().toISOString();

      await dataServe.remove('inventory', inventoryRecord.id);
      const newInventoryUuid = await dataServe.add('inventory', inventoryRecord);

      // Log inventory change
      await dataServe.add('inventory_logs', {
        productId: req.params.productId,
        oldQuantity,
        newQuantity: inventoryRecord.quantity,
        change: inventoryRecord.quantity - oldQuantity,
        reason,
        adjustedBy: req.user.id,
        adjustedAt: new Date().toISOString()
      });

      res.json({
        inventory: { id: newInventoryUuid, ...inventoryRecord },
        message: 'Inventory updated successfully'
      });
    } catch (error) {
      logger.error('Error updating inventory:', error);
      res.status(500).json({ error: 'Failed to update inventory' });
    }
  });

  logger.info(`eCommerce API routes registered successfully for /${app_path}`);
};