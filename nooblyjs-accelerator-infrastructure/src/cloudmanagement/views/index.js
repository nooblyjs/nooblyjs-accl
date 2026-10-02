/**
 * @fileoverview The view manager
 * 
 * @author NooblyJS Applications Team
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * This module provides Express.js view registration and static file serving 
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} services - NooblyJS Core services (dataServe, filing, cache, logger, queue, search)
 * @returns {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.express;
  const app_path = options.path || 'warehouse';
  const { logger } = services;
  
  // Serve static files for the wiki application
  app.use(`/applications/${app_path}`, express.static(path.join(__dirname)));
  
  // Log that wiki views are registered
  logger.info(`${app_path} application views registered successfully`);
};