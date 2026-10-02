/**
 * NooblyJS Store - shadcn/ui Enhanced JavaScript
 * Native JavaScript with shadcn/ui components
 */

class NooblyStore {
  constructor() {
    this.apiBase = '/applications/ecommerce/api';
    this.currentPage = 'home';
    this.cart = { items: [], sessionId: this.generateSessionId() };
    this.products = [];
    this.categories = [];
    this.filters = {
      category: '',
      sort: 'name',
      search: '',
      page: 1,
      limit: 20
    };
    this.stripe = null;
    this.stripeElements = null;
    this.currentUser = null;

    // Placeholder image as data URI fallback
    this.placeholderImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgMjgwIDIwMCI+CiAgPHJlY3Qgd2lkdGg9IjI4MCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNmOGZhZmMiIHN0cm9rZT0iI2UyZThmMCIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPGcgZmlsbD0iIzk0YTNiOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPgogICAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iODAiIHI9IjIwIiBmaWxsPSIjY2JkNWUxIi8+CiAgICA8cGF0aCBkPSJNMTIwIDEwMCBMMTQwIDgwIEwxNjAgMTAwIEwxODAgODAgTDIwMCAxMDAgTDIwMCAxMjAgTDEyMCAxMjAgWiIgZmlsbD0iI2NiZDVlMSIvPgogICAgPHRleHQgeD0iMTQwIiB5PSIxNTAiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWksIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2NDc0OGIiPgogICAgICBQcm9kdWN0IEltYWdlCiAgICA8L3RleHQ+CiAgPC9nPgo8L3N2Zz4=';
  }

  // Initialize the application
  async init() {
    this.setupEventListeners();
    await this.initializeStripe();
    this.loadInitialData();
    this.loadCart();
    this.updateCartDisplay();
    this.showPage('home');
  }

  // Generate unique session ID
  generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Get placeholder image with fallback
  getPlaceholderImage() {
    // Try the SVG file first, fallback to data URI
    return '/applications/ecommerce/images/placeholder.svg';
  }

  // Handle image loading errors
  handleImageError(imgElement) {
    imgElement.src = this.placeholderImage;
    imgElement.onerror = null; // Prevent infinite loop
  }

