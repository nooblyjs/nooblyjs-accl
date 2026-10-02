# NooblyJS Core - Technical Usage Guide

## Overview

This comprehensive guide covers all aspects of using the NooblyJS Core framework, from basic setup to advanced configurations. Whether you're building APIs, web applications, or microservices, this guide provides practical examples and patterns for leveraging all framework capabilities.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Service Registry Architecture](#service-registry-architecture)
3. [API Usage](#api-usage)
4. [Programmatic Usage](#programmatic-usage)
5. [Web Interface](#web-interface)
6. [Authentication & Security](#authentication--security)
7. [Service Reference](#service-reference)
8. [Configuration](#configuration)
9. [Deployment](#deployment)
10. [Testing](#testing)
11. [Best Practices](#best-practices)
12. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Installation

```bash
# Install from npm
npm install noobly-core

# Clone and run locally
git clone https://github.com/StephenBooysen/nooblyjs-core.git
cd nooblyjs-core
npm install
```

### Quick Start - Basic Usage

```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// Initialize the service registry
serviceRegistry.initialize(app);

// Get services
const cache = serviceRegistry.cache('memory');
const logger = serviceRegistry.logger('console');
const dataServe = serviceRegistry.dataServe('memory');

// Use services programmatically
await cache.put('user:123', { name: 'John', email: 'john@example.com' });
const user = await cache.get('user:123');
logger.info('Retrieved user:', user);

app.listen(3000, () => {
  logger.info('Server running on port 3000');
});
```

### Quick Start - With API Keys

```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// Generate API keys
const apiKey = serviceRegistry.generateApiKey();
console.log('Generated API Key:', apiKey);

// Initialize with security
serviceRegistry.initialize(app, {
  apiKeys: [apiKey],
  requireApiKey: true,
  excludePaths: [
    '/services/*/status',
    '/services/',
    '/services/*/views/*'
  ]
});

app.listen(3000);
```

---

## Service Registry Architecture

### Core Concepts

The NooblyJS Core implements a **Service Registry Pattern** with the following principles:

- **Singleton Pattern**: One instance per service type/provider combination
- **Provider Pattern**: Multiple backend implementations for each service
- **Event-Driven**: Global EventEmitter for inter-service communication
- **RESTful APIs**: Consistent HTTP endpoints for all services

### Service Lifecycle

```javascript
// 1. Initialize registry (once)
serviceRegistry.initialize(app, eventEmitter, options);

// 2. Get service instances (cached as singletons)
const cache = serviceRegistry.cache('redis', { host: 'localhost', port: 6379 });

// 3. Use services
await cache.put('key', 'value');

// 4. Services are automatically configured with routes and middleware
```

### Available Services

| Service | Purpose | Providers | API Endpoints |
|---------|---------|-----------|---------------|
| **caching** | High-performance caching | memory, redis, memcached | `/services/caching/api/*` |
| **dataserve** | Database-style JSON document storage with UUIDs | memory, simpledb, file | `/services/dataserve/api/*` |
| **filing** | File management | local, ftp, s3, git, sync | `/services/filing/api/*` |
| **logging** | Application logging | console, file | `/services/logging/api/*` |
| **measuring** | Metrics collection | memory | `/services/measuring/api/*` |
| **notifying** | Pub/sub messaging | memory | `/services/notifying/api/*` |
| **queueing** | Task queueing | memory | `/services/queueing/api/*` |
| **scheduling** | Task scheduling | memory | `/services/scheduling/api/*` |
| **searching** | Full-text search | memory | `/services/searching/api/*` |
| **workflow** | Multi-step workflows | memory | `/services/workflow/api/*` |
| **working** | Background tasks | memory | `/services/working/api/*` |

---

## API Usage

### Authentication Methods

API endpoints support multiple authentication methods:

```bash
# Method 1: x-api-key header
curl -H "x-api-key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'

# Method 2: Authorization Bearer
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'

# Method 3: Authorization ApiKey
curl -H "Authorization: ApiKey YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'

# Method 4: Query parameter
curl -H "Content-Type: application/json" \
     -X POST "http://localhost:3000/services/caching/api/put/mykey?api_key=YOUR_API_KEY" \
     -d '{"value": "Hello World"}'

# Method 5: api-key header
curl -H "api-key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'
```

### Caching API

```bash
# Store data
POST /services/caching/api/put/user:123
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "userId": "123",
  "name": "John Doe",
  "email": "john@example.com",
  "preferences": {
    "theme": "dark",
    "notifications": true
  }
}

# Retrieve data
GET /services/caching/api/get/user:123
x-api-key: YOUR_API_KEY

# Response:
{
  "userId": "123",
  "name": "John Doe",
  "email": "john@example.com",
  "preferences": {
    "theme": "dark",
    "notifications": true
  }
}

# Delete data
DELETE /services/caching/api/delete/user:123
x-api-key: YOUR_API_KEY

# Get cache analytics
GET /services/caching/api/list
x-api-key: YOUR_API_KEY

# Response:
{
  "success": true,
  "data": [
    {
      "key": "user:123",
      "hitCount": 5,
      "lastAccessed": "2025-08-25T10:30:00Z"
    }
  ],
  "total": 1
}

# Check service status (no auth required)
GET /services/caching/api/status

# Response: "caching api running"
```

### DataServe API

The DataServe API provides **container-based persistent storage** that works like a database - you insert JSON documents into containers and receive UUIDs for retrieval and management. It supports advanced JSON search capabilities for complex queries.

#### Database-Style Storage

```bash
# Insert data into a container and receive a UUID
POST /services/dataserve/api/users
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "id": 123,
  "name": "John Doe",
  "email": "john@example.com",
  "profile": {
    "department": "engineering",
    "role": "senior-developer",
    "location": "remote"
  },
  "status": "active",
  "joinedAt": "2024-01-15T09:30:00Z"
}

# Response: Returns generated UUID
{
  "id": "9c8a6a28-f6af-4386-8aba-b8caad5bcfa6"
}

# Retrieve data using the UUID
GET /services/dataserve/api/users/9c8a6a28-f6af-4386-8aba-b8caad5bcfa6
x-api-key: YOUR_API_KEY

# Response: Original data
{
  "id": 123,
  "name": "John Doe",
  "email": "john@example.com",
  "profile": {
    "department": "engineering",
    "role": "senior-developer",
    "location": "remote"
  },
  "status": "active",
  "joinedAt": "2024-01-15T09:30:00Z"
}

# Delete data using the UUID
DELETE /services/dataserve/api/users/9c8a6a28-f6af-4386-8aba-b8caad5bcfa6
x-api-key: YOUR_API_KEY

# Response: "OK" or "Not found"

# Store configuration data in config container
POST /services/dataserve/api/config
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "appConfig": {
    "version": "1.2.0",
    "features": ["caching", "logging", "metrics"],
    "environment": "production"
  },
  "updatedAt": "2025-08-25T10:30:00Z"
}

# Response:
{
  "id": "7b1d3e8f-2a4c-4b5d-9e8f-1a2b3c4d5e6f"
}
```

#### JSON Search API

The DataServe API includes powerful JSON search capabilities for querying stored data:

**1. Custom Predicate Search** - Use JavaScript expressions to find objects:

```bash
POST /services/dataserve/api/jsonFind/users
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "predicate": "obj.id === 123 && obj.status === 'active'"
}

# Response: Array of matching objects
[
  {
    "id": 123,
    "name": "John Doe",
    "email": "john@example.com",
    "profile": {
      "department": "engineering",
      "role": "senior-developer"
    },
    "status": "active"
  }
]
```

**2. Path-Based Search** - Search by specific property paths:

```bash
# Find all users in the engineering department
GET /services/dataserve/api/jsonFindByPath/users/profile.department/engineering
x-api-key: YOUR_API_KEY

# Find users with specific role
GET /services/dataserve/api/jsonFindByPath/users/profile.role/senior-developer
x-api-key: YOUR_API_KEY

# Response: Array of users matching the criteria
[
  {
    "id": 123,
    "name": "John Doe",
    "profile": {
      "department": "engineering",
      "role": "senior-developer"
    }
  },
  {
    "id": 456,
    "name": "Jane Smith", 
    "profile": {
      "department": "engineering",
      "role": "senior-developer"
    }
  }
]
```

**3. Multi-Criteria Search** - Search using multiple conditions:

```bash
POST /services/dataserve/api/jsonFindByCriteria/users
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "status": "active",
  "profile.department": "engineering",
  "profile.role": "senior-developer"
}

# Response: Users matching ALL criteria
[
  {
    "id": 123,
    "name": "John Doe",
    "email": "john@example.com",
    "profile": {
      "department": "engineering",
      "role": "senior-developer"
    },
    "status": "active"
  }
]
```

#### Important Note

The DataServe API requires containers for all operations. There are no legacy key-only endpoints - all operations must specify a container. This ensures proper data organization and allows for better scalability and data isolation.

### Filing API

```bash
# Upload file
POST /services/filing/api/upload/documents/report.pdf
Content-Type: multipart/form-data
x-api-key: YOUR_API_KEY

[Binary file data]

# Download file
GET /services/filing/api/download/documents/report.pdf
x-api-key: YOUR_API_KEY

# Delete file
DELETE /services/filing/api/remove/documents/report.pdf
x-api-key: YOUR_API_KEY
```

### Workflow API

```bash
# Define a workflow
POST /services/workflow/api/defineworkflow
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "name": "userOnboarding",
  "steps": [
    "/path/to/steps/validateUser.js",
    "/path/to/steps/sendWelcomeEmail.js",
    "/path/to/steps/setupAccount.js"
  ]
}

# Start workflow execution
POST /services/workflow/api/start
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "name": "userOnboarding",
  "data": {
    "userId": "123",
    "email": "new-user@example.com",
    "signupSource": "website"
  }
}
```

### Queue API

```bash
# Add task to queue
POST /services/queueing/api/enqueue
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "taskType": "sendEmail",
  "recipient": "user@example.com",
  "template": "welcome",
  "priority": "high"
}

# Get next task from queue
GET /services/queueing/api/dequeue
x-api-key: YOUR_API_KEY

# Check queue size
GET /services/queueing/api/size
x-api-key: YOUR_API_KEY
```

### Error Responses

All APIs return consistent error responses:

```json
{
  "error": "Unauthorized",
  "message": "API key is required. Provide it via x-api-key header, Authorization header, or api_key query parameter.",
  "code": "MISSING_API_KEY"
}
```

```json
{
  "error": "Not Found",
  "message": "Key 'nonexistent-key' not found",
  "code": "KEY_NOT_FOUND"
}
```

---

## Programmatic Usage

### Service Configuration Patterns

```javascript
// Memory-based services (development/testing)
const cache = serviceRegistry.cache('memory');
const dataServe = serviceRegistry.dataServe('memory');
const logger = serviceRegistry.logger('console');

// Production services with external providers
const cache = serviceRegistry.cache('redis', {
  host: 'redis.example.com',
  port: 6379,
  password: 'your-redis-password',
  keyPrefix: 'myapp:'
});

const dataServe = serviceRegistry.dataServe('simpledb', {
  domain: 'myapp-data',
  region: 'us-east-1'
});

const logger = serviceRegistry.logger('file', {
  filename: '/var/log/myapp.log',
  maxFiles: 5,
  maxSize: '10m'
});

const filing = serviceRegistry.filing('s3', {
  bucket: 'myapp-files',
  region: 'us-west-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
```

### Advanced Service Usage

#### Caching with Analytics

```javascript
const cache = serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  enableAnalytics: true
});

// Store with TTL
await cache.put('session:abc123', userData, 3600); // 1 hour TTL

// Retrieve with analytics
const userData = await cache.get('session:abc123');

// Get cache performance metrics
const analytics = cache.getAnalytics();
console.log('Cache hit ratio:', analytics.hitRatio);
console.log('Most accessed keys:', analytics.topKeys);
```

#### Real-World Caching Examples

**1. User Session Management**
```javascript
const cache = serviceRegistry.cache('redis', {
  host: process.env.REDIS_HOST,
  port: 6379,
  enableAnalytics: true
});

// Store user session with 24-hour expiry
const sessionData = {
  userId: '12345',
  username: 'john_doe',
  roles: ['user', 'admin'],
  lastActivity: new Date().toISOString()
};

await cache.put(`session:${sessionToken}`, sessionData, 86400); // 24 hours

// Retrieve session for authentication
const authenticateUser = async (sessionToken) => {
  const session = await cache.get(`session:${sessionToken}`);
  if (!session) {
    throw new Error('Session expired or invalid');
  }

  // Update last activity
  session.lastActivity = new Date().toISOString();
  await cache.put(`session:${sessionToken}`, session, 86400);

  return session;
};
```

**2. API Response Caching**
```javascript
// Cache expensive database queries
const cacheExpensiveQuery = async (queryKey, queryFunction, ttl = 1800) => {
  // Try cache first
  let result = await cache.get(queryKey);
  if (result) {
    console.log('Cache hit for:', queryKey);
    return result;
  }

  // Execute expensive operation
  console.log('Cache miss, executing query:', queryKey);
  result = await queryFunction();

  // Cache the result
  await cache.put(queryKey, result, ttl);
  return result;
};

// Usage example
const getUserProfile = async (userId) => {
  return cacheExpensiveQuery(
    `user_profile:${userId}`,
    () => database.getUserWithPermissions(userId),
    3600 // 1 hour cache
  );
};
```

**3. Rate Limiting with Cache**
```javascript
// Implement rate limiting using cache
const checkRateLimit = async (clientId, limit = 100, windowMs = 3600000) => {
  const key = `rate_limit:${clientId}`;
  const current = await cache.get(key) || 0;

  if (current >= limit) {
    throw new Error('Rate limit exceeded');
  }

  await cache.put(key, current + 1, Math.floor(windowMs / 1000));
  return {
    remaining: limit - current - 1,
    resetTime: Date.now() + windowMs
  };
};

// Usage in Express middleware
app.use('/api/', async (req, res, next) => {
  try {
    const clientId = req.ip;
    const rateInfo = await checkRateLimit(clientId);
    res.set({
      'X-RateLimit-Remaining': rateInfo.remaining,
      'X-RateLimit-Reset': rateInfo.resetTime
    });
    next();
  } catch (error) {
    res.status(429).json({ error: error.message });
  }
});
```

**4. Cache Invalidation Patterns**
```javascript
// Tag-based cache invalidation
const taggedCache = {
  async put(key, value, ttl, tags = []) {
    await cache.put(key, value, ttl);

    // Store tag mappings
    for (const tag of tags) {
      const taggedKeys = await cache.get(`tag:${tag}`) || [];
      taggedKeys.push(key);
      await cache.put(`tag:${tag}`, taggedKeys, ttl);
    }
  },

  async invalidateByTag(tag) {
    const taggedKeys = await cache.get(`tag:${tag}`) || [];

    // Delete all keys with this tag
    for (const key of taggedKeys) {
      await cache.delete(key);
    }

    // Delete the tag mapping
    await cache.delete(`tag:${tag}`);

    console.log(`Invalidated ${taggedKeys.length} keys with tag: ${tag}`);
  }
};

// Usage
await taggedCache.put('user:123:profile', userProfile, 3600, ['user:123', 'profiles']);
await taggedCache.put('user:123:preferences', userPrefs, 3600, ['user:123', 'preferences']);

// Invalidate all cache entries for a user
await taggedCache.invalidateByTag('user:123');
```

**5. Cache Warming Strategies**
```javascript
// Pre-populate cache with frequently accessed data
const warmCache = async () => {
  console.log('Starting cache warming...');

  // Warm popular user profiles
  const popularUsers = await database.getPopularUsers(100);
  for (const user of popularUsers) {
    await cache.put(`user_profile:${user.id}`, user, 7200); // 2 hours
  }

  // Warm product categories
  const categories = await database.getProductCategories();
  await cache.put('product_categories', categories, 3600); // 1 hour

  // Warm configuration data
  const config = await database.getApplicationConfig();
  await cache.put('app_config', config, 1800); // 30 minutes

  console.log('Cache warming completed');
};

// Schedule cache warming
setInterval(warmCache, 30 * 60 * 1000); // Every 30 minutes

// Warm cache on application startup
warmCache();
```

#### Database-Style Data Management

```javascript
const dataServe = serviceRegistry.dataServe('memory'); // or 'file', 'simpledb'

// Insert data into containers and get UUIDs back
const userUuid = await dataServe.add('users', {
  id: 123,
  name: 'John Doe',
  email: 'john@example.com',
  profile: {
    department: 'engineering',
    role: 'senior-developer',
    location: 'remote'
  },
  status: 'active',
  joinedAt: '2024-01-15T09:30:00Z'
});
// userUuid = "9c8a6a28-f6af-4386-8aba-b8caad5bcfa6"

const productUuid = await dataServe.add('products', {
  id: 456,
  name: 'Premium Widget',
  category: 'electronics',
  price: 199.99,
  inStock: true
});
// productUuid = "7b1d3e8f-2a4c-4b5d-9e8f-1a2b3c4d5e6f"

// Retrieve data using UUIDs
const user = await dataServe.getByUuid('users', userUuid);
const product = await dataServe.getByUuid('products', productUuid);

// Delete data using UUIDs
await dataServe.remove('users', userUuid);

// JSON Search Operations
// 1. Custom predicate search - like Array.find()
const activeEngineers = await dataServe.jsonFind('users', 
  user => user.status === 'active' && user.profile.department === 'engineering'
);

// 2. Path-based search - find by nested property
const seniorDevelopers = await dataServe.jsonFindByPath('users', 'profile.role', 'senior-developer');

// 3. Multi-criteria search - match multiple conditions
const activeSeniorEngineers = await dataServe.jsonFindByCriteria('users', {
  'status': 'active',
  'profile.department': 'engineering',
  'profile.role': 'senior-developer'
});

// Complex search examples
const remoteWorkers = await dataServe.jsonFind('users',
  user => user.profile.location === 'remote' && user.status === 'active'
);

const expensiveElectronics = await dataServe.jsonFind('products',
  product => product.category === 'electronics' && product.price > 100
);

// Create containers explicitly when needed
try {
  await dataServe.createContainer('config');
} catch (err) {
  // Container may already exist
}
const configUuid = await dataServe.add('config', appConfiguration);
```

#### Real-World DataServe Examples

**1. User Management System**
```javascript
const dataServe = serviceRegistry.dataServe('file', {
  baseDir: './data/containers'
});

// Create user management functions
const userManager = {
  async createUser(userData) {
    // Validate user data
    if (!userData.email || !userData.username) {
      throw new Error('Email and username are required');
    }

    // Check if user already exists
    const existingUsers = await dataServe.jsonFindByPath('users', 'email', userData.email);
    if (existingUsers.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Create user with metadata
    const user = {
      ...userData,
      id: Date.now(), // Simple ID generation
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      profile: {
        ...userData.profile,
        lastLogin: null,
        loginCount: 0
      }
    };

    // Store user and return UUID
    const userUuid = await dataServe.add('users', user);
    console.log(`User created with UUID: ${userUuid}`);

    return { uuid: userUuid, user };
  },

  async updateUser(uuid, updates) {
    // Get existing user
    const user = await dataServe.getByUuid('users', uuid);
    if (!user) {
      throw new Error('User not found');
    }

    // Merge updates
    const updatedUser = {
      ...user,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // Remove and re-add (update operation)
    await dataServe.remove('users', uuid);
    const newUuid = await dataServe.add('users', updatedUser);

    return { uuid: newUuid, user: updatedUser };
  },

  async findUsersByDepartment(department) {
    return await dataServe.jsonFindByPath('users', 'profile.department', department);
  },

  async findActiveUsers() {
    return await dataServe.jsonFindByCriteria('users', {
      'status': 'active'
    });
  },

  async findUsersByRole(role) {
    return await dataServe.jsonFind('users', user => {
      return user.profile && user.profile.roles && user.profile.roles.includes(role);
    });
  }
};

// Usage examples
const newUser = await userManager.createUser({
  email: 'jane.smith@company.com',
  username: 'jane_smith',
  firstName: 'Jane',
  lastName: 'Smith',
  profile: {
    department: 'engineering',
    roles: ['developer', 'team-lead'],
    location: 'remote'
  }
});

const engineers = await userManager.findUsersByDepartment('engineering');
const teamLeads = await userManager.findUsersByRole('team-lead');
```

**2. Content Management System**
```javascript
// Article/blog management with categories and tags
const contentManager = {
  async createArticle(articleData) {
    const article = {
      ...articleData,
      id: `article_${Date.now()}`,
      slug: articleData.title.toLowerCase().replace(/\s+/g, '-'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      published: false,
      viewCount: 0,
      author: {
        id: articleData.authorId,
        name: articleData.authorName
      },
      metadata: {
        wordCount: articleData.content.split(' ').length,
        readingTime: Math.ceil(articleData.content.split(' ').length / 200) // ~200 WPM
      }
    };

    const articleUuid = await dataServe.add('articles', article);

    // Create category mapping if provided
    if (articleData.category) {
      await this.addToCategory(articleUuid, articleData.category);
    }

    return { uuid: articleUuid, article };
  },

  async publishArticle(uuid) {
    const article = await dataServe.getByUuid('articles', uuid);
    if (!article) {
      throw new Error('Article not found');
    }

    article.published = true;
    article.publishedAt = new Date().toISOString();
    article.updatedAt = new Date().toISOString();

    await dataServe.remove('articles', uuid);
    const newUuid = await dataServe.add('articles', article);

    return { uuid: newUuid, article };
  },

  async addToCategory(articleUuid, categoryName) {
    // Create or update category container
    try {
      await dataServe.createContainer('categories');
    } catch (err) {
      // Container exists
    }

    const categoryData = {
      name: categoryName,
      articleUuid: articleUuid,
      addedAt: new Date().toISOString()
    };

    await dataServe.add('categories', categoryData);
  },

  async getArticlesByCategory(categoryName) {
    const categoryEntries = await dataServe.jsonFindByPath('categories', 'name', categoryName);
    const articles = [];

    for (const entry of categoryEntries) {
      const article = await dataServe.getByUuid('articles', entry.articleUuid);
      if (article) {
        articles.push(article);
      }
    }

    return articles;
  },

  async searchPublishedArticles(searchTerm) {
    return await dataServe.jsonFind('articles', article => {
      if (!article.published) return false;

      const searchFields = [
        article.title,
        article.content,
        article.tags ? article.tags.join(' ') : '',
        article.author.name
      ].join(' ').toLowerCase();

      return searchFields.includes(searchTerm.toLowerCase());
    });
  },

  async getPopularArticles(limit = 10) {
    const allArticles = await dataServe.jsonFind('articles', article => article.published);
    return allArticles
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, limit);
  }
};

// Usage
const article = await contentManager.createArticle({
  title: 'Getting Started with NooblyJS',
  content: 'NooblyJS is a powerful backend framework...',
  authorId: 'user_123',
  authorName: 'John Developer',
  category: 'tutorials',
  tags: ['javascript', 'backend', 'tutorial']
});

const tutorialArticles = await contentManager.getArticlesByCategory('tutorials');
const searchResults = await contentManager.searchPublishedArticles('javascript');
```

**3. E-commerce Product Catalog**
```javascript
// Product inventory and catalog management
const productManager = {
  async addProduct(productData) {
    const product = {
      ...productData,
      id: `prod_${Date.now()}`,
      sku: productData.sku || `SKU${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inventory: {
        quantity: productData.quantity || 0,
        reserved: 0,
        available: productData.quantity || 0
      },
      pricing: {
        basePrice: productData.price,
        salePrice: productData.salePrice || null,
        currency: productData.currency || 'USD'
      },
      status: 'active'
    };

    const productUuid = await dataServe.add('products', product);

    // Index by category
    if (product.category) {
      await this.indexByCategory(productUuid, product.category);
    }

    return { uuid: productUuid, product };
  },

  async updateInventory(productUuid, quantityChange) {
    const product = await dataServe.getByUuid('products', productUuid);
    if (!product) {
      throw new Error('Product not found');
    }

    product.inventory.quantity += quantityChange;
    product.inventory.available = product.inventory.quantity - product.inventory.reserved;
    product.updatedAt = new Date().toISOString();

    await dataServe.remove('products', productUuid);
    const newUuid = await dataServe.add('products', product);

    // Log inventory change
    await dataServe.add('inventory_logs', {
      productUuid: newUuid,
      productId: product.id,
      change: quantityChange,
      newQuantity: product.inventory.quantity,
      timestamp: new Date().toISOString(),
      type: quantityChange > 0 ? 'restock' : 'sale'
    });

    return { uuid: newUuid, product };
  },

  async indexByCategory(productUuid, category) {
    try {
      await dataServe.createContainer('product_categories');
    } catch (err) {
      // Container exists
    }

    await dataServe.add('product_categories', {
      category: category,
      productUuid: productUuid,
      indexedAt: new Date().toISOString()
    });
  },

  async getProductsByCategory(category) {
    const categoryEntries = await dataServe.jsonFindByPath('product_categories', 'category', category);
    const products = [];

    for (const entry of categoryEntries) {
      const product = await dataServe.getByUuid('products', entry.productUuid);
      if (product && product.status === 'active') {
        products.push(product);
      }
    }

    return products;
  },

  async findProductsInPriceRange(minPrice, maxPrice) {
    return await dataServe.jsonFind('products', product => {
      if (product.status !== 'active') return false;
      const price = product.pricing.salePrice || product.pricing.basePrice;
      return price >= minPrice && price <= maxPrice;
    });
  },

  async getLowStockProducts(threshold = 10) {
    return await dataServe.jsonFind('products', product => {
      return product.status === 'active' && product.inventory.available <= threshold;
    });
  },

  async searchProducts(query) {
    return await dataServe.jsonFind('products', product => {
      if (product.status !== 'active') return false;

      const searchableText = [
        product.name,
        product.description || '',
        product.category || '',
        product.sku,
        (product.tags || []).join(' ')
      ].join(' ').toLowerCase();

      return searchableText.includes(query.toLowerCase());
    });
  }
};

// Usage examples
const laptop = await productManager.addProduct({
  name: 'Gaming Laptop Pro',
  description: 'High-performance gaming laptop with RTX graphics',
  category: 'electronics',
  price: 1299.99,
  salePrice: 1199.99,
  quantity: 50,
  tags: ['gaming', 'laptop', 'electronics'],
  brand: 'TechBrand'
});

// Update inventory after a sale
await productManager.updateInventory(laptop.uuid, -1);

// Find products
const electronicsProducts = await productManager.getProductsByCategory('electronics');
const budgetProducts = await productManager.findProductsInPriceRange(100, 500);
const lowStockItems = await productManager.getLowStockProducts(5);
```

**4. Configuration and Settings Management**
```javascript
// Application configuration with versioning
const configManager = {
  async setConfig(configKey, configValue, metadata = {}) {
    const configEntry = {
      key: configKey,
      value: configValue,
      version: Date.now(),
      createdAt: new Date().toISOString(),
      createdBy: metadata.userId || 'system',
      environment: metadata.environment || process.env.NODE_ENV || 'development',
      description: metadata.description || '',
      type: typeof configValue
    };

    // Archive previous version if it exists
    const existing = await this.getConfig(configKey);
    if (existing) {
      existing.archived = true;
      existing.archivedAt = new Date().toISOString();
      await dataServe.add('config_archive', existing);
    }

    const configUuid = await dataServe.add('app_config', configEntry);
    return { uuid: configUuid, config: configEntry };
  },

  async getConfig(configKey, defaultValue = null) {
    const configs = await dataServe.jsonFindByCriteria('app_config', {
      'key': configKey,
      'environment': process.env.NODE_ENV || 'development'
    });

    if (configs.length === 0) {
      return defaultValue;
    }

    // Return the most recent version
    const latest = configs.sort((a, b) => b.version - a.version)[0];
    return latest.value;
  },

  async getAllConfigs() {
    const configs = await dataServe.jsonFindByPath('app_config', 'environment', process.env.NODE_ENV || 'development');
    const configMap = {};

    configs.forEach(config => {
      if (!configMap[config.key] || config.version > configMap[config.key].version) {
        configMap[config.key] = config;
      }
    });

    return configMap;
  },

  async getConfigHistory(configKey) {
    const current = await dataServe.jsonFindByCriteria('app_config', {
      'key': configKey,
      'environment': process.env.NODE_ENV || 'development'
    });

    const archived = await dataServe.jsonFindByPath('config_archive', 'key', configKey);

    return [...current, ...archived].sort((a, b) => b.version - a.version);
  }
};

// Usage
await configManager.setConfig('app.maxUsers', 1000, {
  userId: 'admin_123',
  description: 'Maximum concurrent users allowed'
});

await configManager.setConfig('features.betaFeatures', true, {
  userId: 'admin_123',
  description: 'Enable beta features for testing'
});

const maxUsers = await configManager.getConfig('app.maxUsers', 500);
const allConfigs = await configManager.getAllConfigs();
const userLimitHistory = await configManager.getConfigHistory('app.maxUsers');
```

#### File Management

```javascript
const filing = serviceRegistry.filing('local', {
  baseDir: '/app/uploads'
});

// Upload file from stream
const fileStream = fs.createReadStream('./document.pdf');
await filing.create('documents/report.pdf', fileStream);

// Download file to stream
const downloadStream = await filing.read('documents/report.pdf');

// File operations
const exists = await filing.exists('documents/report.pdf');
const metadata = await filing.getMetadata('documents/report.pdf');
await filing.delete('documents/report.pdf');
```

#### Real-World Filing Service Examples

**1. Document Management System**
```javascript
const fs = require('fs');
const path = require('path');
const filing = serviceRegistry.filing('local', {
  baseDir: path.resolve(__dirname, 'uploads')
});

const documentManager = {
  async uploadDocument(userId, file, metadata = {}) {
    // Generate unique filename
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    const filename = `${timestamp}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `users/${userId}/documents/${filename}`;

    try {
      // Create file stream from buffer or path
      const fileStream = file.buffer ?
        require('stream').Readable.from(file.buffer) :
        fs.createReadStream(file.path);

      // Upload file
      await filing.create(filePath, fileStream);

      // Store document metadata in DataServe
      const documentRecord = {
        userId: userId,
        originalName: file.originalname,
        filename: filename,
        filePath: filePath,
        size: file.size,
        mimeType: file.mimetype,
        uploadedAt: new Date().toISOString(),
        metadata: metadata,
        status: 'active'
      };

      const documentUuid = await dataServe.add('documents', documentRecord);

      return {
        uuid: documentUuid,
        filePath: filePath,
        document: documentRecord
      };
    } catch (error) {
      throw new Error(`Failed to upload document: ${error.message}`);
    }
  },

  async downloadDocument(documentUuid) {
    // Get document metadata
    const document = await dataServe.getByUuid('documents', documentUuid);
    if (!document) {
      throw new Error('Document not found');
    }

    if (document.status !== 'active') {
      throw new Error('Document is not available');
    }

    // Check if file exists
    const exists = await filing.exists(document.filePath);
    if (!exists) {
      throw new Error('File not found on storage');
    }

    // Get file stream
    const fileStream = await filing.read(document.filePath);
    const metadata = await filing.getMetadata(document.filePath);

    return {
      stream: fileStream,
      document: document,
      metadata: metadata
    };
  },

  async deleteDocument(documentUuid) {
    const document = await dataServe.getByUuid('documents', documentUuid);
    if (!document) {
      throw new Error('Document not found');
    }

    try {
      // Delete file from storage
      await filing.delete(document.filePath);

      // Mark document as deleted (soft delete)
      document.status = 'deleted';
      document.deletedAt = new Date().toISOString();

      // Update document record
      await dataServe.remove('documents', documentUuid);
      await dataServe.add('documents', document);

      return { success: true, message: 'Document deleted successfully' };
    } catch (error) {
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  },

  async getUserDocuments(userId) {
    return await dataServe.jsonFindByCriteria('documents', {
      'userId': userId,
      'status': 'active'
    });
  },

  async searchDocuments(searchTerm, userId = null) {
    const criteria = { 'status': 'active' };
    if (userId) {
      criteria.userId = userId;
    }

    const documents = await dataServe.jsonFindByCriteria('documents', criteria);

    return documents.filter(doc => {
      const searchableText = [
        doc.originalName,
        doc.filename,
        doc.metadata.title || '',
        doc.metadata.description || '',
        doc.metadata.tags ? doc.metadata.tags.join(' ') : ''
      ].join(' ').toLowerCase();

      return searchableText.includes(searchTerm.toLowerCase());
    });
  }
};

// Usage with Express.js
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const { userId } = req.body;
    const metadata = {
      title: req.body.title,
      description: req.body.description,
      tags: req.body.tags ? req.body.tags.split(',') : []
    };

    const result = await documentManager.uploadDocument(userId, req.file, metadata);
    res.json({ success: true, document: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents/:uuid/download', async (req, res) => {
  try {
    const { uuid } = req.params;
    const result = await documentManager.downloadDocument(uuid);

    res.set({
      'Content-Type': result.document.mimeType,
      'Content-Disposition': `attachment; filename="${result.document.originalName}"`,
      'Content-Length': result.metadata.size
    });

    result.stream.pipe(res);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});
```

**2. Image Gallery with Thumbnails**
```javascript
const sharp = require('sharp'); // For image processing
const filing = serviceRegistry.filing('local', {
  baseDir: path.resolve(__dirname, 'media')
});

const imageGallery = {
  async uploadImage(userId, imageFile, albumId = 'default') {
    const timestamp = Date.now();
    const extension = path.extname(imageFile.originalname);
    const baseFilename = `${timestamp}_${path.parse(imageFile.originalname).name}`;

    const originalPath = `users/${userId}/albums/${albumId}/originals/${baseFilename}${extension}`;
    const thumbnailPath = `users/${userId}/albums/${albumId}/thumbnails/${baseFilename}_thumb.jpg`;

    try {
      // Upload original image
      const originalStream = require('stream').Readable.from(imageFile.buffer);
      await filing.create(originalPath, originalStream);

      // Generate and upload thumbnail
      const thumbnailBuffer = await sharp(imageFile.buffer)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const thumbnailStream = require('stream').Readable.from(thumbnailBuffer);
      await filing.create(thumbnailPath, thumbnailStream);

      // Store image metadata
      const imageRecord = {
        userId: userId,
        albumId: albumId,
        originalName: imageFile.originalname,
        originalPath: originalPath,
        thumbnailPath: thumbnailPath,
        size: imageFile.size,
        mimeType: imageFile.mimetype,
        uploadedAt: new Date().toISOString(),
        status: 'active'
      };

      const imageUuid = await dataServe.add('images', imageRecord);

      return {
        uuid: imageUuid,
        image: imageRecord
      };
    } catch (error) {
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  },

  async getImageThumbnail(imageUuid) {
    const image = await dataServe.getByUuid('images', imageUuid);
    if (!image || image.status !== 'active') {
      throw new Error('Image not found');
    }

    const thumbnailStream = await filing.read(image.thumbnailPath);
    return { stream: thumbnailStream, image: image };
  },

  async getFullImage(imageUuid) {
    const image = await dataServe.getByUuid('images', imageUuid);
    if (!image || image.status !== 'active') {
      throw new Error('Image not found');
    }

    const imageStream = await filing.read(image.originalPath);
    return { stream: imageStream, image: image };
  },

  async getAlbumImages(userId, albumId) {
    return await dataServe.jsonFindByCriteria('images', {
      'userId': userId,
      'albumId': albumId,
      'status': 'active'
    });
  },

  async createAlbum(userId, albumName, description = '') {
    const album = {
      userId: userId,
      name: albumName,
      description: description,
      createdAt: new Date().toISOString(),
      imageCount: 0,
      status: 'active'
    };

    const albumUuid = await dataServe.add('albums', album);
    return { uuid: albumUuid, album: album };
  }
};

// Usage
const uploadedImage = await imageGallery.uploadImage('user123', imageFile, 'vacation2023');
const albumImages = await imageGallery.getAlbumImages('user123', 'vacation2023');
```

**3. Cloud Storage Integration (S3)**
```javascript
const filing = serviceRegistry.filing('s3', {
  bucket: 'my-app-files',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudFileManager = {
  async uploadToCloud(localFilePath, cloudPath, metadata = {}) {
    try {
      // Read local file
      const fileStream = fs.createReadStream(localFilePath);

      // Upload to S3
      await filing.create(cloudPath, fileStream);

      // Store file record
      const fileRecord = {
        localPath: localFilePath,
        cloudPath: cloudPath,
        uploadedAt: new Date().toISOString(),
        metadata: metadata,
        status: 'uploaded'
      };

      const fileUuid = await dataServe.add('cloud_files', fileRecord);

      return { uuid: fileUuid, cloudPath: cloudPath };
    } catch (error) {
      throw new Error(`Cloud upload failed: ${error.message}`);
    }
  },

  async downloadFromCloud(cloudPath, localPath) {
    try {
      const cloudStream = await filing.read(cloudPath);
      const writeStream = fs.createWriteStream(localPath);

      return new Promise((resolve, reject) => {
        cloudStream.pipe(writeStream);
        writeStream.on('finish', () => resolve(localPath));
        writeStream.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Cloud download failed: ${error.message}`);
    }
  },

  async syncDirectory(localDir, cloudPrefix) {
    const files = fs.readdirSync(localDir);
    const results = [];

    for (const file of files) {
      const localPath = path.join(localDir, file);
      const cloudPath = `${cloudPrefix}/${file}`;

      if (fs.statSync(localPath).isFile()) {
        try {
          const result = await this.uploadToCloud(localPath, cloudPath);
          results.push({ file, status: 'success', ...result });
        } catch (error) {
          results.push({ file, status: 'error', error: error.message });
        }
      }
    }

    return results;
  },

  async getSignedUrl(cloudPath, expiresIn = 3600) {
    // This would integrate with S3's signed URL functionality
    // Implementation depends on the S3 provider implementation
    return `https://signed-url-for-${cloudPath}?expires=${Date.now() + expiresIn * 1000}`;
  }
};

// Usage
await cloudFileManager.uploadToCloud('./backup.zip', 'backups/2025/backup.zip');
await cloudFileManager.downloadFromCloud('backups/2025/backup.zip', './restored-backup.zip');
const syncResults = await cloudFileManager.syncDirectory('./reports', 'reports/2025');
```

**4. File Versioning System**
```javascript
const versioningFileManager = {
  async uploadVersionedFile(filePath, content, userId, comment = '') {
    // Get existing versions
    const existingVersions = await dataServe.jsonFindByPath('file_versions', 'filePath', filePath);
    const nextVersion = existingVersions.length + 1;

    const versionedPath = `${filePath}.v${nextVersion}`;

    try {
      // Upload new version
      const contentStream = typeof content === 'string' ?
        require('stream').Readable.from(content) : content;

      await filing.create(versionedPath, contentStream);

      // Create version record
      const versionRecord = {
        filePath: filePath,
        versionPath: versionedPath,
        version: nextVersion,
        userId: userId,
        comment: comment,
        createdAt: new Date().toISOString(),
        size: typeof content === 'string' ? Buffer.byteLength(content) : content.length || 0
      };

      const versionUuid = await dataServe.add('file_versions', versionRecord);

      // Update current file pointer
      await filing.create(filePath, require('stream').Readable.from(content));

      return {
        uuid: versionUuid,
        version: nextVersion,
        path: versionedPath
      };
    } catch (error) {
      throw new Error(`Version upload failed: ${error.message}`);
    }
  },

  async getFileVersion(filePath, version) {
    const versionRecord = await dataServe.jsonFindByCriteria('file_versions', {
      'filePath': filePath,
      'version': version
    });

    if (versionRecord.length === 0) {
      throw new Error(`Version ${version} not found for ${filePath}`);
    }

    const record = versionRecord[0];
    const fileStream = await filing.read(record.versionPath);

    return {
      stream: fileStream,
      version: record
    };
  },

  async getFileHistory(filePath) {
    const versions = await dataServe.jsonFindByPath('file_versions', 'filePath', filePath);
    return versions.sort((a, b) => b.version - a.version);
  },

  async restoreVersion(filePath, version) {
    const { stream } = await this.getFileVersion(filePath, version);

    // Read version content
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);

    // Upload as new current version
    await filing.create(filePath, require('stream').Readable.from(content));

    return { success: true, restoredVersion: version };
  }
};

// Usage
await versioningFileManager.uploadVersionedFile(
  'documents/project-spec.md',
  'Updated project specification...',
  'user123',
  'Added new requirements section'
);

const history = await versioningFileManager.getFileHistory('documents/project-spec.md');
await versioningFileManager.restoreVersion('documents/project-spec.md', 2);
```

#### Workflow Orchestration

```javascript
const workflow = serviceRegistry.workflow('memory');

// Define workflow steps
const steps = [
  path.resolve(__dirname, './steps/validateInput.js'),
  path.resolve(__dirname, './steps/processData.js'),
  path.resolve(__dirname, './steps/saveResults.js'),
  path.resolve(__dirname, './steps/sendNotification.js')
];

await workflow.defineWorkflow('dataProcessing', steps);

// Execute workflow with callback
workflow.runWorkflow('dataProcessing', { 
  inputData: rawData,
  userId: '123'
}, (result) => {
  console.log('Workflow completed:', result);
});
```

#### Pub/Sub Messaging

```javascript
const notifying = serviceRegistry.notifying('memory');

// Create topic and subscribers
notifying.createTopic('user-events');

notifying.subscribe('user-events', (message) => {
  console.log('User event:', message);
  // Handle user registration, login, etc.
});

notifying.subscribe('user-events', (message) => {
  // Analytics service subscriber
  analyticsService.track(message);
});

// Publish events
notifying.notify('user-events', {
  type: 'user-registered',
  userId: '123',
  timestamp: new Date().toISOString()
});
```

#### Real-World Notifying Service Examples

**1. E-commerce Event System**
```javascript
const notifying = serviceRegistry.notifying('memory');

// Create topics for different business domains
notifying.createTopic('orders');
notifying.createTopic('inventory');
notifying.createTopic('payments');
notifying.createTopic('notifications');

const ecommerceEvents = {
  setupSubscribers() {
    // Order processing subscribers
    notifying.subscribe('orders', async (event) => {
      switch (event.type) {
        case 'order_placed':
          await this.handleOrderPlaced(event.data);
          break;
        case 'order_cancelled':
          await this.handleOrderCancelled(event.data);
          break;
        case 'order_shipped':
          await this.handleOrderShipped(event.data);
          break;
      }
    });

    // Inventory management subscribers
    notifying.subscribe('inventory', async (event) => {
      if (event.type === 'stock_low') {
        await this.notifySuppliers(event.data);
      } else if (event.type === 'product_sold') {
        await this.updateInventory(event.data);
      }
    });

    // Payment processing subscribers
    notifying.subscribe('payments', async (event) => {
      switch (event.type) {
        case 'payment_completed':
          notifying.notify('orders', {
            type: 'payment_confirmed',
            orderId: event.data.orderId,
            amount: event.data.amount
          });
          break;
        case 'payment_failed':
          await this.handleFailedPayment(event.data);
          break;
      }
    });

    // Notification system subscriber
    notifying.subscribe('notifications', async (event) => {
      await this.sendUserNotification(event.data);
    });
  },

  async handleOrderPlaced(orderData) {
    // Reduce inventory
    notifying.notify('inventory', {
      type: 'product_sold',
      productId: orderData.productId,
      quantity: orderData.quantity,
      orderId: orderData.orderId
    });

    // Send user notification
    notifying.notify('notifications', {
      userId: orderData.userId,
      type: 'order_confirmation',
      message: `Your order #${orderData.orderId} has been placed successfully.`,
      orderId: orderData.orderId
    });

    // Log business metrics
    businessMetrics.trackSalesMetrics(orderData.orderId, orderData.amount, orderData.quantity);
  },

  async handleOrderCancelled(orderData) {
    // Restore inventory
    notifying.notify('inventory', {
      type: 'product_returned',
      productId: orderData.productId,
      quantity: orderData.quantity,
      orderId: orderData.orderId
    });

    // Process refund if payment was completed
    if (orderData.paymentStatus === 'completed') {
      notifying.notify('payments', {
        type: 'refund_requested',
        orderId: orderData.orderId,
        amount: orderData.amount
      });
    }
  },

  publishOrderEvent(type, orderData) {
    notifying.notify('orders', {
      type: type,
      data: orderData,
      timestamp: new Date().toISOString(),
      source: 'order_service'
    });
  },

  publishInventoryEvent(type, inventoryData) {
    notifying.notify('inventory', {
      type: type,
      data: inventoryData,
      timestamp: new Date().toISOString(),
      source: 'inventory_service'
    });
  }
};

// Initialize the event system
ecommerceEvents.setupSubscribers();

// Usage in order processing
async function placeOrder(orderData) {
  try {
    // Process order logic...
    const order = await createOrder(orderData);

    // Publish order placed event
    ecommerceEvents.publishOrderEvent('order_placed', {
      orderId: order.id,
      userId: order.userId,
      productId: order.productId,
      quantity: order.quantity,
      amount: order.total
    });

    return order;
  } catch (error) {
    logger.error('Order placement failed', { error: error.message, orderData });
    throw error;
  }
}
```

**2. Real-time System Monitoring**
```javascript
const systemMonitoring = {
  setupSystemMonitoring() {
    // Create monitoring topics
    notifying.createTopic('system_health');
    notifying.createTopic('performance_alerts');
    notifying.createTopic('security_events');

    // System health monitoring
    notifying.subscribe('system_health', (event) => {
      this.handleSystemHealthEvent(event);
    });

    // Performance alert handling
    notifying.subscribe('performance_alerts', (event) => {
      this.handlePerformanceAlert(event);
    });

    // Security event monitoring
    notifying.subscribe('security_events', (event) => {
      this.handleSecurityEvent(event);
    });

    // Start monitoring checks
    this.startHealthChecks();
  },

  startHealthChecks() {
    setInterval(() => {
      this.checkSystemHealth();
    }, 30000); // Every 30 seconds

    setInterval(() => {
      this.checkPerformanceMetrics();
    }, 60000); // Every minute
  },

  checkSystemHealth() {
    const healthData = {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };

    // Check memory usage
    if (healthData.memory.heapUsed > 512 * 1024 * 1024) { // 512MB
      notifying.notify('performance_alerts', {
        type: 'high_memory_usage',
        severity: 'warning',
        data: healthData
      });
    }

    // Publish health status
    notifying.notify('system_health', {
      type: 'health_check',
      status: 'healthy',
      data: healthData
    });
  },

  checkPerformanceMetrics() {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    const avgResponseTime = measuring.average('api.response_time', oneMinuteAgo, now);
    const errorRate = performanceMonitor.calculateErrorRate(oneMinuteAgo, now);

    if (avgResponseTime > 1000) { // 1 second
      notifying.notify('performance_alerts', {
        type: 'slow_response_time',
        severity: 'warning',
        averageResponseTime: avgResponseTime,
        threshold: 1000
      });
    }

    if (errorRate > 5) { // 5% error rate
      notifying.notify('performance_alerts', {
        type: 'high_error_rate',
        severity: 'critical',
        errorRate: errorRate,
        threshold: 5
      });
    }
  },

  handleSystemHealthEvent(event) {
    logger.info('System Health Event', {
      type: event.type,
      status: event.status,
      timestamp: event.timestamp
    });

    // Store health metrics
    if (event.data) {
      measuring.add('system.memory.heap_used', event.data.memory.heapUsed);
      measuring.add('system.uptime', event.data.uptime);
    }
  },

  handlePerformanceAlert(event) {
    logger.warn('Performance Alert', {
      type: event.type,
      severity: event.severity,
      data: event
    });

    // Send alert to monitoring system
    if (event.severity === 'critical') {
      // In a real system, this would send to PagerDuty, Slack, etc.
      console.error('CRITICAL ALERT:', event);
    }
  },

  handleSecurityEvent(event) {
    logger.error('Security Event', {
      type: event.type,
      severity: event.severity || 'high',
      data: event
    });

    // Store security event for analysis
    dataServe.add('security_events', {
      ...event,
      investigationStatus: 'pending',
      createdAt: new Date().toISOString()
    });
  }
};

// Initialize monitoring
systemMonitoring.setupSystemMonitoring();

// Usage: Publish security events from authentication middleware
app.use((req, res, next) => {
  // Check for suspicious activity
  if (req.headers['user-agent'].includes('bot') && req.path.includes('/admin')) {
    notifying.notify('security_events', {
      type: 'suspicious_admin_access',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      timestamp: new Date().toISOString()
    });
  }

  next();
});
```

#### Background Task Processing

```javascript
const worker = serviceRegistry.working('memory');
const queue = serviceRegistry.queue('memory');

// Add tasks to queue
queue.enqueue({
  type: 'sendEmail',
  recipient: 'user@example.com',
  template: 'welcome'
});

queue.enqueue({
  type: 'generateReport',
  reportId: '456',
  format: 'pdf'
});

// Start worker to process tasks
worker.start('./workers/taskProcessor.js', (result) => {
  console.log('Task completed:', result);
});
```

#### Real-World Queue and Background Processing Examples

**1. Email Processing System**
```javascript
const queue = serviceRegistry.queueing('memory');
const worker = serviceRegistry.working('memory');

const emailProcessor = {
  async sendWelcomeEmail(data) {
    queue.enqueue({
      type: 'email',
      template: 'welcome',
      recipient: data.email,
      userId: data.userId,
      personalizations: {
        firstName: data.firstName,
        activationUrl: `https://app.example.com/activate/${data.activationToken}`
      },
      priority: 'normal'
    });
  },

  async sendPasswordResetEmail(data) {
    queue.enqueue({
      type: 'email',
      template: 'password_reset',
      recipient: data.email,
      personalizations: {
        resetUrl: `https://app.example.com/reset/${data.resetToken}`,
        expiresIn: '1 hour'
      },
      priority: 'high' // High priority for security-related emails
    });
  },

  async sendBulkNewsletter(subscribers, newsletterData) {
    // Break down bulk email into smaller batches
    const batchSize = 100;
    for (let i = 0; i < subscribers.length; i += batchSize) {
      const batch = subscribers.slice(i, i + batchSize);

      queue.enqueue({
        type: 'bulk_email',
        template: 'newsletter',
        batch: batch,
        content: newsletterData,
        priority: 'low',
        batchId: `newsletter_${Date.now()}_${i / batchSize}`
      });
    }
  },

  async processEmailQueue() {
    // Start worker to process email tasks
    worker.start('./workers/emailWorker.js', (result) => {
      if (result.success) {
        logger.info('Email sent successfully', {
          recipient: result.recipient,
          template: result.template,
          messageId: result.messageId
        });

        // Track email metrics
        measuring.add('emails.sent', 1);
        measuring.add(`emails.${result.template}.sent`, 1);
      } else {
        logger.error('Email sending failed', {
          recipient: result.recipient,
          template: result.template,
          error: result.error
        });

        measuring.add('emails.failed', 1);

        // Retry failed emails with exponential backoff
        if (result.retryCount < 3) {
          setTimeout(() => {
            queue.enqueue({
              ...result.task,
              retryCount: (result.retryCount || 0) + 1
            });
          }, Math.pow(2, result.retryCount || 0) * 1000); // 1s, 2s, 4s delays
        }
      }
    });
  },

  getQueueStatus() {
    return {
      queueSize: queue.size(),
      isWorkerRunning: worker.status === 'running'
    };
  }
};

// Usage
emailProcessor.sendWelcomeEmail({
  email: 'newuser@example.com',
  firstName: 'John',
  userId: 'user123',
  activationToken: 'abc123'
});

emailProcessor.processEmailQueue();
```

**2. Image Processing Pipeline**
```javascript
const imageQueue = serviceRegistry.queueing('memory');
const imageWorker = serviceRegistry.working('memory');

const imageProcessor = {
  async processUploadedImage(imageData) {
    // Queue image processing tasks
    imageQueue.enqueue({
      type: 'resize_image',
      imageId: imageData.id,
      imagePath: imageData.path,
      sizes: [
        { name: 'thumbnail', width: 150, height: 150 },
        { name: 'medium', width: 500, height: 500 },
        { name: 'large', width: 1200, height: 1200 }
      ],
      userId: imageData.userId
    });

    imageQueue.enqueue({
      type: 'extract_metadata',
      imageId: imageData.id,
      imagePath: imageData.path
    });

    imageQueue.enqueue({
      type: 'generate_ai_tags',
      imageId: imageData.id,
      imagePath: imageData.path
    });
  },

  startImageProcessing() {
    imageWorker.start('./workers/imageWorker.js', async (result) => {
      if (result.success) {
        switch (result.type) {
          case 'resize_image':
            await this.handleImageResizeComplete(result);
            break;
          case 'extract_metadata':
            await this.handleMetadataExtraction(result);
            break;
          case 'generate_ai_tags':
            await this.handleAITagging(result);
            break;
        }
      } else {
        logger.error('Image processing failed', {
          type: result.type,
          imageId: result.imageId,
          error: result.error
        });
      }
    });
  },

  async handleImageResizeComplete(result) {
    // Update image record with resized versions
    const imageRecord = await dataServe.getByUuid('images', result.imageId);
    if (imageRecord) {
      imageRecord.variants = result.variants;
      imageRecord.processingStatus = 'resize_complete';

      await dataServe.remove('images', result.imageId);
      await dataServe.add('images', imageRecord);

      // Notify user that image is processed
      notifying.notify('user_notifications', {
        userId: result.userId,
        type: 'image_processed',
        message: 'Your image has been processed and is ready to view.',
        imageId: result.imageId
      });
    }
  },

  async handleMetadataExtraction(result) {
    // Store extracted metadata
    await dataServe.add('image_metadata', {
      imageId: result.imageId,
      metadata: result.metadata,
      extractedAt: new Date().toISOString()
    });
  },

  async handleAITagging(result) {
    // Store AI-generated tags
    const imageRecord = await dataServe.getByUuid('images', result.imageId);
    if (imageRecord) {
      imageRecord.aiTags = result.tags;
      imageRecord.confidence = result.confidence;

      await dataServe.remove('images', result.imageId);
      await dataServe.add('images', imageRecord);
    }
  }
};

// Usage when user uploads image
app.post('/api/images/upload', upload.single('image'), async (req, res) => {
  try {
    const imageData = await saveImageToStorage(req.file);
    await imageProcessor.processUploadedImage(imageData);

    res.json({
      success: true,
      imageId: imageData.id,
      message: 'Image uploaded and queued for processing'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

imageProcessor.startImageProcessing();
```

#### Complete Integration Example

**Real-World E-commerce Application Integration**
```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// Initialize service registry with API key security
serviceRegistry.initialize(app, {
  apiKeys: [process.env.API_KEY],
  requireApiKey: true,
  excludePaths: [
    '/services/*/status',
    '/services/',
    '/health'
  ]
});

// Initialize all services
const cache = serviceRegistry.cache(process.env.CACHE_PROVIDER || 'memory', {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT) || 6379
});

const dataServe = serviceRegistry.dataServe(process.env.DATA_PROVIDER || 'memory');
const filing = serviceRegistry.filing(process.env.FILE_PROVIDER || 'local', {
  baseDir: './uploads'
});

const logger = serviceRegistry.logger(process.env.LOG_PROVIDER || 'console');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const queue = serviceRegistry.queueing('memory');
const workflow = serviceRegistry.workflow('memory');

// Complete e-commerce application
const ecommerceApp = {
  async initializeApplication() {
    // Setup event subscriptions
    this.setupEventHandlers();

    // Initialize background workers
    this.startBackgroundProcessing();

    // Setup monitoring
    this.setupMonitoring();

    logger.info('E-commerce application initialized');
  },

  setupEventHandlers() {
    // Setup all the event handlers from previous examples
    notifying.createTopic('orders');
    notifying.createTopic('inventory');
    notifying.createTopic('users');

    notifying.subscribe('orders', async (event) => {
      await this.handleOrderEvent(event);
    });

    notifying.subscribe('inventory', async (event) => {
      await this.handleInventoryEvent(event);
    });
  },

  startBackgroundProcessing() {
    // Start email processing
    emailProcessor.processEmailQueue();

    // Start image processing
    imageProcessor.startImageProcessing();

    // Process general queue items
    setInterval(async () => {
      const queueSize = queue.size();
      if (queueSize > 0) {
        const task = queue.dequeue();
        if (task) {
          await this.processTask(task);
        }
      }
    }, 1000); // Process queue every second
  },

  setupMonitoring() {
    // Setup health checks
    setInterval(() => {
      const health = {
        cache: cache.status || 'unknown',
        queue: queue.size(),
        memory: process.memoryUsage(),
        uptime: process.uptime()
      };

      measuring.add('system.queue_size', queue.size());
      measuring.add('system.memory_usage', process.memoryUsage().heapUsed);

      if (health.memory.heapUsed > 512 * 1024 * 1024) {
        logger.warn('High memory usage detected', health);
      }
    }, 30000);
  },

  async processTask(task) {
    const startTime = Date.now();

    try {
      switch (task.type) {
        case 'send_notification':
          await this.sendUserNotification(task.data);
          break;
        case 'update_inventory':
          await this.updateProductInventory(task.data);
          break;
        case 'generate_report':
          await this.generateReport(task.data);
          break;
        default:
          logger.warn('Unknown task type', { type: task.type });
      }

      measuring.add('tasks.completed', 1);
      measuring.add(`tasks.${task.type}.completed`, 1);
      measuring.add('tasks.duration', Date.now() - startTime);

    } catch (error) {
      logger.error('Task processing failed', {
        task: task,
        error: error.message
      });

      measuring.add('tasks.failed', 1);
    }
  },

  // API Endpoints
  setupRoutes() {
    // User registration
    app.post('/api/register', async (req, res) => {
      try {
        const user = await this.createUser(req.body);

        // Cache user data
        await cache.put(`user:${user.id}`, user, 3600);

        // Send welcome email
        emailProcessor.sendWelcomeEmail(user);

        // Track user registration
        measuring.add('users.registered', 1);
        businessMetrics.trackUserEngagement(user.id, 'registration');

        res.json({ success: true, user: user });
      } catch (error) {
        logger.error('User registration failed', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Product search with caching
    app.get('/api/products/search', async (req, res) => {
      try {
        const { query, category } = req.query;
        const cacheKey = `search:${query}:${category}`;

        // Try cache first
        let results = await cache.get(cacheKey);
        if (results) {
          measuring.add('search.cache_hit', 1);
          return res.json(results);
        }

        // Search products
        results = await this.searchProducts(query, category);

        // Cache results for 15 minutes
        await cache.put(cacheKey, results, 900);

        measuring.add('search.cache_miss', 1);
        measuring.add('search.queries', 1);

        res.json(results);
      } catch (error) {
        logger.error('Product search failed', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Order placement
    app.post('/api/orders', async (req, res) => {
      try {
        const order = await this.createOrder(req.body);

        // Publish order event
        notifying.notify('orders', {
          type: 'order_placed',
          data: order
        });

        res.json({ success: true, order: order });
      } catch (error) {
        logger.error('Order creation failed', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          cache: cache.status || 'ok',
          queue: queue.size(),
          uptime: process.uptime()
        }
      };

      res.json(health);
    });
  }
};

// Initialize and start the application
ecommerceApp.initializeApplication();
ecommerceApp.setupRoutes();

app.listen(3000, () => {
  logger.info('E-commerce application started on port 3000');
});

module.exports = app;
```

#### Logging Service Examples

**1. Application Logging with Multiple Levels**
```javascript
const logger = serviceRegistry.logger('file', {
  filename: './logs/app.log',
  maxFiles: 5,
  maxSize: '10m'
});

// Different log levels
logger.info('Application started', { port: 3000, environment: 'production' });
logger.warn('Rate limit approaching', { userId: '123', requests: 95 });
logger.error('Database connection failed', {
  error: 'Connection timeout',
  host: 'db.example.com',
  retryAttempt: 3
});
logger.debug('Cache hit', { key: 'user:123', hitRatio: 0.85 });

// Structured logging for monitoring
const requestLogger = {
  logRequest(req, res, responseTime) {
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      responseTime: responseTime,
      statusCode: res.statusCode,
      contentLength: res.get('Content-Length')
    });
  },

  logError(error, req) {
    logger.error('Request Error', {
      message: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      body: req.body,
      headers: req.headers
    });
  },

  logSecurity(event, details) {
    logger.warn('Security Event', {
      event: event,
      timestamp: new Date().toISOString(),
      ...details
    });
  }
};

// Usage in Express middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    requestLogger.logRequest(req, res, Date.now() - start);
  });

  next();
});
```

**2. Business Logic Logging**
```javascript
const businessLogger = {
  logUserAction(userId, action, details = {}) {
    logger.info('User Action', {
      userId: userId,
      action: action,
      timestamp: new Date().toISOString(),
      ...details
    });
  },

  logBusinessEvent(eventType, data) {
    logger.info('Business Event', {
      eventType: eventType,
      data: data,
      timestamp: new Date().toISOString()
    });
  },

  logPerformanceMetric(operation, duration, metadata = {}) {
    logger.info('Performance Metric', {
      operation: operation,
      duration: duration,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }
};

// Usage examples
businessLogger.logUserAction('user123', 'purchase', {
  orderId: 'order456',
  amount: 99.99,
  items: ['item1', 'item2']
});

businessLogger.logBusinessEvent('inventory_low', {
  productId: 'prod789',
  currentStock: 5,
  threshold: 10
});

const start = Date.now();
await expensiveOperation();
businessLogger.logPerformanceMetric('database_query', Date.now() - start, {
  query: 'getUserOrders',
  userId: 'user123'
});
```

#### Metrics Collection

```javascript
const measuring = serviceRegistry.measuring('memory');

// Record metrics
measuring.add('api.response.time', 145); // milliseconds
measuring.add('api.request.count', 1);
measuring.add('memory.usage', process.memoryUsage().heapUsed);

// Query metrics
const responseTimeMetrics = measuring.list(
  'api.response.time',
  new Date('2025-08-25T00:00:00Z'),
  new Date('2025-08-25T23:59:59Z')
);

const totalRequests = measuring.total(
  'api.request.count',
  startDate,
  endDate
);

console.log('Average response time:',
  measuring.average('api.response.time', startDate, endDate));
```

#### Real-World Measuring Service Examples

**1. API Performance Monitoring**
```javascript
const measuring = serviceRegistry.measuring('memory');

const performanceMonitor = {
  trackApiCall(endpoint, method, duration, statusCode) {
    // Track response times
    measuring.add(`api.${endpoint}.response_time`, duration);

    // Track request counts
    measuring.add(`api.${endpoint}.requests`, 1);

    // Track status codes
    measuring.add(`api.${endpoint}.status.${statusCode}`, 1);

    // Track errors
    if (statusCode >= 400) {
      measuring.add(`api.${endpoint}.errors`, 1);
    }
  },

  trackCachePerformance(operation, hitOrMiss, duration) {
    measuring.add(`cache.${operation}.${hitOrMiss}`, 1);
    measuring.add(`cache.${operation}.duration`, duration);
  },

  trackDatabaseQuery(queryType, duration, resultCount) {
    measuring.add(`db.${queryType}.duration`, duration);
    measuring.add(`db.${queryType}.result_count`, resultCount);
    measuring.add(`db.queries.total`, 1);
  },

  getPerformanceReport(startDate, endDate) {
    return {
      apiMetrics: {
        totalRequests: measuring.total('api.requests', startDate, endDate),
        averageResponseTime: measuring.average('api.response_time', startDate, endDate),
        errorRate: this.calculateErrorRate(startDate, endDate)
      },
      cacheMetrics: {
        hitRate: this.calculateCacheHitRate(startDate, endDate),
        averageCacheDuration: measuring.average('cache.duration', startDate, endDate)
      },
      databaseMetrics: {
        totalQueries: measuring.total('db.queries.total', startDate, endDate),
        averageQueryTime: measuring.average('db.duration', startDate, endDate)
      }
    };
  },

  calculateErrorRate(startDate, endDate) {
    const totalRequests = measuring.total('api.requests', startDate, endDate);
    const totalErrors = measuring.total('api.errors', startDate, endDate);
    return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  },

  calculateCacheHitRate(startDate, endDate) {
    const hits = measuring.total('cache.hit', startDate, endDate);
    const misses = measuring.total('cache.miss', startDate, endDate);
    const total = hits + misses;
    return total > 0 ? (hits / total) * 100 : 0;
  }
};

// Usage in middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const endpoint = req.route ? req.route.path : req.path;
    performanceMonitor.trackApiCall(endpoint, req.method, duration, res.statusCode);
  });

  next();
});
```

**2. Business Metrics Collection**
```javascript
const businessMetrics = {
  trackUserEngagement(userId, action, duration = null) {
    measuring.add('users.active', 1);
    measuring.add(`users.actions.${action}`, 1);

    if (duration) {
      measuring.add(`users.session_duration.${action}`, duration);
    }
  },

  trackSalesMetrics(orderId, amount, itemCount) {
    measuring.add('sales.orders', 1);
    measuring.add('sales.revenue', amount);
    measuring.add('sales.items', itemCount);
  },

  trackInventoryChanges(productId, changeType, quantity) {
    measuring.add(`inventory.${changeType}`, quantity);
    measuring.add('inventory.transactions', 1);
  },

  getDashboardMetrics(period = '24h') {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago

    return {
      users: {
        activeUsers: measuring.total('users.active', startDate, endDate),
        averageSessionDuration: measuring.average('users.session_duration', startDate, endDate)
      },
      sales: {
        totalOrders: measuring.total('sales.orders', startDate, endDate),
        totalRevenue: measuring.total('sales.revenue', startDate, endDate),
        averageOrderValue: measuring.average('sales.revenue', startDate, endDate)
      },
      inventory: {
        totalTransactions: measuring.total('inventory.transactions', startDate, endDate),
        stockMovements: {
          additions: measuring.total('inventory.add', startDate, endDate),
          removals: measuring.total('inventory.remove', startDate, endDate)
        }
      }
    };
  }
};

// Usage examples
businessMetrics.trackUserEngagement('user123', 'product_view', 45000); // 45 seconds
businessMetrics.trackSalesMetrics('order456', 199.99, 3);
businessMetrics.trackInventoryChanges('prod789', 'remove', 1);

const dashboard = businessMetrics.getDashboardMetrics();
console.log('Dashboard Metrics:', dashboard);
```

### Event-Driven Architecture

```javascript
// Get global event emitter
const eventEmitter = serviceRegistry.getEventEmitter();

// Listen for service events
eventEmitter.on('cache-hit', (data) => {
  console.log('Cache hit:', data);
});

eventEmitter.on('cache-miss', (data) => {
  console.log('Cache miss:', data);
  // Maybe log for analytics
});

eventEmitter.on('api-auth-failure', (data) => {
  console.log('Security alert:', data);
  // Send alert to monitoring system
});

eventEmitter.on('workflow-completed', (data) => {
  console.log('Workflow finished:', data);
  // Trigger next business process
});

// Emit custom events
eventEmitter.emit('business-event', { 
  type: 'order-placed',
  orderId: '789'
});
```

---

## Web Interface

### Service Registry Dashboard

Navigate to `http://localhost:3000/services/` to access the main service registry dashboard. This provides:

- **Service status overview**
- **Interactive API testing**
- **Real-time metrics**
- **Configuration management**

### Individual Service Interfaces

Each service provides its own web interface:

```
http://localhost:3000/services/caching/views/     # Caching service UI
http://localhost:3000/services/dataserve/views/   # Data service UI  
http://localhost:3000/services/filing/views/      # File management UI
http://localhost:3000/services/workflow/views/    # Workflow designer
```

### UI Theme Options

The framework includes multiple UI themes:

```javascript
// In your HTML or routing
app.use('/theme-glass', express.static(path.join(__dirname, 'themes/glass')));
app.use('/theme-flat', express.static(path.join(__dirname, 'themes/flat')));
app.use('/theme-material', express.static(path.join(__dirname, 'themes/material')));
app.use('/theme-minimalist', express.static(path.join(__dirname, 'themes/minimalist')));
app.use('/theme-shadcn', express.static(path.join(__dirname, 'themes/shadcn')));
```

### API Testing Interface

Each service provides interactive API testing through the web interface:

1. Navigate to service-specific views
2. Use built-in forms to test API endpoints
3. View real-time responses and logs
4. Export API calls as curl commands

---

## Authentication & Security

### API Key Management

```javascript
// Generate secure API keys
const apiKey = serviceRegistry.generateApiKey(32); // 32-character key
const shortKey = serviceRegistry.generateApiKey(16); // 16-character key

// Validate API key format
const { isValidApiKeyFormat } = require('noobly-core/src/middleware/apiKeyAuth');
console.log(isValidApiKeyFormat('abc123')); // false (too short)
console.log(isValidApiKeyFormat('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6')); // true
```

### Security Configuration

```javascript
// Strict security - all endpoints require API key
serviceRegistry.initialize(app, {
  apiKeys: ['key1', 'key2', 'key3'],
  requireApiKey: true,
  excludePaths: [] // No excluded paths
});

// Relaxed security - only sensitive endpoints require API key
serviceRegistry.initialize(app, {
  apiKeys: ['secure-key'],
  requireApiKey: true,
  excludePaths: [
    '/services/*/status',      // Health checks
    '/services/',              // Main dashboard
    '/services/*/views/*',     // Web interfaces
    '/public/*'                // Static assets
  ]
});

// Development mode - no API key required
serviceRegistry.initialize(app, {
  requireApiKey: false
});
```

### Security Event Monitoring

```javascript
const eventEmitter = serviceRegistry.getEventEmitter();

// Monitor authentication events
eventEmitter.on('api-auth-success', (data) => {
  console.log('✅ Successful auth:', {
    ip: data.ip,
    path: data.path,
    method: data.method,
    keyPrefix: data.keyPrefix
  });
});

eventEmitter.on('api-auth-failure', (data) => {
  console.log('❌ Failed auth:', {
    reason: data.reason,
    ip: data.ip,
    path: data.path,
    method: data.method
  });
  
  // Implement rate limiting, alerting, etc.
  if (data.reason === 'invalid-api-key') {
    securityService.flagSuspiciousActivity(data.ip);
  }
});

eventEmitter.on('api-auth-setup', (data) => {
  console.log('🔐 Auth configured:', data);
});
```

### Best Security Practices

1. **Rotate API Keys Regularly**
   ```javascript
   // Schedule key rotation
   setInterval(() => {
     const newKey = serviceRegistry.generateApiKey();
     // Update your configuration
   }, 30 * 24 * 60 * 60 * 1000); // 30 days
   ```

2. **Use Environment Variables**
   ```javascript
   const apiKeys = [
     process.env.API_KEY_1,
     process.env.API_KEY_2
   ].filter(Boolean);
   
   serviceRegistry.initialize(app, { apiKeys });
   ```

3. **Implement Rate Limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   app.use('/services/', rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 1000 // requests per window
   }));
   ```

---

## Service Reference

### Caching Service

**Purpose**: High-performance in-memory and distributed caching

**Providers**:
- `memory`: LRU cache with analytics
- `redis`: Distributed Redis backend  
- `memcached`: Memcached backend

**Methods**:
```javascript
await cache.put(key, value, ttl?);     // Store with optional TTL
const value = await cache.get(key);    // Retrieve
await cache.delete(key);               // Remove
const analytics = cache.getAnalytics(); // Performance data
const status = cache.status;           // Service status
```

**Configuration**:
```javascript
// Redis configuration
const cache = serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  password: 'secret',
  keyPrefix: 'myapp:',
  enableAnalytics: true,
  defaultTTL: 3600
});

// Memory configuration
const cache = serviceRegistry.cache('memory', {
  maxSize: 1000,
  enableAnalytics: true,
  defaultTTL: 3600
});
```

### DataServe Service

**Purpose**: Container-based persistent data storage with JSON search capabilities - works like a database

**Providers**:
- `memory`: In-memory storage with container organization
- `simpledb`: AWS SimpleDB with container mapping
- `file`: File-based storage with JSON persistence

**Core Methods**:
```javascript
// Database-style operations with UUIDs
await dataServe.createContainer(containerName);    // Create container
const uuid = await dataServe.add(container, data); // Insert data, get UUID
const data = await dataServe.getByUuid(container, uuid); // Retrieve by UUID
await dataServe.remove(container, uuid);           // Delete by UUID

// Container and search operations
await dataServe.find(container, searchTerm);       // Find objects containing term
const status = dataServe.status;                   // Service status
```

**JSON Search Methods**:
```javascript
// Custom predicate search (like Array.find)
const results = await dataServe.jsonFind(container, obj => obj.status === 'active');

// Path-based search (nested property matching)
const results = await dataServe.jsonFindByPath(container, 'profile.department', 'engineering');

// Multi-criteria search (multiple conditions)
const results = await dataServe.jsonFindByCriteria(container, {
  'status': 'active',
  'profile.role': 'senior-developer',
  'profile.department': 'engineering'
});
```

**Configuration Examples**:
```javascript
// File-based provider with custom directory
const dataServe = serviceRegistry.dataServe('file', {
  baseDir: './data/containers'
});

// SimpleDB provider configuration
const dataServe = serviceRegistry.dataServe('simpledb', {
  domain: 'myapp-containers',
  region: 'us-east-1'
});
```

### Filing Service

**Purpose**: File upload, download, and management

**Providers**:
- `local`: Local filesystem
- `ftp`: FTP server
- `s3`: AWS S3
- `git`: Git repository
- `sync`: Synchronized filing

**Methods**:
```javascript
await filing.create(path, content);    // Upload file
const content = await filing.read(path); // Download
await filing.delete(path);             // Remove file
const exists = await filing.exists(path); // Check existence
const metadata = await filing.getMetadata(path); // File info
```

### Logging Service

**Purpose**: Application logging and monitoring

**Providers**:
- `console`: Console output
- `file`: File-based with rotation

**Methods**:
```javascript
logger.info(message, ...args);         // Info level
logger.warn(message, ...args);         // Warning level
logger.error(message, ...args);        // Error level
logger.debug(message, ...args);        // Debug level
```

### Measuring Service

**Purpose**: Metrics collection and time-series data

**Methods**:
```javascript
measuring.add(metric, value, timestamp?); // Record measurement
const data = measuring.list(metric, startDate, endDate); // Query range
const total = measuring.total(metric, startDate, endDate); // Sum values
const avg = measuring.average(metric, startDate, endDate); // Average
```

### Notifying Service

**Purpose**: Pub/sub messaging system

**Methods**:
```javascript
notifying.createTopic(topicName);       // Create topic
notifying.subscribe(topic, callback);   // Add subscriber
notifying.notify(topic, message);       // Publish message
notifying.unsubscribe(topic, callback); // Remove subscriber
```

### Queueing Service

**Purpose**: FIFO task queue processing

**Methods**:
```javascript
queue.enqueue(task);                   // Add task
const task = queue.dequeue();          // Get next task
const size = queue.size();             // Queue size
queue.clear();                         // Empty queue
```

### Scheduling Service

**Purpose**: Delayed and recurring task execution

**Methods**:
```javascript
const taskId = scheduling.schedule(name, script, data, delay, callback);
scheduling.cancel(taskId);             // Cancel scheduled task
const status = scheduling.status;      // Scheduler status
```

### Searching Service

**Purpose**: Full-text search and indexing

**Methods**:
```javascript
searching.add(id, object);             // Index object
const results = searching.search(term); // Search
searching.delete(id);                  // Remove from index
```

### Workflow Service

**Purpose**: Multi-step workflow orchestration

**Methods**:
```javascript
await workflow.defineWorkflow(name, steps); // Define workflow
workflow.runWorkflow(name, data, callback);  // Execute
const status = workflow.status;              // Service status
```

### Working Service

**Purpose**: Background script execution

**Methods**:
```javascript
worker.start(scriptPath, callback);    // Start worker
worker.stop();                        // Stop worker
const status = worker.status;          // Worker status
```

---

## Configuration

### Environment Configuration

```bash
# .env file
NODE_ENV=production
PORT=3000

# API Keys
API_KEY_1=your-production-api-key-here
API_KEY_2=your-backup-api-key-here

# Redis Configuration
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# AWS Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Database
DB_HOST=db.example.com
DB_PORT=5432
DB_NAME=myapp
DB_USER=myuser
DB_PASS=mypass

# File Storage
UPLOAD_DIR=/var/uploads
S3_BUCKET=myapp-files
```

### Service-Specific Configuration

```javascript
// config/services.js
module.exports = {
  cache: {
    provider: process.env.CACHE_PROVIDER || 'memory',
    redis: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      keyPrefix: process.env.REDIS_PREFIX || 'myapp:'
    }
  },
  
  dataServe: {
    provider: process.env.DATA_PROVIDER || 'memory',
    simpledb: {
      domain: process.env.SIMPLEDB_DOMAIN,
      region: process.env.AWS_REGION
    }
  },
  
  filing: {
    provider: process.env.FILE_PROVIDER || 'local',
    local: {
      baseDir: process.env.UPLOAD_DIR || './uploads'
    },
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.AWS_REGION
    }
  },
  
  logging: {
    provider: process.env.LOG_PROVIDER || 'console',
    file: {
      filename: process.env.LOG_FILE || './app.log',
      maxFiles: 5,
      maxSize: '10m'
    }
  }
};
```

### Application Configuration Pattern

```javascript
// app.js
const config = require('./config/services');
const serviceRegistry = require('noobly-core');

const app = express();

// Initialize with configuration
serviceRegistry.initialize(app, {
  apiKeys: [
    process.env.API_KEY_1,
    process.env.API_KEY_2
  ].filter(Boolean),
  requireApiKey: process.env.NODE_ENV === 'production'
});

// Configure services with environment-specific providers
const cache = serviceRegistry.cache(
  config.cache.provider,
  config.cache[config.cache.provider]
);

const dataServe = serviceRegistry.dataServe(
  config.dataServe.provider,
  config.dataServe[config.dataServe.provider]
);

const filing = serviceRegistry.filing(
  config.filing.provider,
  config.filing[config.filing.provider]
);
```

---

## Deployment

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/services/caching/api/status || exit 1

# Start application
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - API_KEY_1=${API_KEY_1}
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nooblyjs-core
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nooblyjs-core
  template:
    metadata:
      labels:
        app: nooblyjs-core
    spec:
      containers:
      - name: app
        image: your-registry/nooblyjs-core:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_HOST
          value: "redis-service"
        - name: API_KEY_1
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: api-key-1
        readinessProbe:
          httpGet:
            path: /services/caching/api/status
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /services/caching/api/status
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10

---
apiVersion: v1
kind: Service
metadata:
  name: nooblyjs-core-service
spec:
  selector:
    app: nooblyjs-core
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### Process Manager (PM2)

```json
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'nooblyjs-core',
    script: './app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      CACHE_PROVIDER: 'redis',
      REDIS_HOST: 'localhost'
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

```bash
# Deploy with PM2
pm2 start ecosystem.config.js --env production
pm2 startup
pm2 save
```

---

## Testing

### API Testing

The framework includes comprehensive HTTP test files in `/tests/api/`:

```bash
# Using REST Client extension in VS Code
# Open tests/api/caching/caching.http
# Set variables at the top:
@baseUrl = http://localhost:3000
@apiKey = your-api-key-here

# Then execute requests directly in editor
```

### Unit Testing

```javascript
// tests/unit/cache.test.js
const serviceRegistry = require('../../index');

describe('Caching Service', () => {
  let cache;
  
  beforeEach(() => {
    cache = serviceRegistry.cache('memory');
  });
  
  test('should store and retrieve data', async () => {
    await cache.put('test-key', { data: 'test-value' });
    const result = await cache.get('test-key');
    expect(result.data).toBe('test-value');
  });
  
  test('should handle non-existent keys', async () => {
    const result = await cache.get('non-existent');
    expect(result).toBeNull();
  });
});
```

### Load Testing

```javascript
// tests/load/caching/loadTest.js
const axios = require('axios');

const baseUrl = 'http://localhost:3000';
const apiKey = 'your-test-api-key';

async function runLoadTest() {
  const concurrent = 100;
  const requests = 1000;
  
  console.log(`Starting load test: ${concurrent} concurrent, ${requests} total`);
  
  const promises = [];
  for (let i = 0; i < requests; i++) {
    promises.push(
      axios.post(`${baseUrl}/services/caching/api/put/test-${i}`, 
        { data: `test-data-${i}` },
        { headers: { 'x-api-key': apiKey } }
      )
    );
    
    if (promises.length >= concurrent) {
      await Promise.all(promises);
      promises.length = 0;
    }
  }
  
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  
  console.log('Load test completed');
}

runLoadTest().catch(console.error);
```

### Integration Testing

```javascript
// tests/integration/workflow.test.js
const serviceRegistry = require('../../index');
const express = require('express');

describe('Service Integration', () => {
  let app, cache, queue, workflow;
  
  beforeAll(() => {
    app = express();
    serviceRegistry.initialize(app);
    
    cache = serviceRegistry.cache('memory');
    queue = serviceRegistry.queue('memory');
    workflow = serviceRegistry.workflow('memory');
  });
  
  test('workflow should process queue tasks', async () => {
    // Define workflow that processes queue
    await workflow.defineWorkflow('queueProcessor', [
      './tests/steps/dequeueTask.js',
      './tests/steps/processTask.js',
      './tests/steps/cacheResult.js'
    ]);
    
    // Add task to queue
    queue.enqueue({ type: 'test', data: 'test-data' });
    
    // Run workflow
    await new Promise((resolve) => {
      workflow.runWorkflow('queueProcessor', {}, resolve);
    });
    
    // Verify result was cached
    const result = await cache.get('processed-result');
    expect(result).toBeDefined();
  });
});
```

---

## Best Practices

### Service Architecture

1. **Use Appropriate Providers**
   ```javascript
   // Development
   const cache = serviceRegistry.cache('memory');
   
   // Production
   const cache = serviceRegistry.cache('redis', {
     host: process.env.REDIS_HOST,
     enableAnalytics: true
   });
   ```

2. **Implement Error Handling**
   ```javascript
   try {
     const data = await cache.get('user:123');
     if (!data) {
       data = await fetchUserFromDatabase('123');
       await cache.put('user:123', data, 3600);
     }
     return data;
   } catch (error) {
     logger.error('Cache error:', error);
     // Fallback to database
     return await fetchUserFromDatabase('123');
   }
   ```

3. **Use Event-Driven Patterns**
   ```javascript
   const eventEmitter = serviceRegistry.getEventEmitter();
   
   // Business logic with database-style data storage
   eventEmitter.on('user-registered', async (userData) => {
     // Store user and get UUID
     const userUuid = await dataServe.add('users', userData);
     await cache.put(`user:${userData.id}`, userData);
     
     // Store in analytics container for reporting
     const analyticsUuid = await dataServe.add('analytics', {
       userId: userData.id,
       userUuid: userUuid,
       timestamp: new Date().toISOString(),
       source: userData.source || 'web'
     });
     
     // Queue welcome email with UUIDs for reference
     queue.enqueue({ 
       type: 'sendWelcomeEmail', 
       userId: userData.id,
       userUuid: userUuid
     });
     measuring.add('user.registration', 1);
   });
   ```

### Performance Optimization

1. **Cache Strategy with Database-Style Storage**
   ```javascript
   // Cache frequently accessed data with UUID-based persistent fallback
   const userUuidMapping = new Map(); // In practice, store this mapping persistently
   
   async function getUser(id) {
     const cacheKey = `user:${id}`;
     
     // Try cache first (fastest)
     let user = await cache.get(cacheKey);
     if (user) return user;
     
     // Fallback to persistent storage using UUID
     const userUuid = userUuidMapping.get(id);
     if (userUuid) {
       user = await dataServe.getByUuid('users', userUuid);
       if (user) {
         // Cache for future requests
         await cache.put(cacheKey, user, 1800); // 30 min
         return user;
       }
     }
     
     // Final fallback to database
     user = await db.user.findById(id);
     if (user) {
       // Store in persistent storage and get UUID
       const uuid = await dataServe.add('users', user);
       userUuidMapping.set(id, uuid);
       
       // Cache for future requests
       await cache.put(cacheKey, user, 1800);
     }
     
     return user;
   }
   
   // Advanced search with caching
   async function findActiveEngineers() {
     const cacheKey = 'active-engineers';
     
     // Try cached results first
     let engineers = await cache.get(cacheKey);
     if (engineers) return engineers;
     
     // Search using JSON query
     engineers = await dataServe.jsonFindByCriteria('users', {
       'status': 'active',
       'profile.department': 'engineering'
     });
     
     // Cache results for 10 minutes
     await cache.put(cacheKey, engineers, 600);
     return engineers;
   }
   ```

2. **Background Processing**
   ```javascript
   // Don't block request handling
   app.post('/api/orders', async (req, res) => {
     const order = await processOrder(req.body);
     
     // Queue background tasks instead of blocking
     queue.enqueue({ type: 'sendOrderConfirmation', orderId: order.id });
     queue.enqueue({ type: 'updateInventory', items: order.items });
     queue.enqueue({ type: 'processPayment', orderId: order.id });
     
     res.json({ orderId: order.id, status: 'processing' });
   });
   ```

3. **Monitoring and Metrics**
   ```javascript
   // Track important metrics
   const startTime = Date.now();
   
   try {
     const result = await businessLogic();
     measuring.add('api.response.time', Date.now() - startTime);
     measuring.add('api.success', 1);
     return result;
   } catch (error) {
     measuring.add('api.error', 1);
     throw error;
   }
   ```

### Security Best Practices

1. **API Key Rotation**
   ```javascript
   // Implement key rotation
   const activeKeys = [
     process.env.API_KEY_CURRENT,
     process.env.API_KEY_PREVIOUS  // Allow previous key during rotation
   ].filter(Boolean);
   
   serviceRegistry.initialize(app, { 
     apiKeys: activeKeys,
     requireApiKey: true 
   });
   ```

2. **Input Validation**
   ```javascript
   app.post('/api/cache', (req, res) => {
     const { key, value } = req.body;
     
     // Validate inputs
     if (!key || typeof key !== 'string' || key.length > 255) {
       return res.status(400).json({ error: 'Invalid key' });
     }
     
     if (typeof value === 'undefined') {
       return res.status(400).json({ error: 'Value required' });
     }
     
     // Process safely
     cache.put(key, value);
     res.json({ success: true });
   });
   ```

3. **Rate Limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   app.use('/services/', rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 1000, // requests per window per IP
     message: 'Too many requests, please try again later.'
   }));
   ```

---

## Troubleshooting

### Common Issues

#### 1. "ServiceRegistry must be initialized before getting services"

```javascript
// ❌ Wrong: Getting service before initialization
const cache = serviceRegistry.cache('redis');
serviceRegistry.initialize(app);

