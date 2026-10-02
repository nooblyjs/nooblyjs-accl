/**
 * Unit tests for SeedService
 */

const SeedService = require('../../src/ecommerce/services/seedService');

describe('SeedService', () => {
  let seedService;
  let mockServices;

  beforeEach(() => {
    mockServices = {
      dataServe: {
        jsonFind: jest.fn(),
        jsonFindAll: jest.fn(),
        add: jest.fn(),
        createContainer: jest.fn()
      },
      logger: {
        info: jest.fn(),
        error: jest.fn()
      },
      search: {
        addToIndex: jest.fn()
      }
    };

    seedService = new SeedService(mockServices);
  });

  describe('createAdminUser', () => {
    it('should create admin user successfully', async () => {
      mockServices.dataServe.jsonFind.mockResolvedValue([]);
      mockServices.dataServe.add.mockResolvedValue('admin-id-123');

      await seedService.createAdminUser();

      expect(mockServices.dataServe.add).toHaveBeenCalledWith('users', expect.objectContaining({
        email: 'admin@ecommerce.com',
        role: 'admin',
        isActive: true
      }));
      expect(mockServices.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Admin user created')
      );
    });

    it('should skip creation if admin already exists', async () => {
      mockServices.dataServe.jsonFind.mockResolvedValue([{ id: 'existing-admin' }]);

      await seedService.createAdminUser();

      expect(mockServices.dataServe.add).not.toHaveBeenCalled();
      expect(mockServices.logger.info).toHaveBeenCalledWith(
        'Admin user already exists, skipping creation'
      );
    });
  });

  describe('seedSampleProducts', () => {
    it('should create sample products', async () => {
      mockServices.dataServe.add.mockResolvedValue('product-id-123');

      await seedService.seedSampleProducts();

      expect(mockServices.dataServe.add).toHaveBeenCalled();
      expect(mockServices.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sample products seeded successfully')
      );
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      mockServices.dataServe.add.mockRejectedValue(error);

      await expect(seedService.seedSampleProducts()).rejects.toThrow('Database error');
      expect(mockServices.logger.error).toHaveBeenCalledWith(
        'Error seeding sample products:', error
      );
    });
  });

  describe('seedContent', () => {
    it('should create sample content', async () => {
      mockServices.dataServe.add.mockResolvedValue('content-id-123');

      await seedService.seedContent();

      expect(mockServices.dataServe.add).toHaveBeenCalled();
      expect(mockServices.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sample content seeded successfully')
      );
    });
  });

  describe('getSeedingStatus', () => {
    it('should return seeding status', async () => {
      mockServices.dataServe.jsonFindAll
        .mockResolvedValueOnce([{ id: '1' }, { id: '2' }]) // products
        .mockResolvedValueOnce([{ id: '1' }]) // categories
        .mockResolvedValueOnce([{ id: '1' }]); // users

      const status = await seedService.getSeedingStatus();

      expect(status).toEqual({
        products: 2,
        categories: 1,
        users: 1,
        isSeeded: true
      });
    });
  });
});