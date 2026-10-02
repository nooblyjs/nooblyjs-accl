/**
 * @fileoverview Demo host application for the Customer Accelerator.
 *
 * Shows how a NooblyJS application mounts the accelerator: the host owns the
 * Express app, the EventEmitter and the core ServiceRegistry, then calls
 * `mount()`. It seeds demo data (500 customers, 50 organizations) so the admin
 * UI has something to show; set CX_SEED=0 to start empty. Authentication is
 * the host's job; this app has none and grants every request the roles in
 * CX_DEMO_ROLES (default `admin`), so it refuses to run with NODE_ENV=production.
 *
 *   npm start                 # or: node test/app/index.js
 *   open http://localhost:3003/applications/customer/
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const express = require('express');
const { EventEmitter } = require('events');
const serviceRegistry = require('nooblyjs-core');
const customers = require('../..');

/**
 * Builds the demo host and mounts the accelerator.
 *
 * @param {Object} [options] - Extra mount options (merged over the demo defaults)
 * @return {Promise<{app: Object, eventEmitter: EventEmitter, serviceRegistry: Object, cx: Object}>} Host
 */
async function createHostApp(options = {}) {
  const app = express();
  const eventEmitter = new EventEmitter();

  serviceRegistry.initialize(app, eventEmitter, {
    security: {
      apiKeyAuth: { requireApiKey: false, apiKeys: [] },
      servicesAuth: { requireLogin: false }
    }
  });

  const demoRoles = (process.env.CX_DEMO_ROLES || 'admin').split(',').map((r) => r.trim()).filter(Boolean);
  const port = Number(process.env.PORT) || 3003;
  const cx = await customers.mount(app, eventEmitter, serviceRegistry, {
    modules: ['customer', 'marketing', 'support'],
    basePath: '/applications',
    providers: { logging: { type: process.env.CX_LOG_PROVIDER || 'console' } },
    auth: { roleResolver: () => demoRoles },
    seed: process.env.CX_SEED !== '0',
    customer: { defaultCountry: 'ZA' },
    marketing: {
      // Messages go to the console adapter's in-memory outbox; nothing leaves the machine.
      tracking: { baseUrl: process.env.CX_PUBLIC_URL || `http://localhost:${port}`, signingSecret: process.env.CX_TRACKING_SECRET || 'test-app-signing-secret-not-for-production' },
      defaults: {
        from: { email: { address: 'news@example.com', name: 'Acme' } },
        frequencyCap: { count: 3, perDays: 7 }
      }
    },
    ...options
  });

  app.get('/', (req, res) => res.redirect('/applications/customer/'));
  return { app, eventEmitter, serviceRegistry, cx };
}

module.exports = { createHostApp };

if (require.main === module) {
  if (process.env.NODE_ENV === 'production') {
    console.error('test/app/index.js has no authentication and must not run in production.');
    process.exit(1);
  }
  const PORT = Number(process.env.PORT) || 3003;
  createHostApp()
    .then(({ app, cx }) => {
      const server = app.listen(PORT, () => {
        console.log(`Customer Accelerator test app on http://localhost:${PORT}/applications/customer/`);
      });
      const stop = () => {
        server.close();
        cx.shutdown().finally(() => serviceRegistry.shutdown?.());
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((err) => {
      console.error('Failed to start the test app:', err);
      process.exit(1);
    });
}
