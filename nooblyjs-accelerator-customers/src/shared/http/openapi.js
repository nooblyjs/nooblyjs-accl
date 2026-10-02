/**
 * @fileoverview OpenAPI document builder for module APIs.
 *
 * Each module registers its paths and schemas; `GET {apiBase}/openapi.json`
 * serves the result.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { toOpenApi } = require('../schema');

const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'object' } }
      }
    }
  }
};

class OpenApiBuilder {
  /**
   * @param {Object} info
   * @param {string} info.title - API title
   * @param {string} info.version - API version
   * @param {string} info.serverUrl - Base URL of the module API
   */
  constructor({ title, version, serverUrl }) {
    this.doc = {
      openapi: '3.0.3',
      info: { title, version },
      servers: [{ url: serverUrl }],
      paths: {},
      components: { schemas: { Error: ERROR_SCHEMA } }
    };
  }

  /**
   * Adds an entity schema as `{Name}` and `{Name}Input` components.
   *
   * @param {Object} schema - Schema from defineSchema()
   * @return {OpenApiBuilder} this
   */
  addSchema(schema) {
    const name = schema.name[0].toUpperCase() + schema.name.slice(1);
    this.doc.components.schemas[name] = toOpenApi(schema);
    this.doc.components.schemas[`${name}Input`] = toOpenApi(schema, { input: true });
    return this;
  }

  /**
   * Adds an operation.
   *
   * @param {string} method - HTTP method (lower case)
   * @param {string} path - OpenAPI path, e.g. `/customers/{id}`
   * @param {Object} operation - OpenAPI operation object
   * @return {OpenApiBuilder} this
   */
  addPath(method, path, operation) {
    this.doc.paths[path] = this.doc.paths[path] || {};
    this.doc.paths[path][method] = operation;
    return this;
  }

  /** @return {Object} The OpenAPI document */
  build() {
    return this.doc;
  }
}

module.exports = { OpenApiBuilder };
