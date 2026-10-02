/**
 * NooblyJS Store - Frontend JavaScript
 * Handles all client-side functionality for the eCommerce application
 */

class NooblyStore {
  constructor() {
    this.apiBase = '/applications/ecommerce/api';
    this.currentUser = null;
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

    // Stripe integration
    this.stripe = null;
    this.stripeElements = null;
    this.paymentElement = null;
    this.clientSecret = null;

    this.init();
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

  // Initialize Stripe
  async initializeStripe() {
    try {
      const response = await fetch(`${this.apiBase}/payments/config`);
      const config = await response.json();

      if (window.Stripe && config.publishableKey) {
        this.stripe = Stripe(config.publishableKey);
      }
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
    }
  }

  // Generate unique session ID
  generateSessionId() {
    return localStorage.getItem('sessionId') || this.createNewSessionId();
  }

  createNewSessionId() {
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('sessionId', sessionId);
    return sessionId;
  }

  // Setup all event listeners
  setupEventListeners() {
    // Navigation
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-page]')) {
        e.preventDefault();
        const page = e.target.getAttribute('data-page');
        this.showPage(page);
        this.updateActiveNavLinks(e.target);
      }

      if (e.target.matches('[data-action]')) {
        e.preventDefault();
        const action = e.target.getAttribute('data-action');
        this.handleAction(action, e.target);
      }
    });

    // Search form
    const searchForm = document.getElementById('searchForm');
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = document.getElementById('searchInput').value.trim();
        if (query) {
          this.searchProducts(query);
        }
      });
    }

    // Mobile menu toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenuToggle && mobileMenu) {
      mobileMenuToggle.addEventListener('click', () => {
        mobileMenu.classList.toggle('active');
      });
    }

    // Cart controls
    const cartBtn = document.getElementById('cartBtn');
    const cartClose = document.getElementById('cartClose');
    const cartSidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('overlay');

    if (cartBtn) {
      cartBtn.addEventListener('click', () => this.openCart());
    }

    if (cartClose) {
      cartClose.addEventListener('click', () => this.closeCart());
    }

    if (overlay) {
      overlay.addEventListener('click', () => {
        this.closeCart();
        this.closeAuthModal();
      });
    }

    // Auth modal controls
    const userBtn = document.getElementById('userBtn');
    const authModalClose = document.getElementById('authModalClose');

    if (userBtn) {
      userBtn.addEventListener('click', () => this.openAuthModal());
    }

    if (authModalClose) {
      authModalClose.addEventListener('click', () => this.closeAuthModal());
    }

    // Auth tabs
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-tab]')) {
        const tab = e.target.getAttribute('data-tab');
        this.switchAuthTab(tab);
      }
    });

    // Auth forms
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLogin(e.target);
      });
    }

    if (registerForm) {
      registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleRegister(e.target);
      });
    }

    // Filter controls
    const categoryFilter = document.getElementById('categoryFilter');
    const sortFilter = document.getElementById('sortFilter');

    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
        this.filters.category = e.target.value;
        this.filters.page = 1;
        this.loadProducts();
      });
    }

    if (sortFilter) {
      sortFilter.addEventListener('change', (e) => {
        this.filters.sort = e.target.value;
        this.filters.page = 1;
        this.loadProducts();
      });
    }

    // View controls
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-view]')) {
        const view = e.target.getAttribute('data-view');
        this.switchProductView(view);
      }
    });

    // Checkout button
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => this.handleCheckout());
    }

    // Checkout modal controls
    const checkoutModalClose = document.getElementById('checkoutModalClose');
    const cancelCheckout = document.getElementById('cancelCheckout');
    const paymentForm = document.getElementById('paymentForm');

    if (checkoutModalClose) {
      checkoutModalClose.addEventListener('click', () => this.closeCheckoutModal());
    }

    if (cancelCheckout) {
      cancelCheckout.addEventListener('click', () => this.closeCheckoutModal());
    }

    if (paymentForm) {
      paymentForm.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }

    // Update overlay click to close checkout modal too
    if (overlay) {
      overlay.addEventListener('click', () => {
        this.closeCart();
        this.closeAuthModal();
        this.closeCheckoutModal();
      });
    }
  }

  // API request helper
  async apiRequest(endpoint, options = {}) {
    try {
      this.showLoading();

      const url = `${this.apiBase}${endpoint}`;
      const config = {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      };

      // Add auth token if available
      if (this.currentUser && this.currentUser.token) {
        config.headers.Authorization = `Bearer ${this.currentUser.token}`;
      }

      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      this.showNotification(error.message, 'error');
      throw error;
    } finally {
      this.hideLoading();
    }
  }

  // Load initial data
  async loadInitialData() {
    try {
      await Promise.all([
        this.loadCategories(),
        this.loadFeaturedProducts()
      ]);
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }

  // Load categories
  async loadCategories() {
    try {
      const response = await this.apiRequest('/categories');
      this.categories = response.categories || [];
      this.renderCategories();
      this.populateCategoryFilter();
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }

  // Load featured products
  async loadFeaturedProducts() {
    try {
      const response = await this.apiRequest('/products?limit=8');
      const featuredProducts = response.products || [];
      this.renderFeaturedProducts(featuredProducts);
    } catch (error) {
      console.error('Failed to load featured products:', error);
    }
  }

  // Load all products with filters
  async loadProducts() {
    try {
      const params = new URLSearchParams();
      if (this.filters.category) params.append('category', this.filters.category);
      if (this.filters.search) params.append('search', this.filters.search);
      params.append('page', this.filters.page);
      params.append('limit', this.filters.limit);

      // Handle sorting
      if (this.filters.sort === 'price-low') {
        params.append('minPrice', '0');
        // Sort by price ascending will be handled by backend
      } else if (this.filters.sort === 'price-high') {
        params.append('maxPrice', '10000');
        // Sort by price descending will be handled by backend
      }

      const response = await this.apiRequest(`/products?${params.toString()}`);
      this.products = response.products || [];

      this.renderAllProducts(this.products);
      this.renderPagination(response.pagination);
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }

  // Search products
  async searchProducts(query) {
    try {
      this.filters.search = query;
      this.filters.page = 1;
      this.showPage('products');
      await this.loadProducts();
    } catch (error) {
      console.error('Search failed:', error);
    }
  }

  // Navigation functions
  showPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });

    // Show target page
    const targetPage = document.getElementById(`${pageName}Page`);
    if (targetPage) {
      targetPage.classList.add('active');
      this.currentPage = pageName;

      // Load page-specific data
      if (pageName === 'products' && this.products.length === 0) {
        this.loadProducts();
      } else if (pageName === 'categories' && this.categories.length === 0) {
        this.loadCategories();
      }
    }
  }

  updateActiveNavLinks(activeLink) {
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => {
      link.classList.remove('active');
    });
    activeLink.classList.add('active');
  }

  // Handle various actions
  handleAction(action, element) {
    switch (action) {
      case 'shop-now':
        this.showPage('products');
        break;
      case 'explore':
        this.showPage('categories');
        break;
      case 'view-all-products':
        this.showPage('products');
        break;
      case 'add-to-cart':
        const productId = element.getAttribute('data-product-id');
        this.addToCart(productId);
        break;
      case 'view-product':
        const viewProductId = element.getAttribute('data-product-id');
        this.viewProduct(viewProductId);
        break;
    }
  }

  // Cart functionality
  loadCart() {
    const savedCart = localStorage.getItem('cart');
    if (savedCart) {
      try {
        this.cart = JSON.parse(savedCart);
        if (!this.cart.sessionId) {
          this.cart.sessionId = this.generateSessionId();
        }
      } catch (error) {
        console.error('Failed to load cart:', error);
        this.cart = { items: [], sessionId: this.generateSessionId() };
      }
    }
  }

  saveCart() {
    localStorage.setItem('cart', JSON.stringify(this.cart));
  }

  async addToCart(productId, variantId = null, quantity = 1) {
    try {
      // Find product details
      let product = this.products.find(p => p.id === productId);
      if (!product) {
        // Try to fetch product details
        const response = await this.apiRequest(`/products/${productId}`);
        product = response;
      }

      if (!product) {
        throw new Error('Product not found');
      }

      // Check if item already exists in cart
      const existingItemIndex = this.cart.items.findIndex(item =>
        item.productId === productId && item.variantId === variantId
      );

      if (existingItemIndex >= 0) {
        this.cart.items[existingItemIndex].quantity += quantity;
      } else {
        this.cart.items.push({
          productId,
          variantId,
          name: product.name,
          price: product.salePrice || product.price,
          quantity,
          image: product.images?.[0]?.filePath || null
        });
      }

      this.saveCart();
      this.updateCartDisplay();
      this.showNotification(`${product.name} added to cart!`, 'success');

      // Sync with backend
      this.syncCartWithBackend();
    } catch (error) {
      console.error('Failed to add to cart:', error);
      this.showNotification('Failed to add item to cart', 'error');
    }
  }

  async syncCartWithBackend() {
    try {
      for (const item of this.cart.items) {
        await this.apiRequest('/cart/add', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: this.cart.sessionId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity
          })
        });
      }
    } catch (error) {
      console.error('Failed to sync cart with backend:', error);
    }
  }

  updateCartQuantity(productId, variantId, newQuantity) {
    const itemIndex = this.cart.items.findIndex(item =>
      item.productId === productId && item.variantId === variantId
    );

    if (itemIndex >= 0) {
      if (newQuantity <= 0) {
        this.cart.items.splice(itemIndex, 1);
      } else {
        this.cart.items[itemIndex].quantity = newQuantity;
      }

      this.saveCart();
      this.updateCartDisplay();
      this.renderCartItems();
    }
  }

  removeFromCart(productId, variantId) {
    this.cart.items = this.cart.items.filter(item =>
      !(item.productId === productId && item.variantId === variantId)
    );

    this.saveCart();
    this.updateCartDisplay();
    this.renderCartItems();
  }

  updateCartDisplay() {
    const cartCount = this.cart.items.reduce((total, item) => total + item.quantity, 0);
    const cartTotal = this.cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);

    // Update cart count in header
    document.getElementById('cartCount').textContent = cartCount;
    document.getElementById('mobileCartCount').textContent = cartCount;

    // Update cart total
    const cartTotalElement = document.getElementById('cartTotal');
    if (cartTotalElement) {
      cartTotalElement.textContent = `$${cartTotal.toFixed(2)}`;
    }
  }

  openCart() {
    document.getElementById('cartSidebar').classList.add('open');
    document.getElementById('overlay').classList.add('active');
    this.renderCartItems();
  }

  closeCart() {
    document.getElementById('cartSidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('active');
  }

  renderCartItems() {
    const cartContent = document.getElementById('cartContent');
    if (!cartContent) return;

    if (this.cart.items.length === 0) {
      cartContent.innerHTML = `
        <div class="cart-empty">
          <i class="fas fa-shopping-cart"></i>
          <p>Your cart is empty</p>
          <button class="btn btn-primary" onclick="app.showPage('products')">Start Shopping</button>
        </div>
      `;
      return;
    }

    const cartItemsHTML = this.cart.items.map(item => `
      <div class="cart-item">
        <div class="cart-item-image">
          ${item.image ? `<img src="${item.image}" alt="${item.name}">` : '<i class="fas fa-image"></i>'}
        </div>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">$${item.price.toFixed(2)}</div>
          <div class="cart-item-controls">
            <button class="quantity-btn" onclick="app.updateCartQuantity('${item.productId}', '${item.variantId}', ${item.quantity - 1})">-</button>
            <span class="quantity-display">${item.quantity}</span>
            <button class="quantity-btn" onclick="app.updateCartQuantity('${item.productId}', '${item.variantId}', ${item.quantity + 1})">+</button>
            <button class="remove-item" onclick="app.removeFromCart('${item.productId}', '${item.variantId}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    cartContent.innerHTML = cartItemsHTML;
  }

  // Authentication
  openAuthModal() {
    if (this.currentUser) {
      this.showUserProfile();
    } else {
      document.getElementById('authModalOverlay').classList.add('active');
    }
  }

  closeAuthModal() {
    document.getElementById('authModalOverlay').classList.remove('active');
  }

  switchAuthTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    // Update forms
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');

    // Update modal title
    document.getElementById('authModalTitle').textContent = tab === 'login' ? 'Login' : 'Register';
  }

  async handleLogin(form) {
    try {
      const formData = new FormData(form);
      const credentials = {
        email: formData.get('email') || document.getElementById('loginEmail').value,
        password: formData.get('password') || document.getElementById('loginPassword').value
      };

      const response = await this.apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });

      this.currentUser = response.user;
      this.currentUser.token = response.token;
      localStorage.setItem('user', JSON.stringify(this.currentUser));

      this.closeAuthModal();
      this.updateUserInterface();
      this.showNotification(`Welcome back, ${this.currentUser.firstName}!`, 'success');

      // Sync cart after login
      this.syncCartWithBackend();
    } catch (error) {
      console.error('Login failed:', error);
      this.showNotification('Login failed. Please check your credentials.', 'error');
    }
  }

  async handleRegister(form) {
    try {
      const formData = new FormData(form);
      const userData = {
        firstName: formData.get('firstName') || document.getElementById('registerFirstName').value,
        lastName: formData.get('lastName') || document.getElementById('registerLastName').value,
        email: formData.get('email') || document.getElementById('registerEmail').value,
        password: formData.get('password') || document.getElementById('registerPassword').value
      };

      const response = await this.apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData)
      });

      this.currentUser = response.user;
      this.currentUser.token = response.token;
      localStorage.setItem('user', JSON.stringify(this.currentUser));

      this.closeAuthModal();
      this.updateUserInterface();
      this.showNotification(`Welcome to NooblyJS Store, ${this.currentUser.firstName}!`, 'success');

      // Sync cart after registration
      this.syncCartWithBackend();
    } catch (error) {
      console.error('Registration failed:', error);
      this.showNotification('Registration failed. Please try again.', 'error');
    }
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('user');
    this.updateUserInterface();
    this.showNotification('You have been logged out.', 'info');
  }

  updateUserInterface() {
    const userBtn = document.getElementById('userBtn');
    if (this.currentUser) {
      userBtn.innerHTML = '<i class="fas fa-user-circle"></i>';
      userBtn.title = `${this.currentUser.firstName} ${this.currentUser.lastName}`;
    } else {
      userBtn.innerHTML = '<i class="fas fa-user"></i>';
      userBtn.title = 'Login / Register';
    }
  }

  // Checkout process
  async handleCheckout() {
    if (!this.currentUser) {
      this.openAuthModal();
      this.showNotification('Please login to continue with checkout.', 'info');
      return;
    }

    if (this.cart.items.length === 0) {
      this.showNotification('Your cart is empty.', 'error');
      return;
    }

    if (!this.stripe) {
      this.showNotification('Payment system is not available. Please try again later.', 'error');
      return;
    }

    // Close cart and open checkout modal
    this.closeCart();
    this.openCheckoutModal();
  }

  // Open checkout modal
  openCheckoutModal() {
    const modal = document.getElementById('checkoutModalOverlay');
    const overlay = document.getElementById('overlay');

    if (modal && overlay) {
      // Populate checkout summary
      this.populateCheckoutSummary();

      // Pre-fill shipping form if user data is available
      this.prefillShippingForm();

      modal.classList.add('active');
      overlay.classList.add('active');
      document.body.classList.add('modal-open');

      // Initialize Stripe Elements for payment
      this.initializeStripeElements();
    }
  }

  // Close checkout modal
  closeCheckoutModal() {
    const modal = document.getElementById('checkoutModalOverlay');
    const overlay = document.getElementById('overlay');

    if (modal && overlay) {
      modal.classList.remove('active');
      overlay.classList.remove('active');
      document.body.classList.remove('modal-open');

      // Clean up Stripe Elements
      if (this.stripeElements) {
        this.stripeElements = null;
        this.paymentElement = null;
        this.clientSecret = null;
      }
    }
  }

  // Populate checkout summary
  populateCheckoutSummary() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutSubtotal = document.getElementById('checkoutSubtotal');
    const checkoutTax = document.getElementById('checkoutTax');
    const checkoutShipping = document.getElementById('checkoutShipping');
    const checkoutTotal = document.getElementById('checkoutTotal');

    if (!checkoutItems) return;

    // Calculate totals
    const subtotal = this.cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08; // 8% tax
    const shipping = subtotal > 100 ? 0 : 10; // Free shipping over $100
    const total = subtotal + tax + shipping;

    // Render cart items
    const itemsHTML = this.cart.items.map(item => `
      <div class="checkout-item">
        <div class="item-details">
          <h4>${item.name}</h4>
          <p>Qty: ${item.quantity} × $${item.price.toFixed(2)}</p>
        </div>
        <div class="item-total">
          $${(item.price * item.quantity).toFixed(2)}
        </div>
      </div>
    `).join('');

    checkoutItems.innerHTML = itemsHTML;

    // Update totals
    if (checkoutSubtotal) checkoutSubtotal.textContent = `$${subtotal.toFixed(2)}`;
    if (checkoutTax) checkoutTax.textContent = `$${tax.toFixed(2)}`;
    if (checkoutShipping) checkoutShipping.textContent = shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`;
    if (checkoutTotal) checkoutTotal.textContent = `$${total.toFixed(2)}`;
  }

  // Pre-fill shipping form with user data
  prefillShippingForm() {
    if (!this.currentUser) return;

    const firstName = document.getElementById('shippingFirstName');
    const lastName = document.getElementById('shippingLastName');

    if (firstName && this.currentUser.firstName) {
      firstName.value = this.currentUser.firstName;
    }
    if (lastName && this.currentUser.lastName) {
      lastName.value = this.currentUser.lastName;
    }
  }

  // Initialize Stripe Elements
  async initializeStripeElements() {
    if (!this.stripe) return;

    try {
      // Calculate total amount for payment intent
      const subtotal = this.cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const tax = subtotal * 0.08;
      const shipping = subtotal > 100 ? 0 : 10;
      const total = subtotal + tax + shipping;

      // Create payment intent
      const response = await this.apiRequest('/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: total,
          currency: 'usd',
          metadata: {
            sessionId: this.cart.sessionId,
            userId: this.currentUser.id
          }
        })
      });

      this.clientSecret = response.clientSecret;

      // Create Stripe Elements
      const appearance = {
        theme: 'stripe',
        variables: {
          colorPrimary: '#0070f3',
          colorBackground: '#ffffff',
          colorText: '#1a1a1a',
          colorDanger: '#df1b41',
          fontFamily: 'Inter, system-ui, sans-serif',
          spacingUnit: '4px',
          borderRadius: '8px'
        }
      };

      this.stripeElements = this.stripe.elements({
        appearance,
        clientSecret: this.clientSecret
      });

      // Create payment element
      this.paymentElement = this.stripeElements.create('payment');
      this.paymentElement.mount('#payment-element');

      // Handle payment element events
      this.paymentElement.on('ready', () => {
        console.log('Payment element ready');
      });

      this.paymentElement.on('change', (event) => {
        const messageContainer = document.getElementById('payment-message');
        if (event.error) {
          messageContainer.textContent = event.error.message;
          messageContainer.classList.remove('hidden');
        } else {
          messageContainer.classList.add('hidden');
        }
      });

    } catch (error) {
      console.error('Failed to initialize Stripe Elements:', error);
      this.showNotification('Payment initialization failed. Please try again.', 'error');
    }
  }

  // Handle payment form submission
  async handlePaymentSubmit(event) {
    event.preventDefault();

    if (!this.stripe || !this.stripeElements || !this.clientSecret) {
      this.showNotification('Payment system not ready. Please try again.', 'error');
      return;
    }

    // Show loading state
    const submitButton = document.getElementById('submitPayment');
    const buttonText = document.getElementById('paymentButtonText');
    const spinner = document.getElementById('paymentSpinner');

    if (submitButton) submitButton.disabled = true;
    if (buttonText) buttonText.textContent = 'Processing...';
    if (spinner) spinner.classList.remove('hidden');

    try {
      // Get shipping address from form
      const shippingAddress = this.getShippingAddressFromForm();

      if (!shippingAddress) {
        throw new Error('Please fill in all required shipping information');
      }

      // Confirm payment with Stripe
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements: this.stripeElements,
        redirect: 'if_required'
      });

      if (error) {
        throw new Error(error.message);
      }

      if (paymentIntent.status === 'succeeded') {
        // Payment successful, confirm order on backend
        const orderData = {
          paymentIntentId: paymentIntent.id,
          items: this.cart.items.map(item => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            price: item.price
          })),
          shippingAddress,
          billingAddress: shippingAddress // Use same as shipping for now
        };

        const response = await this.apiRequest('/payments/confirm', {
          method: 'POST',
          body: JSON.stringify(orderData)
        });

        // Clear cart and close modal
        this.cart.items = [];
        this.saveCart();
        this.updateCartDisplay();
        this.closeCheckoutModal();

        this.showNotification(`Order placed successfully! Order number: ${response.order.orderNumber}`, 'success');
      }

    } catch (error) {
      console.error('Payment failed:', error);
      this.showNotification(error.message || 'Payment failed. Please try again.', 'error');

      // Show error message
      const messageContainer = document.getElementById('payment-message');
      if (messageContainer) {
        messageContainer.textContent = error.message || 'Payment failed. Please try again.';
        messageContainer.classList.remove('hidden');
      }
    } finally {
      // Reset loading state
      if (submitButton) submitButton.disabled = false;
      if (buttonText) buttonText.textContent = 'Complete Order';
      if (spinner) spinner.classList.add('hidden');
    }
  }

  // Get shipping address from form
  getShippingAddressFromForm() {
    const firstName = document.getElementById('shippingFirstName')?.value?.trim();
    const lastName = document.getElementById('shippingLastName')?.value?.trim();
    const address = document.getElementById('shippingAddress')?.value?.trim();
    const city = document.getElementById('shippingCity')?.value?.trim();
    const state = document.getElementById('shippingState')?.value?.trim();
    const zipCode = document.getElementById('shippingZip')?.value?.trim();
    const country = document.getElementById('shippingCountry')?.value?.trim();

    if (!firstName || !lastName || !address || !city || !state || !zipCode || !country) {
      return null;
    }

    return {
      firstName,
      lastName,
      address,
      city,
      state,
      zipCode,
      country
    };
  }

  // Rendering functions
  renderCategories() {
    const categoriesGrid = document.getElementById('categoriesGrid');
    const allCategoriesList = document.getElementById('allCategoriesList');

    if (!this.categories.length) return;

    const categoryHTML = this.categories.slice(0, 6).map(category => `
      <div class="category-card" onclick="app.filterByCategory('${category.name}')">
        <div class="category-icon">
          <i class="fas fa-${this.getCategoryIcon(category.name)}"></i>
        </div>
        <h3>${category.name}</h3>
        <p>${category.description}</p>
      </div>
    `).join('');

    if (categoriesGrid) {
      categoriesGrid.innerHTML = categoryHTML;
    }

    if (allCategoriesList) {
      const allCategoriesHTML = this.categories.map(category => `
        <div class="category-card" onclick="app.filterByCategory('${category.name}')">
          <div class="category-icon">
            <i class="fas fa-${this.getCategoryIcon(category.name)}"></i>
          </div>
          <h3>${category.name}</h3>
          <p>${category.description}</p>
        </div>
      `).join('');
      allCategoriesList.innerHTML = `<div class="categories-grid">${allCategoriesHTML}</div>`;
    }
  }

  renderFeaturedProducts(products) {
    const featuredProducts = document.getElementById('featuredProducts');
    if (!featuredProducts || !products.length) return;

    const productsHTML = products.map(product => this.createProductCard(product)).join('');
    featuredProducts.innerHTML = productsHTML;
  }

  renderAllProducts(products) {
    const allProductsGrid = document.getElementById('allProductsGrid');
    if (!allProductsGrid) return;

    if (!products.length) {
      allProductsGrid.innerHTML = `
        <div class="no-products">
          <i class="fas fa-search"></i>
          <h3>No products found</h3>
          <p>Try adjusting your search or filter criteria.</p>
        </div>
      `;
      return;
    }

    const productsHTML = products.map(product => this.createProductCard(product)).join('');
    allProductsGrid.innerHTML = productsHTML;
  }

  createProductCard(product) {
    const hasDiscount = product.salePrice && product.salePrice < product.price;
    const discountPercent = hasDiscount ? Math.round(((product.price - product.salePrice) / product.price) * 100) : 0;

    return `
      <div class="product-card" onclick="app.viewProduct('${product.id}')">
        <div class="product-image">
          ${hasDiscount ? `<div class="product-badge sale">${discountPercent}% OFF</div>` : ''}
          <i class="fas fa-image"></i>
        </div>
        <div class="product-info">
          <div class="product-category">${product.category}</div>
          <h3 class="product-name">${product.name}</h3>
          <p class="product-description">${product.description}</p>
          <div class="product-price">
            <span class="current-price">$${(product.salePrice || product.price).toFixed(2)}</span>
            ${hasDiscount ? `<span class="original-price">$${product.price.toFixed(2)}</span>` : ''}
          </div>
          <div class="product-actions">
            <button class="add-to-cart-btn" data-action="add-to-cart" data-product-id="${product.id}" onclick="event.stopPropagation()">
              Add to Cart
            </button>
            <button class="quick-view-btn" onclick="event.stopPropagation(); app.viewProduct('${product.id}')">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderPagination(pagination) {
    const paginationElement = document.getElementById('productsPagination');
    if (!paginationElement || !pagination) return;

    const { page, totalPages } = pagination;
    let paginationHTML = '';

    // Previous button
    paginationHTML += `
      <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="app.changePage(${page - 1})">
        <i class="fas fa-chevron-left"></i>
      </button>
    `;

    // Page numbers
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, page + 2);

    for (let i = startPage; i <= endPage; i++) {
      paginationHTML += `
        <button class="pagination-btn ${i === page ? 'active' : ''}" onclick="app.changePage(${i})">
          ${i}
        </button>
      `;
    }

    // Next button
    paginationHTML += `
      <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="app.changePage(${page + 1})">
        <i class="fas fa-chevron-right"></i>
      </button>
    `;

    paginationElement.innerHTML = paginationHTML;
  }

  // Utility functions
  populateCategoryFilter() {
    const categoryFilter = document.getElementById('categoryFilter');
    if (!categoryFilter || !this.categories.length) return;

    const optionsHTML = this.categories.map(category =>
      `<option value="${category.name}">${category.name}</option>`
    ).join('');

    categoryFilter.innerHTML = `<option value="">All Categories</option>${optionsHTML}`;
  }

  getCategoryIcon(categoryName) {
    const icons = {
      'Electronics': 'laptop',
      'Clothing': 'tshirt',
      'Home & Garden': 'home',
      'Sports & Outdoors': 'futbol',
      'Books': 'book',
      'Health & Beauty': 'heart'
    };
    return icons[categoryName] || 'tag';
  }

  filterByCategory(categoryName) {
    this.filters.category = categoryName;
    this.filters.page = 1;
    this.showPage('products');

    // Update filter dropdown
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
      categoryFilter.value = categoryName;
    }

    this.loadProducts();
  }

  changePage(page) {
    this.filters.page = page;
    this.loadProducts();
  }

  switchProductView(view) {
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`).classList.add('active');

    const productsGrid = document.getElementById('allProductsGrid');
    if (productsGrid) {
      productsGrid.className = view === 'list' ? 'products-list' : 'products-grid';
    }
  }

  async viewProduct(productId) {
    try {
      const response = await this.apiRequest(`/products/${productId}`);
      this.renderProductDetail(response);
      this.showPage('productDetail');
    } catch (error) {
      console.error('Failed to load product details:', error);
      this.showNotification('Failed to load product details', 'error');
    }
  }

  renderProductDetail(product) {
    const productDetail = document.getElementById('productDetail');
    const productBreadcrumb = document.getElementById('productBreadcrumb');

    if (productBreadcrumb) {
      productBreadcrumb.innerHTML = `
        <a href="#" onclick="app.showPage('home')">Home</a>
        <i class="fas fa-chevron-right"></i>
        <a href="#" onclick="app.filterByCategory('${product.category}')">${product.category}</a>
        <i class="fas fa-chevron-right"></i>
        <span>${product.name}</span>
      `;
    }

    if (productDetail) {
      const hasDiscount = product.salePrice && product.salePrice < product.price;
      const discountPercent = hasDiscount ? Math.round(((product.price - product.salePrice) / product.price) * 100) : 0;

      productDetail.innerHTML = `
        <div class="product-detail-container">
          <div class="product-images">
            <div class="main-image">
              <i class="fas fa-image"></i>
            </div>
          </div>
          <div class="product-details">
            <div class="product-category">${product.category}</div>
            <h1>${product.name}</h1>
            <div class="product-price">
              <span class="current-price">$${(product.salePrice || product.price).toFixed(2)}</span>
              ${hasDiscount ? `
                <span class="original-price">$${product.price.toFixed(2)}</span>
                <span class="discount">${discountPercent}% OFF</span>
              ` : ''}
            </div>
            <div class="product-description">
              <p>${product.description}</p>
            </div>
            <div class="product-actions">
              <button class="btn btn-primary btn-lg" data-action="add-to-cart" data-product-id="${product.id}">
                <i class="fas fa-shopping-cart"></i>
                Add to Cart
              </button>
              <button class="btn btn-outline btn-lg">
                <i class="fas fa-heart"></i>
                Add to Wishlist
              </button>
            </div>
            ${product.brand ? `<div class="product-brand">Brand: <strong>${product.brand}</strong></div>` : ''}
            ${product.sku ? `<div class="product-sku">SKU: <strong>${product.sku}</strong></div>` : ''}
          </div>
        </div>
      `;
    }
  }

  // UI helpers
  showLoading() {
    document.getElementById('loadingSpinner').classList.add('active');
  }

  hideLoading() {
    document.getElementById('loadingSpinner').classList.remove('active');
  }

  showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <i class="fas fa-${this.getNotificationIcon(type)}"></i>
        <span>${message}</span>
      </div>
    `;

    container.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);

    // Remove on click
    notification.addEventListener('click', () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });
  }

  getNotificationIcon(type) {
    const icons = {
      success: 'check-circle',
      error: 'exclamation-circle',
      warning: 'exclamation-triangle',
      info: 'info-circle'
    };
    return icons[type] || 'info-circle';
  }

  showUserProfile() {
    // This would show a user profile modal or dropdown
    console.log('Show user profile for:', this.currentUser);
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new NooblyStore();
});

// Make app globally available
window.NooblyStore = NooblyStore;