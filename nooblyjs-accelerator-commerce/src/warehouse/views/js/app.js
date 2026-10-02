/**
 * Warehouse Management System Dashboard Application
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

class WarehouseDashboard {
    constructor() {
        this.baseUrl = '/applications/warehouse/api';
        this.currentSection = 'dashboard';
        this.loadingModal = null;

        this.init();
    }

    async init() {
        console.log('Initializing Warehouse Management System Dashboard...');

        // Initialize custom modal components
        this.initializeModals();

        // Set up event listeners
        this.setupEventListeners();

        // Check system health
        await this.checkSystemHealth();

        // Load initial dashboard data
        await this.loadDashboardData();

        console.log('Dashboard initialized successfully');
    }

    // Initialize custom modal components
    initializeModals() {
        // Create loading modal if it doesn't exist
        if (!document.getElementById('loadingModal')) {
            this.createLoadingModal();
        }

        // Set up modal close handlers
        this.setupModalHandlers();
    }

    // Create loading modal dynamically
    createLoadingModal() {
        const modalHtml = `
            <div class="modal-overlay hidden" id="loadingModal">
                <div class="modal">
                    <div class="modal-content">
                        <div class="loading-spinner">
                            <div class="spinner"></div>
                        </div>
                        <p id="loading-message">Loading...</p>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // Set up modal event handlers
    setupModalHandlers() {
        // Close modals when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeModal(e.target.id);
            }
        });

        // Close modals with escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
    }

    // Custom modal methods
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    closeAllModals() {
        const modals = document.querySelectorAll('.modal-overlay');
        modals.forEach(modal => {
            modal.classList.add('hidden');
        });
        document.body.style.overflow = '';
    }

    // Create the warehouse dashboard UI
    createWarehouseUI() {
        console.log('Creating warehouse dashboard UI...');

        const warehouseHTML = `
            <div class="main-container">
                <!-- Sidebar -->
                <nav class="sidebar" id="sidebar">
                    <div class="sidebar-header">
                        <div class="logo">
                            <i class="fas fa-warehouse"></i>
                            <span>Warehouse WMS</span>
                        </div>
                    </div>

                    <div class="sidebar-menu">
                        <div class="menu-section">
                            <h3>Dashboard</h3>
                            <a href="#" class="menu-item active" data-section="dashboard">
                                <i class="fas fa-chart-line"></i>
                                <span>Overview</span>
                            </a>
                        </div>

                        <div class="menu-section">
                            <h3>Operations</h3>
                            <a href="#" class="menu-item" data-section="inventory">
                                <i class="fas fa-boxes"></i>
                                <span>Inventory</span>
                            </a>
                            <a href="#" class="menu-item" data-section="inbound">
                                <i class="fas fa-truck-loading"></i>
                                <span>Inbound</span>
                            </a>
                            <a href="#" class="menu-item" data-section="outbound">
                                <i class="fas fa-shipping-fast"></i>
                                <span>Outbound</span>
                            </a>
                        </div>

                        <div class="menu-section">
                            <h3>Management</h3>
                            <a href="#" class="menu-item" data-section="resources">
                                <i class="fas fa-users-cog"></i>
                                <span>Resources</span>
                            </a>
                            <a href="#" class="menu-item" data-section="reports">
                                <i class="fas fa-chart-bar"></i>
                                <span>Reports</span>
                            </a>
                        </div>
                    </div>
                </nav>

                <!-- Main Content -->
                <main class="main-content">
                    <header class="header">
                        <div class="header-left">
                            <h1 id="pageTitle">Warehouse Dashboard</h1>
                        </div>
                        <div class="header-right">
                            <div class="header-actions">
                                <span id="system-status" class="badge badge-warning">
                                    <i class="fas fa-circle"></i> Initializing...
                                </span>
                                <button class="header-btn" id="refreshBtn" title="Refresh Data">
                                    <i class="fas fa-sync-alt"></i>
                                </button>
                            </div>
                        </div>
                    </header>

                    <div class="page-content">
                        <!-- Dashboard Section -->
                        <div id="dashboard-section" class="content-section active">
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-icon">
                                        <i class="fas fa-boxes"></i>
                                    </div>
                                    <div class="stat-content">
                                        <h3 id="total-products">0</h3>
                                        <p>Total Products</p>
                                    </div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-icon">
                                        <i class="fas fa-truck-loading"></i>
                                    </div>
                                    <div class="stat-content">
                                        <h3 id="active-shipments">0</h3>
                                        <p>Active Shipments</p>
                                    </div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-icon">
                                        <i class="fas fa-exclamation-triangle"></i>
                                    </div>
                                    <div class="stat-content">
                                        <h3 id="low-stock-alerts">0</h3>
                                        <p>Low Stock Alerts</p>
                                    </div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-icon">
                                        <i class="fas fa-users"></i>
                                    </div>
                                    <div class="stat-content">
                                        <h3 id="active-staff">0</h3>
                                        <p>Active Staff</p>
                                    </div>
                                </div>
                            </div>

                            <div class="dashboard-grid">
                                <div class="dashboard-card">
                                    <div class="card-header">
                                        <h3>Recent Activities</h3>
                                    </div>
                                    <div class="card-content">
                                        <div id="recent-activities">
                                            <p class="text-muted">Loading activities...</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="dashboard-card">
                                    <div class="card-header">
                                        <h3>System Status</h3>
                                    </div>
                                    <div class="card-content">
                                        <div id="system-info">
                                            <p class="text-muted">Loading system information...</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Other sections would go here -->
                        <div id="inventory-section" class="content-section">
                            <h2>Inventory Management</h2>
                            <p>Inventory management features coming soon...</p>
                        </div>

                        <div id="inbound-section" class="content-section">
                            <h2>Inbound Operations</h2>
                            <p>Inbound operations features coming soon...</p>
                        </div>

                        <div id="outbound-section" class="content-section">
                            <h2>Outbound Operations</h2>
                            <p>Outbound operations features coming soon...</p>
                        </div>

                        <div id="resources-section" class="content-section">
                            <h2>Resource Management</h2>
                            <p>Resource management features coming soon...</p>
                        </div>

                        <div id="reports-section" class="content-section">
                            <h2>Reports & Analytics</h2>
                            <p>Reports and analytics features coming soon...</p>
                        </div>
                    </div>
                </main>
            </div>
        `;

        // Replace body content with warehouse UI
        document.body.innerHTML = warehouseHTML;

        // Re-initialize after creating UI
        this.setupEventListeners();

        // Retry health check now that UI exists
        setTimeout(() => this.checkSystemHealth(), 100);
    }

    setupEventListeners() {
        // Sidebar navigation
        document.querySelectorAll('[data-section]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.closest('[data-section]').dataset.section;
                this.showSection(section);
            });
        });

        // Search functionality
        const productSearch = document.getElementById('product-search');
        if (productSearch) {
            productSearch.addEventListener('input', (e) => {
                this.searchProducts(e.target.value);
            });
        }
    }

    showSection(sectionName) {
        // Update navigation
        document.querySelectorAll('.menu-item').forEach(link => {
            link.classList.remove('active');
        });

        const activeNavLink = document.querySelector(`[data-section="${sectionName}"]`);
        if (activeNavLink) {
            activeNavLink.classList.add('active');
        }

        // Update content
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            inventory: 'Inventory Management',
            inbound: 'Inbound Operations',
            outbound: 'Outbound Operations',
            resources: 'Resource Management',
            delivery: 'Delivery & Fulfillment',
            reports: 'Analytics & Reports'
        };

        const pageTitle = document.getElementById('pageTitle');
        if (pageTitle) {
            pageTitle.textContent = titles[sectionName] || 'Dashboard';
        }

        this.currentSection = sectionName;

        // Load section-specific data
        this.loadSectionData(sectionName);
    }

    async loadSectionData(section) {
        switch (section) {
            case 'dashboard':
                await this.loadDashboardData();
                break;
            case 'inventory':
                await this.loadInventoryData();
                break;
            case 'inbound':
                await this.loadInboundData();
                break;
            case 'outbound':
                await this.loadOutboundData();
                break;
            case 'resources':
                await this.loadResourcesData();
                break;
            case 'delivery':
                await this.loadDeliveryData();
                break;
            case 'reports':
                await this.loadReportsData();
                break;
        }
    }

    async checkSystemHealth() {
        try {
            const response = await this.apiCall('/health');
            const statusElement = document.getElementById('system-status');

            if (statusElement) {
                if (response.status === 'healthy') {
                    statusElement.className = 'badge badge-success';
                    statusElement.innerHTML = '<i class="fas fa-circle"></i> System Online';
                } else {
                    statusElement.className = 'badge badge-danger';
                    statusElement.innerHTML = '<i class="fas fa-circle"></i> System Issues';
                }
            } else {
                console.log('System status element not found, creating UI...');
                this.createWarehouseUI();
            }
        } catch (error) {
            console.error('Health check failed:', error);
            const statusElement = document.getElementById('system-status');

            if (statusElement) {
                statusElement.className = 'badge badge-warning';
                statusElement.innerHTML = '<i class="fas fa-circle"></i> System Unknown';
            } else {
                console.log('System status element not found, creating UI...');
                this.createWarehouseUI();
            }
        }
    }

    async loadDashboardData() {
        try {
            // Simulate dashboard metrics (in real implementation, these would be API calls)
            this.updateDashboardMetrics({
                totalProducts: Math.floor(Math.random() * 1000) + 500,
                activeOrders: Math.floor(Math.random() * 50) + 10,
                staffOnline: Math.floor(Math.random() * 20) + 5,
                shipmentsToday: Math.floor(Math.random() * 30) + 8
            });

            this.addRecentActivity('Dashboard loaded successfully', 'success');
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
            this.showAlert('Failed to load dashboard data', 'danger');
        }
    }

    updateDashboardMetrics(metrics) {
        const updateElement = (id, value) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        };

        updateElement('total-products', metrics.totalProducts || 0);
        updateElement('active-shipments', metrics.activeOrders || 0);
        updateElement('active-staff', metrics.staffOnline || 0);
        updateElement('low-stock-alerts', metrics.shipmentsToday || 0);
    }

    async loadInventoryData() {
        const tbody = document.getElementById('inventory-tbody');
        if (!tbody) return;

        try {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner-border" role="status"></div></td></tr>';

            // Simulate inventory data
            const inventoryData = [
                { sku: 'PROD001', name: 'Widget A', category: 'Electronics', available: 150, allocated: 25, status: 'Active' },
                { sku: 'PROD002', name: 'Component B', category: 'Hardware', available: 75, allocated: 10, status: 'Active' },
                { sku: 'PROD003', name: 'Device C', category: 'Electronics', available: 0, allocated: 0, status: 'Out of Stock' }
            ];

            tbody.innerHTML = inventoryData.map(item => `
                <tr>
                    <td><strong>${item.sku}</strong></td>
                    <td>${item.name}</td>
                    <td>${item.category}</td>
                    <td><span class="badge bg-success">${item.available}</span></td>
                    <td><span class="badge bg-warning">${item.allocated}</span></td>
                    <td>
                        <span class="badge ${item.status === 'Active' ? 'bg-success' : 'bg-danger'}">
                            ${item.status}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="dashboard.viewProduct('${item.sku}')">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="dashboard.editProduct('${item.sku}')">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            console.error('Failed to load inventory data:', error);
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Failed to load inventory data</td></tr>';
        }
    }

    async loadInboundData() {
        const poList = document.getElementById('purchase-orders-list');
        const receivingList = document.getElementById('receiving-tasks-list');

        if (poList) {
            poList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">PO-2024-001</h6>
                            <small class="text-success">Confirmed</small>
                        </div>
                        <p class="mb-1">Electronics Supplier - 150 items</p>
                        <small>Expected: Tomorrow</small>
                    </div>
                </div>
            `;
        }

        if (receivingList) {
            receivingList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Receive PO-2024-001</h6>
                            <small class="text-warning">Pending</small>
                        </div>
                        <p class="mb-1">Dock Door 3</p>
                        <small>Assigned to: John Doe</small>
                    </div>
                </div>
            `;
        }
    }

    async loadOutboundData() {
        const ordersList = document.getElementById('orders-list');
        const wavesList = document.getElementById('waves-list');
        const pickTasksList = document.getElementById('pick-tasks-list');

        if (ordersList) {
            ordersList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">ORD-2024-001</h6>
                            <small class="text-success">Allocated</small>
                        </div>
                        <p class="mb-1">Customer ABC - 5 items</p>
                        <small>Priority: High</small>
                    </div>
                </div>
            `;
        }

        if (wavesList) {
            wavesList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">WAVE-001</h6>
                            <small class="text-info">Picking</small>
                        </div>
                        <p class="mb-1">15 orders, 45 items</p>
                        <small>Started: 2 hours ago</small>
                    </div>
                </div>
            `;
        }

        if (pickTasksList) {
            pickTasksList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Pick: PROD001</h6>
                            <small class="text-warning">In Progress</small>
                        </div>
                        <p class="mb-1">Location: A-01-B-03</p>
                        <small>Assigned to: Jane Smith</small>
                    </div>
                </div>
            `;
        }
    }

    async loadResourcesData() {
        const staffList = document.getElementById('staff-list');
        const equipmentList = document.getElementById('equipment-list');

        if (staffList) {
            staffList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">John Doe</h6>
                            <span class="badge bg-success">Online</span>
                        </div>
                        <p class="mb-1">Picker - Morning Shift</p>
                        <small>Current task: Pick items for WAVE-001</small>
                    </div>
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Jane Smith</h6>
                            <span class="badge bg-success">Online</span>
                        </div>
                        <p class="mb-1">Packer - Morning Shift</p>
                        <small>Current task: Pack orders</small>
                    </div>
                </div>
            `;
        }

        if (equipmentList) {
            equipmentList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Forklift-001</h6>
                            <span class="badge bg-warning">In Use</span>
                        </div>
                        <p class="mb-1">Toyota Model XYZ</p>
                        <small>Assigned to: Mike Johnson</small>
                    </div>
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Scanner-001</h6>
                            <span class="badge bg-success">Available</span>
                        </div>
                        <p class="mb-1">Honeywell Scanner</p>
                        <small>Last used: 1 hour ago</small>
                    </div>
                </div>
            `;
        }
    }

    async loadDeliveryData() {
        const shipmentsList = document.getElementById('shipments-list');
        const returnsList = document.getElementById('returns-list');

        if (shipmentsList) {
            shipmentsList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">SHIP-2024-001</h6>
                            <span class="badge bg-info">In Transit</span>
                        </div>
                        <p class="mb-1">UPS - Tracking: 1Z123456</p>
                        <small>ETA: Tomorrow 2:00 PM</small>
                    </div>
                </div>
            `;
        }

        if (returnsList) {
            returnsList.innerHTML = `
                <div class="list-group">
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">RMA-2024-001</h6>
                            <span class="badge bg-warning">Pending</span>
                        </div>
                        <p class="mb-1">Product: Widget A</p>
                        <small>Reason: Defective</small>
                    </div>
                </div>
            `;
        }
    }

    async loadReportsData() {
        // Reports data is loaded on demand when user clicks generate report buttons
        const reportResults = document.getElementById('report-results');
        if (reportResults) {
            reportResults.innerHTML = '<p class="text-muted">Select a report type above to generate analytics</p>';
        }
    }

    async generateReport(reportType) {
        const reportResults = document.getElementById('report-results');
        if (!reportResults) return;

        this.showLoading('Generating report...');

        try {
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 2000));

            let reportHtml = '';

            switch (reportType) {
                case 'staff-performance':
                    reportHtml = this.generateStaffPerformanceReport();
                    break;
                case 'equipment-utilization':
                    reportHtml = this.generateEquipmentUtilizationReport();
                    break;
                case 'delivery-performance':
                    reportHtml = this.generateDeliveryPerformanceReport();
                    break;
            }

            reportResults.innerHTML = reportHtml;
            this.addRecentActivity(`Generated ${reportType} report`, 'info');

        } catch (error) {
            console.error('Failed to generate report:', error);
            reportResults.innerHTML = '<p class="text-danger">Failed to generate report. Please try again.</p>';
        } finally {
            this.hideLoading();
        }
    }

    generateStaffPerformanceReport() {
        return `
            <h6>Staff Performance Report</h6>
            <div class="table-responsive">
                <table class="table table-striped report-table">
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Tasks Completed</th>
                            <th>Avg Task Time</th>
                            <th>Quality Score</th>
                            <th>Efficiency</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>John Doe</td>
                            <td>125</td>
                            <td>18 min</td>
                            <td><span class="badge bg-success">95%</span></td>
                            <td><span class="badge bg-success">110%</span></td>
                        </tr>
                        <tr>
                            <td>Jane Smith</td>
                            <td>98</td>
                            <td>22 min</td>
                            <td><span class="badge bg-success">92%</span></td>
                            <td><span class="badge bg-warning">85%</span></td>
                        </tr>
                        <tr>
                            <td>Mike Johnson</td>
                            <td>87</td>
                            <td>25 min</td>
                            <td><span class="badge bg-warning">88%</span></td>
                            <td><span class="badge bg-warning">75%</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    generateEquipmentUtilizationReport() {
        return `
            <h6>Equipment Utilization Report</h6>
            <div class="table-responsive">
                <table class="table table-striped report-table">
                    <thead>
                        <tr>
                            <th>Equipment</th>
                            <th>Type</th>
                            <th>Utilization</th>
                            <th>Status</th>
                            <th>Last Service</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Forklift-001</td>
                            <td>Forklift</td>
                            <td><span class="badge bg-success">85%</span></td>
                            <td><span class="badge bg-success">Active</span></td>
                            <td>2024-01-15</td>
                        </tr>
                        <tr>
                            <td>Scanner-001</td>
                            <td>Barcode Scanner</td>
                            <td><span class="badge bg-warning">65%</span></td>
                            <td><span class="badge bg-success">Active</span></td>
                            <td>2024-02-01</td>
                        </tr>
                        <tr>
                            <td>Conveyor-001</td>
                            <td>Conveyor Belt</td>
                            <td><span class="badge bg-success">92%</span></td>
                            <td><span class="badge bg-warning">Maintenance</span></td>
                            <td>2024-01-10</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    generateDeliveryPerformanceReport() {
        return `
            <h6>Delivery Performance Report</h6>
            <div class="row">
                <div class="col-md-6">
                    <div class="card">
                        <div class="card-body text-center">
                            <h3 class="text-success">94.5%</h3>
                            <p>On-Time Delivery Rate</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card">
                        <div class="card-body text-center">
                            <h3 class="text-info">2.1 days</h3>
                            <p>Average Transit Time</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="table-responsive mt-3">
                <table class="table table-striped report-table">
                    <thead>
                        <tr>
                            <th>Carrier</th>
                            <th>Shipments</th>
                            <th>On-Time Rate</th>
                            <th>Avg Transit</th>
                            <th>Exception Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>UPS</td>
                            <td>150</td>
                            <td><span class="badge bg-success">96%</span></td>
                            <td>2.0 days</td>
                            <td><span class="badge bg-success">2%</span></td>
                        </tr>
                        <tr>
                            <td>FedEx</td>
                            <td>120</td>
                            <td><span class="badge bg-success">93%</span></td>
                            <td>2.2 days</td>
                            <td><span class="badge bg-warning">4%</span></td>
                        </tr>
                        <tr>
                            <td>USPS</td>
                            <td>80</td>
                            <td><span class="badge bg-warning">89%</span></td>
                            <td>2.8 days</td>
                            <td><span class="badge bg-warning">6%</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    // Utility methods
    async apiCall(endpoint, options = {}) {
        const url = this.baseUrl + endpoint;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const response = await fetch(url, { ...defaultOptions, ...options });

        if (!response.ok) {
            throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    showLoading(message = 'Loading...') {
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.textContent = message;
        }
        this.showModal('loadingModal');
    }

    hideLoading() {
        this.closeModal('loadingModal');
    }

    showAlert(message, type = 'info') {
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;

        // Add to top of main content
        const mainContent = document.querySelector('#main-content .container-fluid');
        mainContent.insertAdjacentHTML('afterbegin', alertHtml);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            const alert = mainContent.querySelector('.alert');
            if (alert) {
                alert.remove();
            }
        }, 5000);
    }

    addRecentActivity(message, type = 'info') {
        const activityList = document.getElementById('recent-activity');
        if (!activityList) return;

        const iconClass = {
            'success': 'fas fa-check-circle text-success',
            'info': 'fas fa-info-circle text-info',
            'warning': 'fas fa-exclamation-triangle text-warning',
            'danger': 'fas fa-times-circle text-danger'
        };

        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        activityItem.innerHTML = `
            <i class="${iconClass[type] || iconClass.info}"></i>
            <span>${message}</span>
            <small class="text-muted">Just now</small>
        `;

        activityList.insertBefore(activityItem, activityList.firstChild);

        // Keep only last 10 activities
        const activities = activityList.querySelectorAll('.activity-item');
        if (activities.length > 10) {
            activities[activities.length - 1].remove();
        }
    }

    // Product management methods
    async addProduct() {
        const form = document.getElementById('addProductForm');
        const formData = new FormData(form);

        const productData = {
            sku: formData.get('sku'),
            name: formData.get('name'),
            description: formData.get('description'),
            category: formData.get('category')
        };

        this.showLoading('Adding product...');

        try {
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 1500));

            this.addRecentActivity(`Product ${productData.sku} added successfully`, 'success');
            this.showAlert('Product added successfully!', 'success');

            // Close modal and refresh inventory
            this.closeModal('addProductModal');
            form.reset();

            if (this.currentSection === 'inventory') {
                await this.loadInventoryData();
            }

        } catch (error) {
            console.error('Failed to add product:', error);
            this.showAlert('Failed to add product. Please try again.', 'danger');
        } finally {
            this.hideLoading();
        }
    }

    searchProducts(query) {
        const tbody = document.getElementById('inventory-tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(query.toLowerCase()) || query === '') {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    viewProduct(sku) {
        this.showAlert(`Viewing product: ${sku}`, 'info');
    }

    editProduct(sku) {
        this.showAlert(`Editing product: ${sku}`, 'info');
    }
}

// Global functions for onclick handlers
window.showSection = function(section) {
    if (window.dashboard) {
        window.dashboard.showSection(section);
    }
};

window.generateReport = function(reportType) {
    if (window.dashboard) {
        window.dashboard.generateReport(reportType);
    }
};

window.addProduct = function() {
    if (window.dashboard) {
        window.dashboard.addProduct();
    }
};

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.dashboard = new WarehouseDashboard();
});