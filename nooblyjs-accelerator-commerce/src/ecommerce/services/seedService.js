/**
 * @fileoverview Data Seeding Service
 *
 * @author NooblyJS eCommerce Team
 * @version 1.0.0
 */

'use strict';

const ProductService = require('./productService');
const CategoryService = require('./categoryService');

/**
 * Data Seeding Service
 * Seeds the database with sample products and categories for testing
 */
class SeedService {
  constructor(services) {
    this.services = services;
    this.productService = new ProductService(services);
    this.categoryService = new CategoryService(services);
    this.dataServe = services.dataServe;
    this.logger = services.logger;
  }

  /**
   * Seed all data
   */
  async seedAll() {
    try {
      this.logger.info('Starting data seeding...');

      // Check if data already exists
      const existingProducts = await this.dataServe.jsonFind('products', () => true);
      if (existingProducts.length > 0) {
        this.logger.info('Products already exist, skipping seeding');
        return;
      }

      // Create admin user first
      await this.createAdminUser();

      // Initialize categories
      await this.categoryService.initializeDefaultCategories();

      // Seed sample products
      await this.seedSampleProducts();

      // Seed sample content
      await this.seedContent();

      this.logger.info('Data seeding completed successfully');
    } catch (error) {
      this.logger.error('Error during data seeding:', error);
      throw error;
    }
  }

