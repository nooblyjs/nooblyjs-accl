/**
 * @fileoverview Module scaffolding shared by customer, marketing and support.
 *
 * `createModule()` builds a module's API router at
 * `{basePath}/{name}/api/v1` (JSON body parsing, request context, health and
 * OpenAPI endpoints) and serves its static UI at `{basePath}/{name}/`.
 * Unauthenticated, customer-facing routes (tracking, unsubscribe, webhooks)
 * go on `publicRouter`, mounted at `{basePath}/{name}/p`; they must
 * authenticate requests themselves (signed tokens, webhook signatures).
 * The module adds its routes between `create` and `finalize`.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const path = require('path');
const express = require('express');
const { OpenApiBuilder } = require('./http/openapi');
const { errorMiddleware, notFoundHandler, asyncHandler } = require('./http');

/**
 * @param {Object} params
 * @param {string} params.name - Module name (`customer`, `marketing`, `support`)
 * @param {Object} params.app - Host Express app
 * @param {Object} params.shared - Shared mount context (options, rbac, logger, eventEmitter, version, healthChecks)
 * @param {string} params.viewsDir - Directory of the module's static UI
 * @return {{name: string, router: Object, publicRouter: Object, apiBase: string, uiBase: string, publicBase: string, openapi: OpenApiBuilder, finalize: function(): void}} Module scaffold
 */
function createModule({ name, app, shared, viewsDir }) {
  const { options, rbac, logger, eventEmitter, version } = shared;
  const uiBase = `${options.basePath}/${name}`;
  const apiBase = `${uiBase}/api/v1`;
  const publicBase = `${uiBase}/p`;
  const router = express.Router();
  const publicRouter = express.Router();
  const openapi = new OpenApiBuilder({ title: `Customer Accelerator — ${name}`, version, serverUrl: apiBase });

  router.use(express.json({ limit: options.bodyLimit }));
  router.use(rbac.attachContext);

  router.get('/health', asyncHandler(async (req, res) => {
    const checks = {};
    let ok = true;
    for (const [check, fn] of Object.entries(shared.healthChecks)) {
      try {
        await fn();
        checks[check] = 'ok';
      } catch (err) {
        ok = false;
        checks[check] = 'failed';
        logger?.warn?.(`[accel-customers] health check '${check}' failed`, { error: err.message });
      }
    }
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded', module: name, version, timestamp: new Date().toISOString(), checks
    });
  }));
  openapi.addPath('get', '/health', {
    summary: 'Module health', tags: ['health'],
    responses: { 200: { description: 'Healthy' }, 503: { description: 'A dependency check failed' } }
  });

  router.get('/openapi.json', (req, res) => res.json(openapi.build()));

  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    router.use(notFoundHandler());
    router.use(errorMiddleware({ logger, eventEmitter }));
    app.use(apiBase, router);
    if (publicRouter.stack.length) {
      publicRouter.use(notFoundHandler());
      publicRouter.use(errorMiddleware({ logger, eventEmitter }));
      app.use(publicBase, publicRouter);
    }
    if (viewsDir && options.ui !== false) app.use(uiBase, express.static(path.resolve(viewsDir)));
  };

  return { name, router, publicRouter, apiBase, uiBase, publicBase, openapi, finalize };
}

module.exports = { createModule };
