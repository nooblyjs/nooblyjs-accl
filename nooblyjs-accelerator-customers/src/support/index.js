/**
 * @fileoverview The support module.
 *
 * Contact centre: agents, queues, routing, interactions, issues and resolutions (Phase 3).
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const path = require('path');
const { createModule } = require('../shared/module');

/**
 * Creates the support module and mounts its API and UI.
 *
 * @param {Object} params
 * @param {Object} params.app - Host Express app
 * @param {Object} params.shared - Shared mount context (see index.js)
 * @return {{name: string, api: Object, apiBase: string, uiBase: string, init: function(): Promise<void>, shutdown: function(): Promise<void>}} Module
 */
module.exports = function createSupportModule({ app, shared }) {
  const scaffold = createModule({ name: 'support', app, shared, viewsDir: path.join(__dirname, 'views') });
  scaffold.finalize();

  return {
    name: 'support',
    api: {},
    apiBase: scaffold.apiBase,
    uiBase: scaffold.uiBase,
    async init() {},
    async shutdown() {}
  };
};
