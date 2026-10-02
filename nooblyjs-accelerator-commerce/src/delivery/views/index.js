/**
 * @fileoverview Delivery Management System View Manager
 *
 * Provides web interface views for the delivery management system including:
 * - Admin dashboard for operations management
 * - Driver interface for delivery operations
 * - Customer tracking interface
 * - Analytics and reporting views
 *
 * @author NooblyJS Applications Team
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * This module provides Express.js view registration and static file serving
 * for the Delivery Management System web interfaces
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express - The Express application instance
 * @param {string} options.path - Base path for the delivery app
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} services - NooblyJS Core services object
 * @returns {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.express;
  const app_path = options.path || 'delivery';
  const { logger } = services;

  // Serve static files for the delivery management application
  app.use(`/applications/${app_path}`, express.static(path.join(__dirname)));

  // Main dashboard route
  app.get(`/applications/${app_path}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
  });

  // Driver interface route
  app.get(`/applications/${app_path}/driver`, (req, res) => {
    res.sendFile(path.join(__dirname, 'driver.html'));
  });

  // Customer tracking route
  app.get(`/applications/${app_path}/tracking`, (req, res) => {
    res.sendFile(path.join(__dirname, 'tracking.html'));
  });

  // Analytics dashboard route
  app.get(`/applications/${app_path}/analytics`, (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics.html'));
  });

  // Log that delivery management views are registered
  logger.info(`Delivery Management System views registered successfully at /applications/${app_path}`);
};