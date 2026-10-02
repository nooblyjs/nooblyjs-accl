/**
 * Test setup and configuration
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random port for testing

// Mock external services
jest.mock('stripe', () => {
  return jest.fn(() => ({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn()
    },
    webhooks: {
      constructEvent: jest.fn()
    }
  }));
});

// Global test timeout
jest.setTimeout(10000);

// Clean up after tests
afterEach(() => {
  jest.clearAllMocks();
});

global.testHelpers = {
  // Helper to create mock user for testing
  createMockUser: () => ({
    id: 'test-user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'customer',
    token: 'mock-jwt-token'
  }),

  // Helper to create mock admin user
  createMockAdmin: () => ({
    id: 'admin-user-123',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    token: 'mock-admin-jwt-token'
  }),

  // Helper to create mock product
  createMockProduct: () => ({
    id: 'product-123',
    name: 'Test Product',
    description: 'A test product',
    price: 29.99,
    category: 'Electronics',
    brand: 'TestBrand',
    sku: 'TEST-SKU-123',
    inventory: 100,
    status: 'active'
  }),

  // Helper to create mock order
  createMockOrder: () => ({
    id: 'order-123',
    orderNumber: 'ORD-123456',
    userId: 'test-user-123',
    status: 'pending',
    items: [
      {
        productId: 'product-123',
        quantity: 2,
        price: 29.99
      }
    ],
    totalAmount: 59.98,
    createdAt: new Date().toISOString()
  })
};