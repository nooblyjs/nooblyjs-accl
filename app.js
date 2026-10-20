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

/**
 * Loads the accelerators. Each one is an ES module that exports register(app, serviceRegistry, { mountPath,
 * dataDir, host }) and mounts its screens and API under mountPath (nooblyjs-accelerator-infrastructure/.claude/
 * steering/architecture.md §3). Until this launcher has a host of its own (sign-in, audit, events, the frame), it
 * uses the infrastructure accelerator's development host, which signs anyone in as anyone at /login and refuses to
 * run with NODE_ENV=production.
 */
async function loadAccelerators() {
  const { pathToFileURL } = require('url');
  const load = (file) => import(pathToFileURL(path.join(__dirname, file)).href);
  const dataRoot = path.join(__dirname, '.application', 'data');

  const { createDevLauncher } = await load('nooblyjs-accelerator-infrastructure/src/host/standalone.js');
  const launcher = createDevLauncher({ express, rootDir: dataRoot, log });
  launcher.mount(app);

  const infrastructure = await load('nooblyjs-accelerator-infrastructure/index.js');
  const mountPath = '/infrastructure';
  const dataDir = path.join(dataRoot, 'infrastructure');
  const hosted = await infrastructure.register(app, serviceRegistry, { mountPath, dataDir, host: launcher.hostFor(dataDir) });
  launcher.add(hosted, mountPath);
  log.info(`mounted ${hosted.name} at ${mountPath}`);
}

loadAccelerators()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Nooblyjs Infrastructure Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error(`Could not load the accelerators: ${err.stack}`);
    process.exit(1);
  });