// ✅ Correct: Initialize first
serviceRegistry.initialize(app);
const cache = serviceRegistry.cache('redis');
```

#### 2. API Key Authentication Failures

```bash
# Check if API key is being sent correctly
curl -v -H "x-api-key: YOUR_KEY" http://localhost:3000/services/caching/api/status

# Verify key in excluded paths
GET /services/caching/api/status  # Should work without key
GET /services/caching/api/get/test # Requires key
```

#### 3. Redis Connection Issues

```javascript
// Add Redis connection handling
const cache = serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true
});

// Listen for connection events
const eventEmitter = serviceRegistry.getEventEmitter();
eventEmitter.on('redis-error', (error) => {
  console.error('Redis error:', error);
  // Maybe fallback to memory cache
});
```

#### 4. File Upload Issues

```javascript
// Check file permissions and paths
const filing = serviceRegistry.filing('local', {
  baseDir: path.resolve(__dirname, 'uploads') // Use absolute path
});

// Ensure directory exists
const fs = require('fs');
const uploadDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
```

### Debugging

#### Enable Debug Logging

```bash
# Set environment variable
DEBUG=noobly:* npm start
```

```javascript
// Or programmatically
process.env.DEBUG = 'noobly:*';

// Add debug logging
const debug = require('debug')('noobly:app');
debug('Service initialized with providers:', providers);
```

#### Monitor Service Events

```javascript
const eventEmitter = serviceRegistry.getEventEmitter();

