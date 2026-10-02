/**
 * @fileoverview The file define and instantiates the various NooblyJS applications.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 2025-08-24
 */

'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { EventEmitter } = require('events');

// Iniitiate the Web and Api Interface
const app = express();
const PORT = process.env.PORT || 3003;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configure session middleware before application initialization
app.use(session({
  secret: 'ecommerce-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Configure Passport
const { configurePassport } = require('./src/auth/passport-config');
configurePassport(passport);
app.use(passport.initialize());
app.use(passport.session());

// initiate the event mechanism
const eventEmitter = new EventEmitter()
function patchEmitter(eventEmitter) {
  const originalEmit = eventEmitter.emit;
  eventEmitter.emit = function () {
    const eventName = arguments[0];
    const args = Array.from(arguments).slice(1);
    console.log(`Caught event: "${eventName}" with arguments:`, args);
    return originalEmit.apply(this, arguments);
  };
}(eventEmitter);

// Initiate the service Registry
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app,eventEmitter);

const log = serviceRegistry.logger('console');
const cache = serviceRegistry.cache('memory');
const dataserve = serviceRegistry.dataServe('memory');
const filing = serviceRegistry.filing('local');
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const worker = serviceRegistry.working('memory');
const workflow = serviceRegistry.workflow('memory');

const warehouse = require('./src/warehouse/index');
warehouse({express: app},eventEmitter,serviceRegistry);

const ecommerce = require('./src/ecommerce/index');
ecommerce({express: app},eventEmitter,serviceRegistry);

const deivery = require('./src/delivery/index');
deivery({express: app},eventEmitter,serviceRegistry);

// Authentication routes
const authRoutes = require('./src/auth/routes');
app.use('/api/auth', authRoutes);

// Launch the application manager
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Nooblyjs Wiki Server running on port ${PORT}`);
});