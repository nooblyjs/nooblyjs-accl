/**
 * Unit tests for JobProcessor
 */

const JobProcessor = require('../../src/ecommerce/services/jobProcessor');

describe('JobProcessor', () => {
  let jobProcessor;
  let mockServices;

  beforeEach(() => {
    mockServices = {
      queue: {
        enqueue: jest.fn(),
        dequeue: jest.fn()
      },
      dataServe: {
        jsonFindById: jest.fn(),
        add: jest.fn(),
        remove: jest.fn(),
        jsonFindByPath: jest.fn()
      },
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
      },
      notifying: {
        notify: jest.fn()
      },
      workflow: {
        startWorkflow: jest.fn()
      }
    };

    jobProcessor = new JobProcessor(mockServices);
  });

  describe('addJob', () => {
    it('should add job to queue', async () => {
      mockServices.queue.enqueue.mockResolvedValue();

      const jobId = await jobProcessor.addJob('test_job', { data: 'test' });

      expect(mockServices.queue.enqueue).toHaveBeenCalledWith(
        'ecommerce_jobs',
        expect.objectContaining({
          type: 'test_job',
          data: { data: 'test' },
          priority: 5,
          retries: 3
        })
      );
      expect(jobId).toBeDefined();
    });

    it('should handle queue errors', async () => {
      const error = new Error('Queue error');
      mockServices.queue.enqueue.mockRejectedValue(error);

      await expect(jobProcessor.addJob('test_job', {})).rejects.toThrow('Queue error');
    });
  });

  describe('handleOrderFulfillment', () => {
    it('should process order fulfillment', async () => {
      const mockOrder = global.testHelpers.createMockOrder();
      mockServices.dataServe.jsonFindById.mockResolvedValue(mockOrder);
      mockServices.dataServe.remove.mockResolvedValue();
      mockServices.dataServe.add.mockResolvedValue('updated-order-id');
      mockServices.workflow.startWorkflow.mockResolvedValue();

      await jobProcessor.handleOrderFulfillment({ orderId: 'order-123' });

      expect(mockServices.workflow.startWorkflow).toHaveBeenCalledWith(
        'order_fulfillment',
        expect.objectContaining({
          orderId: 'order-123',
          orderNumber: mockOrder.orderNumber
        })
      );
      expect(mockServices.dataServe.add).toHaveBeenCalledWith(
        'orders',
        expect.objectContaining({
          status: 'fulfilling'
        })
      );
    });

    it('should handle missing order', async () => {
      mockServices.dataServe.jsonFindById.mockResolvedValue(null);

      await expect(
        jobProcessor.handleOrderFulfillment({ orderId: 'missing-order' })
      ).rejects.toThrow('Order not found: missing-order');
    });
  });

  describe('handleInventoryUpdate', () => {
    it('should update existing inventory', async () => {
      const mockInventory = {
        id: 'inv-123',
        productId: 'product-123',
        quantity: 100,
        reserved: 10,
        available: 90,
        lowStockThreshold: 10
      };

      mockServices.dataServe.jsonFindByPath.mockResolvedValue([mockInventory]);
      mockServices.dataServe.remove.mockResolvedValue();
      mockServices.dataServe.add.mockResolvedValue('updated-inv-id');

      await jobProcessor.handleInventoryUpdate({
        productId: 'product-123',
        quantity: 5,
        operation: 'subtract'
      });

      expect(mockServices.dataServe.add).toHaveBeenCalledWith(
        'inventory',
        expect.objectContaining({
          quantity: 95,
          available: 85
        })
      );
    });

    it('should create new inventory record if none exists', async () => {
      mockServices.dataServe.jsonFindByPath.mockResolvedValue([]);
      mockServices.dataServe.add.mockResolvedValue('new-inv-id');

      await jobProcessor.handleInventoryUpdate({
        productId: 'product-456',
        quantity: 50,
        operation: 'add'
      });

      expect(mockServices.dataServe.add).toHaveBeenCalledWith(
        'inventory',
        expect.objectContaining({
          productId: 'product-456',
          quantity: 50,
          available: 50
        })
      );
    });
  });

  describe('handleSendNotification', () => {
    it('should send notification', async () => {
      mockServices.notifying.notify.mockResolvedValue();

      await jobProcessor.handleSendNotification({
        type: 'test_notification',
        message: 'Test message'
      });

      expect(mockServices.notifying.notify).toHaveBeenCalledWith(
        'ecommerce_notifications',
        expect.objectContaining({
          type: 'test_notification',
          data: { message: 'Test message' }
        })
      );
    });
  });

  describe('generateJobId', () => {
    it('should generate unique job ID', () => {
      const jobId1 = jobProcessor.generateJobId();
      const jobId2 = jobProcessor.generateJobId();

      expect(jobId1).toMatch(/^job_\d+_[a-z0-9]+$/);
      expect(jobId2).toMatch(/^job_\d+_[a-z0-9]+$/);
      expect(jobId1).not.toBe(jobId2);
    });
  });

  describe('generateTrackingNumber', () => {
    it('should generate tracking number', () => {
      const trackingNumber = jobProcessor.generateTrackingNumber();

      expect(trackingNumber).toMatch(/^TN\d{6}[A-Z0-9]{6}$/);
    });
  });
});