// Log all events for debugging
const originalEmit = eventEmitter.emit;
eventEmitter.emit = function(eventName, ...args) {
  console.log(`Event: ${eventName}`, args);
  return originalEmit.call(this, eventName, ...args);
};
```

#### Health Check Endpoints

```javascript
// Add comprehensive health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };
  
  // Check each service
  try {
    const cache = serviceRegistry.cache('redis');
    await cache.get('health-check');
    health.services.cache = 'ok';
  } catch (error) {
    health.services.cache = 'error';
    health.status = 'degraded';
  }
  
  // Check Redis connection
  try {
    const redis = serviceRegistry.cache('redis');
    health.services.redis = redis.status || 'ok';
  } catch (error) {
    health.services.redis = 'error';
    health.status = 'degraded';
  }
  
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});
```

### Performance Issues

#### Memory Leaks

```javascript
// Monitor memory usage
setInterval(() => {
  const memUsage = process.memoryUsage();
  measuring.add('memory.heap.used', memUsage.heapUsed);
  measuring.add('memory.heap.total', memUsage.heapTotal);
  
  if (memUsage.heapUsed > 512 * 1024 * 1024) { // 512MB
    logger.warn('High memory usage detected:', memUsage);
  }
}, 30000);
```

#### Connection Pool Tuning

```javascript
// Optimize Redis connections
const cache = serviceRegistry.cache('redis', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: true,
  family: 4, // Force IPv4
  connectTimeout: 10000,
  commandTimeout: 5000
});
```

---

## Conclusion

This technical guide provides comprehensive coverage of the NooblyJS Core framework usage patterns. The framework's modular architecture, multiple provider support, and consistent API patterns make it suitable for a wide range of applications from rapid prototypes to production systems.

For additional support:
- Check the `/tests/api/` directory for HTTP test examples
- Review `/tests/unit/` for programmatic usage patterns  
- Examine `/tests/load/` for performance testing approaches
- Use the web interfaces at `/services/` for interactive exploration

The framework's event-driven architecture and service registry pattern provide a solid foundation for building scalable, maintainable backend applications with Node.js.