  /**
   * Create admin user
   */
  async createAdminUser() {
    try {
      const bcrypt = require('bcryptjs');

      const existingAdmins = await this.dataServe.jsonFindByCriteria('users', { isAdmin: true });
      if (existingAdmins.length > 0) {
        this.logger.info('Admin user already exists');
        return;
      }

      const hashedPassword = await bcrypt.hash('admin123', 10);

      const adminUser = {
        email: 'admin@ecommerce.com',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        phone: '+1-555-0100',
        isAdmin: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const adminUuid = await this.dataServe.add('users', adminUser);
      this.logger.info(`Admin user created: ${adminUser.email} (${adminUuid})`);

      return adminUuid;
    } catch (error) {
      this.logger.error('Error creating admin user:', error);
      throw error;
    }
  }

  /**
   * Seed sample products
   */
  async seedSampleProducts() {
    try {
      const sampleProducts = this.getSampleProducts();

      for (const productData of sampleProducts) {
        try {
          const product = await this.productService.createProduct(productData, 'system');
          this.logger.info(`Sample product created: ${product.name}`);
        } catch (error) {
          this.logger.error(`Error creating sample product ${productData.name}:`, error);
        }
      }

      this.logger.info('Sample products seeded successfully');
    } catch (error) {
      this.logger.error('Error seeding sample products:', error);
      throw error;
    }
  }

  /**
   * Get sample product data
   */
  getSampleProducts() {
    return [
      // Electronics
      {
        name: 'iPhone 15 Pro',
        description: 'The latest iPhone with titanium design and A17 Pro chip. Features a 48MP main camera, 5x telephoto zoom, and USB-C connectivity.',
        price: 999.99,
        salePrice: 899.99,
        category: 'Electronics',
        brand: 'Apple',
        sku: 'IPHONE15PRO-128',
        tags: ['smartphone', 'apple', 'ios', 'camera', 'premium'],
        inventory: 50,
        weight: 0.41,
        dimensions: { length: 6.1, width: 2.9, height: 0.3 },
        seoTitle: 'iPhone 15 Pro - Premium Smartphone with Titanium Design',
        seoDescription: 'Experience the ultimate iPhone with the iPhone 15 Pro featuring titanium construction, A17 Pro chip, and advanced camera system.'
      },
      {
        name: 'Samsung Galaxy S24 Ultra',
        description: 'Premium Android smartphone with S Pen, 200MP camera, and AI-powered features. The ultimate productivity device.',
        price: 1199.99,
        category: 'Electronics',
        brand: 'Samsung',
        sku: 'GALAXY-S24-ULTRA',
        tags: ['smartphone', 'samsung', 'android', 's-pen', 'camera'],
        inventory: 30,
        weight: 0.48,
        dimensions: { length: 6.8, width: 3.1, height: 0.35 }
      },
      {
        name: 'MacBook Air M3',
        description: 'Incredibly thin and light laptop powered by the M3 chip. Perfect for students and professionals who need portable performance.',
        price: 1299.99,
        category: 'Electronics',
        brand: 'Apple',
        sku: 'MBA-M3-256',
        tags: ['laptop', 'apple', 'macbook', 'm3', 'portable'],
        inventory: 25,
        weight: 2.7,
        dimensions: { length: 11.97, width: 8.46, height: 0.44 }
      },
      {
        name: 'Dell XPS 13',
        description: 'Premium ultrabook with stunning InfinityEdge display and powerful performance in a compact design.',
        price: 999.99,
        salePrice: 849.99,
        category: 'Electronics',
        brand: 'Dell',
        sku: 'XPS13-I7-512',
        tags: ['laptop', 'dell', 'ultrabook', 'windows', 'business'],
        inventory: 40,
        weight: 2.8,
        dimensions: { length: 11.64, width: 7.82, height: 0.58 }
      },
      {
        name: 'Sony WH-1000XM5',
        description: 'Industry-leading noise canceling wireless headphones with exceptional sound quality and all-day comfort.',
        price: 399.99,
        salePrice: 329.99,
        category: 'Electronics',
        brand: 'Sony',
        sku: 'WH1000XM5-BLK',
        tags: ['headphones', 'sony', 'wireless', 'noise-canceling', 'premium'],
        inventory: 75,
        weight: 0.56,
        dimensions: { length: 7.3, width: 6.1, height: 2.6 }
      },

      // Clothing
      {
        name: 'Classic White T-Shirt',
        description: 'Premium cotton t-shirt with perfect fit and exceptional comfort. A wardrobe essential that never goes out of style.',
        price: 29.99,
        category: 'Clothing',
        brand: 'EssentialWear',
        sku: 'TEE-WHITE-M',
        tags: ['t-shirt', 'cotton', 'casual', 'basic', 'white'],
        inventory: 200,
        weight: 0.2,
        seoTitle: 'Classic White T-Shirt - Premium Cotton Comfort',
        seoDescription: 'Discover the perfect white t-shirt made from premium cotton for ultimate comfort and style.'
      },
      {
        name: 'Denim Jeans - Slim Fit',
        description: 'Classic slim-fit jeans made from premium denim with a modern cut and comfortable stretch.',
        price: 79.99,
        salePrice: 59.99,
        category: 'Clothing',
        brand: 'DenimCo',
        sku: 'JEANS-SLIM-32',
        tags: ['jeans', 'denim', 'slim-fit', 'casual', 'blue'],
        inventory: 150,
        weight: 0.8
      },
      {
        name: 'Wool Sweater',
        description: 'Cozy merino wool sweater perfect for cool weather. Features a classic crew neck and ribbed details.',
        price: 89.99,
        category: 'Clothing',
        brand: 'WoolCraft',
        sku: 'SWEATER-WOOL-L',
        tags: ['sweater', 'wool', 'warm', 'cozy', 'winter'],
        inventory: 60,
        weight: 0.5
      },
      {
        name: 'Athletic Running Shoes',
        description: 'High-performance running shoes with advanced cushioning and breathable mesh upper for maximum comfort.',
        price: 129.99,
        salePrice: 99.99,
        category: 'Clothing',
        brand: 'SportMax',
        sku: 'SHOES-RUN-10',
        tags: ['shoes', 'running', 'athletic', 'comfortable', 'breathable'],
        inventory: 80,
        weight: 0.9
      },

      // Home & Garden
      {
        name: 'Smart Home Security Camera',
        description: '4K wireless security camera with night vision, motion detection, and smartphone app control.',
        price: 199.99,
        salePrice: 149.99,
        category: 'Home & Garden',
        brand: 'SecureHome',
        sku: 'CAM-4K-WIFI',
        tags: ['security', 'camera', 'smart-home', '4k', 'wireless'],
        inventory: 45,
        weight: 0.8
      },
      {
        name: 'Stainless Steel Cookware Set',
        description: '10-piece professional cookware set made from high-quality stainless steel with aluminum core for even heating.',
        price: 299.99,
        salePrice: 229.99,
        category: 'Home & Garden',
        brand: 'ChefPro',
        sku: 'COOKWARE-10PC',
        tags: ['cookware', 'stainless-steel', 'kitchen', 'professional', 'set'],
        inventory: 35,
        weight: 12.5
      },
      {
        name: 'Organic Garden Starter Kit',
        description: 'Complete kit for starting your organic garden. Includes seeds, soil, pots, and growing guide.',
        price: 49.99,
        category: 'Home & Garden',
        brand: 'GreenThumb',
        sku: 'GARDEN-KIT-ORG',
        tags: ['gardening', 'organic', 'seeds', 'starter-kit', 'plants'],
        inventory: 100,
        weight: 3.2
      },

      // Sports & Outdoors
      {
        name: 'Professional Yoga Mat',
        description: 'Premium eco-friendly yoga mat with superior grip and cushioning. Perfect for all types of yoga practice.',
        price: 69.99,
        category: 'Sports & Outdoors',
        brand: 'ZenFit',
        sku: 'YOGA-MAT-PRO',
        tags: ['yoga', 'mat', 'exercise', 'fitness', 'eco-friendly'],
        inventory: 120,
        weight: 1.8
      },
      {
        name: 'Camping Tent - 4 Person',
        description: 'Spacious 4-person camping tent with easy setup, waterproof design, and excellent ventilation.',
        price: 159.99,
        salePrice: 129.99,
        category: 'Sports & Outdoors',
        brand: 'OutdoorLife',
        sku: 'TENT-4P-WP',
        tags: ['camping', 'tent', 'outdoor', 'waterproof', '4-person'],
        inventory: 25,
        weight: 8.5
      },
      {
        name: 'Mountain Bike Helmet',
        description: 'Lightweight and durable mountain bike helmet with advanced ventilation and adjustable fit system.',
        price: 79.99,
        category: 'Sports & Outdoors',
        brand: 'RideSafe',
        sku: 'HELMET-MTB-L',
        tags: ['helmet', 'mountain-bike', 'safety', 'cycling', 'protective'],
        inventory: 55,
        weight: 0.85
      },

      // Books
      {
        name: 'JavaScript: The Complete Guide',
        description: 'Comprehensive guide to modern JavaScript development covering ES6+, frameworks, and best practices.',
        price: 49.99,
        category: 'Books',
        brand: 'TechBooks',
        sku: 'BOOK-JS-GUIDE',
        tags: ['book', 'javascript', 'programming', 'web-development', 'guide'],
        inventory: 90,
        weight: 1.2
      },
      {
        name: 'The Art of Clean Code',
        description: 'Learn to write maintainable, readable code with proven techniques and real-world examples.',
        price: 39.99,
        category: 'Books',
        brand: 'DevPress',
        sku: 'BOOK-CLEAN-CODE',
        tags: ['book', 'programming', 'clean-code', 'software-development', 'best-practices'],
        inventory: 75,
        weight: 0.9
      },
      {
        name: 'Digital Marketing Mastery',
        description: 'Complete guide to digital marketing including SEO, social media, email marketing, and analytics.',
        price: 34.99,
        salePrice: 24.99,
        category: 'Books',
        brand: 'BusinessBooks',
        sku: 'BOOK-DIGITAL-MKT',
        tags: ['book', 'marketing', 'digital', 'business', 'strategy'],
        inventory: 60,
        weight: 0.8
      },

      // Health & Beauty
      {
        name: 'Vitamin C Serum',
        description: 'Premium vitamin C serum with hyaluronic acid for brightening and anti-aging benefits.',
        price: 29.99,
        salePrice: 19.99,
        category: 'Health & Beauty',
        brand: 'GlowSkin',
        sku: 'SERUM-VIT-C',
        tags: ['skincare', 'vitamin-c', 'anti-aging', 'serum', 'brightening'],
        inventory: 200,
        weight: 0.1
      },
      {
        name: 'Electric Toothbrush',
        description: 'Advanced electric toothbrush with multiple cleaning modes and pressure sensor for optimal oral care.',
        price: 89.99,
        salePrice: 69.99,
        category: 'Health & Beauty',
        brand: 'SmileCare',
        sku: 'TOOTHBRUSH-ELEC',
        tags: ['toothbrush', 'electric', 'oral-care', 'dental', 'health'],
        inventory: 65,
        weight: 0.5
      },
      {
        name: 'Fitness Tracker Watch',
        description: 'Smart fitness tracker with heart rate monitoring, sleep tracking, and smartphone notifications.',
        price: 199.99,
        salePrice: 149.99,
        category: 'Health & Beauty',
        brand: 'FitTech',
        sku: 'TRACKER-FIT-BLK',
        tags: ['fitness', 'tracker', 'smartwatch', 'health', 'monitor'],
        inventory: 85,
        weight: 0.12
      }
    ];
  }

  /**
   * Clear all data (for testing purposes)
   */
  async clearAllData() {
    try {
      this.logger.info('Clearing all data...');

      const containers = [
        'products', 'categories', 'users', 'orders', 'order_items',
        'inventory', 'product_images', 'product_variants', 'carts',
        'reviews', 'addresses', 'payment_methods', 'promotions',
        'analytics', 'inventory_logs', 'refunds'
      ];

      for (const container of containers) {
        try {
          const items = await this.dataServe.jsonFind(container, () => true);
          for (const item of items) {
            await this.dataServe.remove(container, item.id);
          }
          this.logger.info(`Cleared ${items.length} items from ${container}`);
        } catch (error) {
          // Container might not exist
          this.logger.debug(`Container ${container} not found or empty`);
        }
      }

      this.logger.info('All data cleared successfully');
    } catch (error) {
      this.logger.error('Error clearing data:', error);
      throw error;
    }
  }

  /**
   * Get seeding status
   */
  async getSeedingStatus() {
    try {
      const status = {};

      const containers = ['products', 'categories', 'users'];
      for (const container of containers) {
        try {
          const items = await this.dataServe.jsonFind(container, () => true);
          status[container] = items.length;
        } catch (error) {
          status[container] = 0;
        }
      }

      return status;
    } catch (error) {
      this.logger.error('Error getting seeding status:', error);
      throw error;
    }
  }

  // Seed sample content
  async seedContent() {
    try {
      const sampleContent = [
        {
          title: 'Welcome to NooblyJS Store',
          content: 'Discover our premium collection of products designed for modern living. Shop with confidence knowing you\'re getting the best quality and service.',
          type: 'hero',
          slug: 'welcome-hero',
          excerpt: 'Discover our premium collection of products designed for modern living.',
          imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80',
          buttonText: 'Shop Now',
          buttonUrl: '#products',
          backgroundColor: '#2563eb',
          textColor: '#ffffff',
          active: true,
          sortOrder: 1,
          metadata: {
            featured: true,
            displayOnHomepage: true
          }
        },
        {
          title: 'Free Shipping Weekend',
          content: 'Get free shipping on all orders this weekend! No minimum purchase required. Use code FREESHIP at checkout.',
          type: 'banner',
          slug: 'free-shipping-weekend',
          excerpt: 'Get free shipping on all orders this weekend!',
          buttonText: 'Shop Now',
          buttonUrl: '#products',
          backgroundColor: '#10b981',
          textColor: '#ffffff',
          active: true,
          sortOrder: 2,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
          metadata: {
            promoCode: 'FREESHIP',
            discount: 0,
            freeShipping: true
          }
        },
        {
          title: 'New Electronics Collection',
          content: 'Check out our latest electronics including smartphones, laptops, and smart home devices. All from trusted brands with warranty included.',
          type: 'announcement',
          slug: 'new-electronics-collection',
          excerpt: 'Check out our latest electronics including smartphones, laptops, and smart home devices.',
          imageUrl: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80',
          buttonText: 'View Electronics',
          buttonUrl: '#category-electronics',
          active: true,
          sortOrder: 3,
          metadata: {
            category: 'Electronics',
            featured: true
          }
        },
        {
          title: 'About Us',
          content: `
            <h2>Welcome to NooblyJS Store</h2>
            <p>We're passionate about bringing you the finest products for modern living. Our carefully curated collection features premium brands and innovative designs that enhance your lifestyle.</p>

            <h3>Our Mission</h3>
            <p>To make premium products accessible to everyone, while providing an exceptional shopping experience that exceeds expectations.</p>

            <h3>Why Choose Us?</h3>
            <ul>
              <li>Carefully curated product selection</li>
              <li>Competitive pricing with regular promotions</li>
              <li>Fast, reliable shipping</li>
              <li>Excellent customer service</li>
              <li>Easy returns and exchanges</li>
            </ul>

            <h3>Our Commitment</h3>
            <p>We're committed to sustainability and ethical sourcing. We work with suppliers who share our values and maintain high standards for quality and environmental responsibility.</p>
          `,
          type: 'page',
          slug: 'about-us',
          excerpt: 'Learn more about NooblyJS Store and our commitment to quality and customer satisfaction.',
          active: true,
          sortOrder: 100,
          metadata: {
            showInFooter: true,
            lastUpdated: new Date().toISOString()
          }
        },
        {
          title: 'Privacy Policy',
          content: `
            <h2>Privacy Policy</h2>
            <p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>

            <h3>Information We Collect</h3>
            <p>We collect information you provide directly to us, such as when you create an account, make a purchase, or contact us for support.</p>

            <h3>How We Use Your Information</h3>
            <p>We use the information we collect to provide, maintain, and improve our services, process transactions, and communicate with you.</p>

            <h3>Information Sharing</h3>
            <p>We do not sell, trade, or otherwise transfer your personal information to third parties except as described in this privacy policy.</p>

            <h3>Data Security</h3>
            <p>We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.</p>

            <h3>Contact Us</h3>
            <p>If you have any questions about this privacy policy, please contact us at privacy@nooblyjs-store.com</p>
          `,
          type: 'page',
          slug: 'privacy-policy',
          excerpt: 'Our privacy policy explains how we collect, use, and protect your personal information.',
          active: true,
          sortOrder: 101,
          metadata: {
            showInFooter: true,
            legal: true
          }
        },
        {
          title: 'Summer Sale - Up to 50% Off',
          content: 'Don\'t miss our biggest sale of the year! Save up to 50% on selected items across all categories. Limited time offer.',
          type: 'promotion',
          slug: 'summer-sale-2024',
          excerpt: 'Save up to 50% on selected items across all categories.',
          imageUrl: 'https://images.unsplash.com/photo-1607083206968-13611e3d76db?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80',
          buttonText: 'Shop Sale',
          buttonUrl: '#sale',
          backgroundColor: '#f59e0b',
          textColor: '#ffffff',
          active: true,
          sortOrder: 4,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
          metadata: {
            maxDiscount: 50,
            saleType: 'percentage',
            categories: ['Electronics', 'Clothing', 'Home & Garden']
          }
        }
      ];

      for (const contentData of sampleContent) {
        const contentItem = {
          ...contentData,
          views: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'system'
        };

        const contentId = await this.dataServe.add('content', contentItem);
        this.logger.info(`Content created: ${contentItem.title} (${contentId})`);
      }

      this.logger.info('Sample content seeded successfully');
    } catch (error) {
      this.logger.error('Error seeding content:', error);
      throw error;
    }
  }
}

module.exports = SeedService;