/**
 * Delivery Management System - Frontend JavaScript
 * Provides client-side functionality for the delivery dashboard
 */

class DeliveryApp {
    constructor() {
        this.apiBase = '/applications/delivery/api';
        this.init();
    }

    init() {
        console.log('Delivery Management System initialized');
        this.setupWebSocket();
        this.loadNotifications();
    }

    setupWebSocket() {
        // Mock WebSocket connection for real-time updates
        // In a real implementation, this would connect to a WebSocket server
        console.log('WebSocket connection established for real-time updates');

        // Simulate real-time order updates
        setInterval(() => {
            this.simulateOrderUpdate();
        }, 15000);
    }

    simulateOrderUpdate() {
        const updates = [
            'Order #1234 picked up by driver',
            'Order #5678 delivered successfully',
            'New order received from customer',
            'Driver John Doe went online',
            'Order #9012 assigned to driver'
        ];

        const randomUpdate = updates[Math.floor(Math.random() * updates.length)];
        this.addActivityItem(randomUpdate);
    }

    addActivityItem(message) {
        const activityList = document.getElementById('activity-list');
        if (activityList) {
            const item = document.createElement('div');
            item.className = 'activity-item';
            item.innerHTML = `
                <span>${message}</span>
                <span class="activity-time">${new Date().toLocaleTimeString()}</span>
            `;

            // Add to top of list
            const firstChild = activityList.firstChild;
            if (firstChild) {
                activityList.insertBefore(item, firstChild);
            } else {
                activityList.appendChild(item);
            }

            // Keep only last 10 items
            while (activityList.children.length > 10) {
                activityList.removeChild(activityList.lastChild);
            }
        }
    }

    async loadNotifications() {
        try {
            // Load recent notifications/activity
            console.log('Loading notifications...');
        } catch (error) {
            console.error('Failed to load notifications:', error);
        }
    }

    // API Helper methods
    async apiCall(endpoint, options = {}) {
        const url = `${this.apiBase}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const finalOptions = { ...defaultOptions, ...options };

        try {
            const response = await fetch(url, finalOptions);
            return await response.json();
        } catch (error) {
            console.error(`API call failed: ${endpoint}`, error);
            throw error;
        }
    }

    // Order management methods
    async createOrder(orderData) {
        return this.apiCall('/orders', {
            method: 'POST',
            body: JSON.stringify(orderData)
        });
    }

    async getOrder(orderId) {
        return this.apiCall(`/orders/${orderId}`);
    }

    async updateOrderStatus(orderId, status, location = null, notes = null) {
        const data = { status };
        if (location) data.location = location;
        if (notes) data.notes = notes;

        return this.apiCall(`/orders/${orderId}/status`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    async searchOrders(criteria = {}) {
        const params = new URLSearchParams(criteria).toString();
        return this.apiCall(`/orders?${params}`);
    }

    // Driver management methods
    async registerDriver(driverData) {
        return this.apiCall('/drivers', {
            method: 'POST',
            body: JSON.stringify(driverData)
        });
    }

    async getDriver(driverId) {
        return this.apiCall(`/drivers/${driverId}`);
    }

    async updateDriverStatus(driverId, status, location = null) {
        const data = { status };
        if (location) data.location = location;

        return this.apiCall(`/drivers/${driverId}/status`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    async getAvailableDrivers() {
        return this.apiCall('/drivers/available');
    }

    // Tracking methods
    async trackOrder(orderId) {
        return this.apiCall(`/tracking/${orderId}`);
    }

    // Analytics methods
    async getAnalytics() {
        return this.apiCall('/analytics/overview');
    }

    // Notification methods
    async sendNotification(type, recipient, message, data = {}) {
        return this.apiCall('/notifications', {
            method: 'POST',
            body: JSON.stringify({ type, recipient, message, data })
        });
    }

    // Utility methods
    formatStatus(status) {
        const statusMap = {
            'created': 'Created',
            'assigned': 'Assigned',
            'picked_up': 'Picked Up',
            'in_transit': 'In Transit',
            'delivered': 'Delivered',
            'failed': 'Failed',
            'cancelled': 'Cancelled'
        };
        return statusMap[status] || status;
    }

    formatDateTime(timestamp) {
        return new Date(timestamp).toLocaleString();
    }

    showNotification(message, type = 'info') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'error' ? '#ff4757' : '#2ed573'};
            color: white;
            border-radius: 6px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.deliveryApp = new DeliveryApp();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeliveryApp;
}

// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);