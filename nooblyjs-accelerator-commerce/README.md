# NooblyJS Commerce Applications

A comprehensive microservices platform built on the NooblyJS framework that provides complete e-commerce, warehouse management, and delivery solutions.

## Overview

This application consists of three integrated modules that work together to provide a full-scale commerce platform:

### 🛒 E-commerce Management System
- **Product & Catalog Management**: Categories, products, variants, and inventory
- **Order Processing**: Shopping carts, order management, and payment integration
- **User Management**: Customer accounts, authentication, and profiles
- **Analytics & Promotions**: Sales analytics, promotional campaigns, and content management
- **Payment Integration**: Stripe payment processing with secure transactions

### 🏭 Warehouse Management System (WMS)
- **Inventory Management**: Real-time stock tracking, lot/batch management, and location tracking
- **Inbound Operations**: Purchase order processing, receiving, and put-away optimization
- **Outbound Operations**: Order picking, wave management, and shipment processing
- **Resource Management**: Staff scheduling, equipment tracking, and task management
- **Delivery Integration**: Seamless handoff to delivery partners

### 🚚 Delivery Management System (DMS)
- **Order Assignment**: Automatic order-to-driver matching and route optimization
- **Driver Management**: Driver onboarding, scheduling, and performance tracking
- **Real-time Tracking**: GPS tracking, delivery status updates, and customer notifications
- **Analytics**: Delivery performance metrics and operational insights

## Key Features

- **Unified Authentication**: Single sign-on across all modules with Passport.js
- **Event-Driven Architecture**: Real-time communication between services using EventEmitter
- **Service Registry**: Modular service architecture with caching, logging, queuing, and workflow management
- **RESTful APIs**: Complete API coverage for all operations
- **Web Interface**: Built-in web views for managing all aspects of the platform

## Technology Stack

- **Framework**: Node.js with Express.js
- **Core**: NooblyJS Core service registry
- **Authentication**: Passport.js with local and Google OAuth strategies
- **Payment**: Stripe integration
- **Session Management**: Express sessions with secure configuration
- **File Handling**: Multer for file uploads
- **Security**: bcryptjs for password hashing, JWT for tokens

## Getting Started

### Installation
```bash
npm install
```

### Development
```bash
npm run dev:web
```

### Production
```bash
npm start
```

The application runs on port 3003 by default (configurable via PORT environment variable).

## Architecture

The application uses a modular architecture where each module (ecommerce, warehouse, delivery) is independently configurable but shares common services through the NooblyJS service registry. This allows for:

- **Scalability**: Each module can be scaled independently
- **Maintainability**: Clear separation of concerns
- **Flexibility**: Services can be swapped or extended easily
- **Integration**: Seamless data flow between modules

## API Endpoints

- `/api/auth/*` - Authentication and user management
- `/ecommerce/*` - E-commerce operations and web interface
- `/warehouse/*` - Warehouse management operations and interface
- `/delivery/*` - Delivery management operations and interface