  // Setup event listeners with shadcn/ui enhancements
  setupEventListeners() {
    // Search form
    const searchForm = document.getElementById('searchForm');
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = document.getElementById('searchInput').value.trim();
        this.searchProducts(query);
      });
    }

    // Navigation links
    document.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('data-page');
        this.showPage(page);
      });
    });

    // Category filters
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-category]')) {
        e.preventDefault();
        const category = e.target.getAttribute('data-category');
        this.filterByCategory(category);
      }
    });

    // Add to cart buttons
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-action="add-to-cart"]') ||
          e.target.closest('[data-action="add-to-cart"]')) {
        e.preventDefault();
        e.stopPropagation();

        const button = e.target.matches('[data-action="add-to-cart"]') ?
                      e.target : e.target.closest('[data-action="add-to-cart"]');
        const productId = button.getAttribute('data-product-id');

        if (productId) {
          this.addToCart(productId, 1);
        }
      }
    });

    // Product view buttons
    document.addEventListener('click', (e) => {
      const productCard = e.target.closest('[data-action="view-product"]');
      if (productCard) {
        e.preventDefault();
        const productId = productCard.getAttribute('data-product-id');
        console.log('Product card clicked, productId:', productId);
        this.viewProduct(productId);
      }
    });

    // Cart icon click - show cart sidebar
    const cartIcon = document.getElementById('cartIcon');
    if (cartIcon) {
      cartIcon.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleCartSidebar();
      });
    }

    // Cart close button
    const cartClose = document.getElementById('cartClose');
    if (cartClose) {
      cartClose.addEventListener('click', () => {
        this.closeCartSidebar();
      });
    }

    // Cart overlay click
    document.addEventListener('click', (e) => {
      if (e.target.matches('.cart-overlay')) {
        this.closeCartSidebar();
      }
    });

    // Checkout button
    document.addEventListener('click', (e) => {
      if (e.target.matches('#checkoutBtn')) {
        e.preventDefault();
        this.handleCheckout();
      }
    });

    // Modal close handlers
    document.addEventListener('click', (e) => {
      if (e.target.matches('.modal-overlay') || e.target.matches('.modal-close')) {
        this.closeModal();
      }
    });

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
      }
    });
  }

  // Enhanced API request with error handling
  async apiRequest(endpoint, options = {}) {
    try {
      const url = `${this.apiBase}${endpoint}`;
      const config = {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      };

      if (this.currentUser && this.currentUser.token) {
        config.headers.Authorization = `Bearer ${this.currentUser.token}`;
      }

      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      this.showNotification(error.message, 'error');
      throw error;
    }
  }

  // Enhanced notification system with shadcn/ui styling
  showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;

    notification.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="notification-icon">
          ${this.getNotificationIcon(type)}
        </div>
        <div class="notification-message">${message}</div>
        <button class="notification-close ml-auto" onclick="this.parentElement.parentElement.remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    document.body.appendChild(notification);

    // Trigger show animation
    setTimeout(() => notification.classList.add('show'), 100);

    // Auto remove
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }

  getNotificationIcon(type) {
    const icons = {
      success: '<i class="fas fa-check-circle text-green-500"></i>',
      error: '<i class="fas fa-exclamation-circle text-red-500"></i>',
      warning: '<i class="fas fa-exclamation-triangle text-yellow-500"></i>',
      info: '<i class="fas fa-info-circle text-blue-500"></i>'
    };
    return icons[type] || icons.info;
  }

  // Load initial data
  async loadInitialData() {
    try {
      this.showLoading(true);

      const [productsResponse, categoriesResponse] = await Promise.all([
        this.apiRequest('/products'),
        this.apiRequest('/categories')
      ]);

      this.products = productsResponse.products || [];
      this.categories = categoriesResponse.categories || [];

      this.renderCategories();
      this.renderProducts();
      this.renderFeaturedProducts();

    } catch (error) {
      console.error('Error loading initial data:', error);
      this.showNotification('Failed to load store data', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Enhanced product rendering with shadcn/ui cards
  renderProducts(products = this.products) {
    const container = document.getElementById('allProductsGrid');
    if (!container) return;

    if (products.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-12">
          <div class="text-muted-foreground">
            <i class="fas fa-box-open text-4xl mb-4"></i>
            <p class="text-lg">No products found</p>
            <p class="text-sm">Try adjusting your search or filters</p>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = products.map(product => `
      <div class="card product-card" data-action="view-product" data-product-id="${product.id}">
        <div class="card-content p-0">
          <div class="relative">
            <img
              src="${product.images?.[0] || this.getPlaceholderImage()}"
              alt="${product.name}"
              class="product-image"
              loading="lazy"
              onerror="app.handleImageError(this)"
            >
            ${product.salePrice ? `
              <div class="absolute top-2 left-2 badge badge-default">
                Sale
              </div>
            ` : ''}
          </div>

          <div class="product-info">
            <h3 class="product-name">${product.name}</h3>
            <p class="product-description">${product.description?.substring(0, 100)}${product.description?.length > 100 ? '...' : ''}</p>

            <div class="flex items-center justify-between mt-4">
              <div class="flex items-center gap-2">
                ${product.salePrice ? `
                  <span class="product-price">${this.formatPrice(product.salePrice)}</span>
                  <span class="text-sm text-muted-foreground line-through">${this.formatPrice(product.price)}</span>
                ` : `
                  <span class="product-price">${this.formatPrice(product.price)}</span>
                `}
              </div>

              <button
                class="btn btn-primary btn-sm"
                data-action="add-to-cart"
                data-product-id="${product.id}"
                onclick="event.stopPropagation()"
              >
                <i class="fas fa-cart-plus mr-1"></i>
                Add
              </button>
            </div>

            ${product.inventory <= 5 && product.inventory > 0 ? `
              <div class="mt-2">
                <span class="badge badge-outline text-xs">Only ${product.inventory} left</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `).join('');
  }

  // Render featured products on home page
  renderFeaturedProducts() {
    const container = document.getElementById('featuredProducts');
    if (!container || !this.products.length) return;

    const featuredProducts = this.products.slice(0, 8); // Show first 8 products as featured

    container.innerHTML = featuredProducts.map(product => `
      <div class="card product-card" data-action="view-product" data-product-id="${product.id}">
        <div class="card-content p-0">
          <div class="relative">
            <img
              src="${product.images?.[0] || this.getPlaceholderImage()}"
              alt="${product.name}"
              class="product-image"
              loading="lazy"
              onerror="app.handleImageError(this)"
            >
            ${product.salePrice ? `
              <div class="absolute top-2 left-2 badge badge-default">
                Sale
              </div>
            ` : ''}
          </div>

          <div class="product-info">
            <h3 class="product-name">${product.name}</h3>
            <div class="flex items-center justify-between mt-4">
              <div class="flex items-center gap-2">
                ${product.salePrice ? `
                  <span class="product-price">${this.formatPrice(product.salePrice)}</span>
                  <span class="text-sm text-muted-foreground line-through">${this.formatPrice(product.price)}</span>
                ` : `
                  <span class="product-price">${this.formatPrice(product.price)}</span>
                `}
              </div>

              <button
                class="btn btn-primary btn-sm"
                data-action="add-to-cart"
                data-product-id="${product.id}"
                onclick="event.stopPropagation()"
              >
                <i class="fas fa-cart-plus mr-1"></i>
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Enhanced category rendering
  renderCategories() {
    // Render categories navigation
    const navContainer = document.getElementById('categoriesNav');
    if (navContainer && this.categories.length) {
      const categoryButtons = this.categories.map(category => `
        <button
          class="btn btn-ghost btn-sm"
          data-category="${category.name}"
          ${this.filters.category === category.name ? 'aria-pressed="true"' : ''}
        >
          ${category.name}
          ${category.productCount ? `<span class="badge badge-secondary ml-1">${category.productCount}</span>` : ''}
        </button>
      `).join('');

      navContainer.innerHTML = `
        <button
          class="btn btn-ghost btn-sm"
          data-category=""
          ${this.filters.category === '' ? 'aria-pressed="true"' : ''}
        >
          All Products
        </button>
        ${categoryButtons}
      `;
    }

    // Render categories page if we're on that page
    const pageContainer = document.getElementById('allCategoriesList');
    if (pageContainer && this.categories.length) {
      pageContainer.innerHTML = this.categories.map(category => `
        <div class="card category-card" onclick="app.filterByCategory('${category.name}'); app.showPage('products');">
          <div class="card-content">
            <div class="category-icon">
              <i class="fas fa-${this.getCategoryIcon(category.name)}"></i>
            </div>
            <h3 class="category-name">${category.name}</h3>
            <p class="category-description">${category.description || 'Explore our ' + category.name.toLowerCase() + ' collection'}</p>
            <div class="category-stats">
              <span class="product-count">${category.productCount || 0} products</span>
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  // Get category icon
  getCategoryIcon(categoryName) {
    const icons = {
      'Electronics': 'laptop',
      'Clothing': 'tshirt',
      'Home & Garden': 'home',
      'Books': 'book',
      'Sports': 'running',
      'Beauty': 'spray-can',
      'Toys': 'gamepad',
      'Automotive': 'car'
    };
    return icons[categoryName] || 'tag';
  }

  // Render about page content
  renderAboutPage() {
    // About page is static HTML, no dynamic rendering needed
    console.log('About page loaded');
  }

  // Enhanced add to cart with optimistic UI updates
  async addToCart(productId, quantity = 1, variantId = null) {
    try {
      // Find product for immediate feedback
      const product = this.products.find(p => p.id === productId);
      if (!product) {
        throw new Error('Product not found');
      }

      // Check inventory
      if (product.inventory < quantity) {
        throw new Error('Not enough inventory available');
      }

      // Optimistic update
      const existingItem = this.cart.items.find(item =>
        item.productId === productId && item.variantId === variantId
      );

      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        this.cart.items.push({
          productId,
          variantId,
          quantity,
          name: product.name,
          price: product.salePrice || product.price,
          image: product.images?.[0]
        });
      }

      // Update UI immediately
      this.updateCartDisplay();
      this.saveCart();

      // Send to server
      await this.apiRequest('/cart/add', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.cart.sessionId,
          productId,
          variantId,
          quantity
        })
      });

      this.showNotification(`${product.name} added to cart`, 'success');

    } catch (error) {
      // Revert optimistic update on error
      this.loadCart();
      this.updateCartDisplay();
      console.error('Error adding to cart:', error);
      this.showNotification(error.message, 'error');
    }
  }

  // Enhanced cart display with proper totals
  updateCartDisplay() {
    const cartCount = this.cart.items.reduce((total, item) => total + item.quantity, 0);
    const cartTotal = this.cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);

    // Update cart count badges
    const cartCountElements = document.querySelectorAll('[data-cart-count]');
    cartCountElements.forEach(element => {
      element.textContent = cartCount;
      element.style.display = cartCount > 0 ? 'flex' : 'none';
    });

    // Update cart total
    const cartTotalElements = document.querySelectorAll('[data-cart-total]');
    cartTotalElements.forEach(element => {
      element.textContent = this.formatPrice(cartTotal);
    });
  }

  // Format price consistently
  formatPrice(price) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(price);
  }

  // Enhanced loading state
  showLoading(show = true) {
    const loader = document.getElementById('loadingSpinner');
    if (loader) {
      loader.style.display = show ? 'flex' : 'none';
    }

    // Disable interactive elements during loading
    const buttons = document.querySelectorAll('button:not(.loading-immune)');
    buttons.forEach(button => {
      button.disabled = show;
    });
  }

  // Enhanced modal system
  showModal(title, content, actions = '') {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${title}</h2>
          <button class="modal-close btn btn-ghost btn-sm">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-content">
          ${content}
        </div>
        ${actions ? `<div class="modal-footer">${actions}</div>` : ''}
      </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 100);

    return modal;
  }

  closeModal() {
    const modal = document.querySelector('.modal-overlay.show');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => modal.remove(), 200);
    }
  }

  // Enhanced product view with better layout
  async viewProduct(productId) {
    try {
      console.log('viewProduct called with productId:', productId);
      this.showLoading(true);
      const product = await this.apiRequest(`/products/${productId}`);

      const modalContent = `
        <div class="product-modal-content">
          <div class="product-modal-image">
            <img
              src="${product.images?.[0] || this.getPlaceholderImage()}"
              alt="${product.name}"
              class="w-full rounded-lg"
              onerror="app.handleImageError(this)"
            >
          </div>

          <div class="product-modal-details">
            <h1 class="text-2xl font-bold mb-2">${product.name}</h1>

            <div class="product-modal-price mb-4">
              ${product.salePrice ? `
                <span class="text-2xl font-bold text-primary">${this.formatPrice(product.salePrice)}</span>
                <span class="text-lg text-muted-foreground line-through ml-2">${this.formatPrice(product.price)}</span>
                <span class="badge badge-default ml-2">Sale</span>
              ` : `
                <span class="text-2xl font-bold text-primary">${this.formatPrice(product.price)}</span>
              `}
            </div>

            <p class="text-muted-foreground mb-6">${product.description}</p>

            <div class="product-modal-availability mb-6">
              <span class="text-sm font-medium">Availability: </span>
              ${product.inventory > 0 ? `
                <span class="badge badge-outline text-success">In Stock (${product.inventory})</span>
              ` : `
                <span class="badge badge-outline text-destructive">Out of Stock</span>
              `}
            </div>

            <div class="product-modal-actions">
              <button
                class="btn btn-primary w-full"
                data-action="add-to-cart"
                data-product-id="${product.id}"
                ${product.inventory === 0 ? 'disabled' : ''}
              >
                <i class="fas fa-cart-plus mr-2"></i>
                ${product.inventory === 0 ? 'Out of Stock' : 'Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      `;

      this.showModal(product.name, modalContent);

    } catch (error) {
      console.error('Failed to load product details:', error);
      this.showNotification(`Failed to load product details: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Page navigation
  showPage(pageName) {
    // Hide all pages by removing active class
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });

    // Show target page by adding active class
    const targetPage = document.getElementById(`${pageName}Page`);
    if (targetPage) {
      targetPage.classList.add('active');
    }

    // Update navigation links
    document.querySelectorAll('[data-page]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-page') === pageName);
    });

    this.currentPage = pageName;

    // Load page-specific data
    if (pageName === 'products') {
      this.renderProducts();
    } else if (pageName === 'categories') {
      this.renderCategories();
    } else if (pageName === 'about') {
      this.renderAboutPage();
    }
  }

  // Filter and search
  filterByCategory(category) {
    this.filters.category = category;
    let filtered = this.products;

    if (category) {
      filtered = this.products.filter(p => p.category === category);
    }

    this.renderProducts(filtered);

    // Update category button states
    document.querySelectorAll('[data-category]').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-category') === category);
    });
  }

  async searchProducts(query) {
    try {
      this.showLoading(true);
      const response = await this.apiRequest(`/search?q=${encodeURIComponent(query)}`);
      this.renderProducts(response.products || []);
      this.showNotification(`Found ${response.products?.length || 0} products`, 'info');
    } catch (error) {
      console.error('Search failed:', error);
      this.showNotification('Search failed', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Cart sidebar management
  toggleCartSidebar() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('overlay');

    if (sidebar && overlay) {
      const isOpen = sidebar.classList.contains('open');

      if (isOpen) {
        this.closeCartSidebar();
      } else {
        this.openCartSidebar();
      }
    }
  }

  openCartSidebar() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('overlay');

    if (sidebar && overlay) {
      sidebar.classList.add('open');
      overlay.classList.add('show');
      document.body.style.overflow = 'hidden';
      this.renderCartSidebar();
    }
  }

  closeCartSidebar() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('overlay');

    if (sidebar && overlay) {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
      document.body.style.overflow = '';
    }
  }

  // Render cart sidebar content
  renderCartSidebar() {
    const cartContent = document.getElementById('cartContent');
    const cartTotal = document.getElementById('cartTotal');

    if (!cartContent) return;

    if (this.cart.items.length === 0) {
      cartContent.innerHTML = `
        <div class="cart-empty">
          <i class="fas fa-shopping-cart"></i>
          <p>Your cart is empty</p>
          <button class="btn btn-primary" onclick="app.closeCartSidebar()">
            Continue Shopping
          </button>
        </div>
      `;
    } else {
      cartContent.innerHTML = this.cart.items.map(item => `
        <div class="cart-item" data-item-id="${item.productId}">
          <img
            src="${item.image || this.getPlaceholderImage()}"
            alt="${item.name}"
            class="cart-item-image"
            onerror="app.handleImageError(this)"
          >
          <div class="cart-item-details">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-price">${this.formatPrice(item.price)}</div>
            <div class="cart-item-actions">
              <div class="quantity-control">
                <button class="quantity-btn" onclick="app.updateCartItemQuantity('${item.productId}', ${item.quantity - 1})">-</button>
                <input type="number" class="quantity-input" value="${item.quantity}" min="1" readonly>
                <button class="quantity-btn" onclick="app.updateCartItemQuantity('${item.productId}', ${item.quantity + 1})">+</button>
              </div>
              <button class="cart-item-remove" onclick="app.removeFromCart('${item.productId}')" title="Remove item">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `).join('');
    }

    // Update total
    if (cartTotal) {
      const total = this.cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      cartTotal.textContent = this.formatPrice(total);
    }
  }

  // Update cart item quantity
  updateCartItemQuantity(productId, newQuantity) {
    if (newQuantity <= 0) {
      this.removeFromCart(productId);
      return;
    }

    const item = this.cart.items.find(item => item.productId === productId);
    if (item) {
      item.quantity = newQuantity;
      this.saveCart();
      this.updateCartDisplay();
      this.renderCartSidebar();
    }
  }

  // Remove item from cart
  async removeFromCart(productId) {
    try {
      this.cart.items = this.cart.items.filter(item => item.productId !== productId);
      this.saveCart();
      this.updateCartDisplay();
      this.renderCartSidebar();

      // Send to server
      await this.apiRequest('/cart/remove', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.cart.sessionId,
          productId
        })
      });

      this.showNotification('Item removed from cart', 'success');
    } catch (error) {
      console.error('Error removing from cart:', error);
      this.showNotification('Failed to remove item', 'error');
    }
  }

  // Cart management
  saveCart() {
    localStorage.setItem('nooblyjs_cart', JSON.stringify(this.cart));
  }

  loadCart() {
    const savedCart = localStorage.getItem('nooblyjs_cart');
    if (savedCart) {
      try {
        this.cart = JSON.parse(savedCart);
      } catch (error) {
        console.error('Error loading cart:', error);
        this.cart = { items: [], sessionId: this.generateSessionId() };
      }
    }
  }

  // Handle checkout
  handleCheckout() {
    if (this.cart.items.length === 0) {
      this.showNotification('Your cart is empty', 'warning');
      return;
    }

    // For now, show a simple checkout modal
    const total = this.cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const modalContent = `
      <div class="checkout-summary">
        <h3 class="mb-4">Order Summary</h3>

        <div class="checkout-items mb-4">
          ${this.cart.items.map(item => `
            <div class="flex justify-between items-center py-2 border-b">
              <div>
                <span class="font-medium">${item.name}</span>
                <span class="text-muted-foreground ml-2">x${item.quantity}</span>
              </div>
              <span class="font-medium">${this.formatPrice(item.price * item.quantity)}</span>
            </div>
          `).join('')}
        </div>

        <div class="flex justify-between items-center text-lg font-bold border-t pt-4">
          <span>Total:</span>
          <span>${this.formatPrice(total)}</span>
        </div>

        <div class="mt-6">
          <p class="text-muted-foreground text-sm mb-4">
            This is a demo checkout. In a real store, this would integrate with payment processing.
          </p>

          <div class="flex gap-2">
            <button class="btn btn-outline flex-1" onclick="app.closeModal()">
              Continue Shopping
            </button>
            <button class="btn btn-primary flex-1" onclick="app.completeOrder()">
              Place Order
            </button>
          </div>
        </div>
      </div>
    `;

    this.showModal('Checkout', modalContent);
  }

  // Complete order (demo)
  completeOrder() {
    // Clear cart
    this.cart.items = [];
    this.saveCart();
    this.updateCartDisplay();
    this.renderCartSidebar();
    this.closeModal();
    this.closeCartSidebar();

    this.showNotification('Order placed successfully! (Demo)', 'success', 8000);
  }

  // Stripe integration placeholder
  async initializeStripe() {
    try {
      // Initialize Stripe if needed
      if (window.Stripe) {
        const config = await this.apiRequest('/payments/config');
        this.stripe = Stripe(config.publishableKey);
      }
    } catch (error) {
      console.warn('Stripe initialization failed:', error);
    }
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new NooblyStore();
  app.init();
});