/**
 * @fileoverview Identity graph (PRD CU-5): external identifiers per namespace,
 * unique per tenant, resolvable to a customer.
 *
 * Values in the `email` namespace are stored lower-cased; values in the
 * `phone` namespace are stored as E.164.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { normaliseEmail, normalisePhone } = require('../../shared/reference/normalise');
const { notFound, conflict, validationError } = require('../../shared/errors');
const { NAMESPACE_RE } = require('../schemas');
const { readAs, loadParty } = require('./support');

class IdentityService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories (`identity`, `customer`)
   * @param {Object} [deps.options] - `{ defaultCountry }`
   */
  constructor({ repos, options = {} }) {
    this.repos = repos;
    this.repo = repos.identity;
    this.defaultCountry = options.defaultCountry || null;
  }

  /**
   * Normalises a `(namespace, value)` pair.
   *
   * @param {string} namespace - Namespace
   * @param {string} value - Identifier
   * @return {{namespace: string, value: string}} Normalised pair
   * @throws {ClientError} 422 when invalid
   */
  normalise(namespace, value) {
    const ns = typeof namespace === 'string' ? namespace.trim().toLowerCase() : '';
    if (!NAMESPACE_RE.test(ns)) {
      throw validationError('Invalid identity namespace', [{ path: 'namespace', message: 'must match [a-z][a-z0-9_.-]*' }]);
    }
    if (value === undefined || value === null || String(value).trim() === '') {
      throw validationError('Identity value is required', [{ path: 'value', message: 'is required' }]);
    }
    let v = String(value).trim();
    if (ns === 'email') v = normaliseEmail(v);
    if (ns === 'phone') v = normalisePhone(v, this.defaultCountry).e164;
    return { namespace: ns, value: v };
  }

  /**
   * Parses `namespace:value` (as used by `?identity=commerce:123`).
   *
   * @param {string} text - `namespace:value`
   * @return {{namespace: string, value: string}} Normalised pair
   */
  parse(text) {
    const i = typeof text === 'string' ? text.indexOf(':') : -1;
    if (i <= 0) throw validationError('identity must be namespace:value', [{ path: 'identity', message: 'must be namespace:value' }]);
    return this.normalise(text.slice(0, i), text.slice(i + 1));
  }

  /**
   * Returns the identity document for a pair, if any.
   *
   * @param {string} namespace - Namespace
   * @param {string} value - Identifier
   * @param {Object} ctx - Operation context
   * @return {Promise<?Object>} Presented identity
   */
  async find(namespace, value, ctx) {
    const key = this.normalise(namespace, value);
    const [doc] = await this.repo.findByIndex('key', [key.namespace, key.value], ctx);
    return doc || null;
  }

  /**
   * Resolves a pair to a customer id.
   *
   * @param {string} namespace - Namespace
   * @param {string} value - Identifier
   * @param {Object} ctx - Operation context
   * @return {Promise<?string>} Customer id
   */
  async resolve(namespace, value, ctx) {
    const doc = await this.find(namespace, value, readAs(ctx));
    return doc ? doc.customerId : null;
  }

  /**
   * Links an identity to a customer. Re-linking the same pair to the same
   * customer refreshes `lastSeenAt`.
   *
   * @param {string} customerId - Customer id
   * @param {{namespace: string, value: string, source?: string}} input - Identity
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented identity
   * @throws {ClientError} 404 customer, 409 linked to another customer, 422 invalid
   */
  async link(customerId, input, ctx) {
    await loadParty(this.repos, 'customer', customerId, ctx);
    const { namespace, value } = this.normalise(input && input.namespace, input && input.value);
    const existing = await this.find(namespace, value, readAs(ctx));
    const now = new Date().toISOString();
    if (existing) {
      if (existing.customerId !== customerId) {
        throw conflict(`Identity ${namespace}:${value} belongs to another customer`, { existingCustomerId: existing.customerId });
      }
      return this.repo.update(existing.id, {}, ctx, { system: { lastSeenAt: now } });
    }
    return this.repo.create({ customerId, namespace, value, source: input.source }, ctx, {
      system: { firstSeenAt: now, lastSeenAt: now }
    });
  }

  /**
   * Lists a customer's identities.
   *
   * @param {string} customerId - Customer id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object[]>} Presented identities
   */
  async list(customerId, ctx) {
    return this.repo.findByIndex('customer', customerId, ctx);
  }

  /**
   * Removes an identity from a customer.
   *
   * @param {string} customerId - Customer id
   * @param {string} identityId - Identity id
   * @param {Object} ctx - Operation context
   * @return {Promise<void>}
   */
  async unlink(customerId, identityId, ctx) {
    const doc = await this.repo.find(identityId, readAs(ctx));
    if (!doc || doc.customerId !== customerId) throw notFound('identity', identityId);
    await this.repo.softDelete(identityId, ctx);
  }

  /**
   * Removes every identity of a customer (customer deletion).
   *
   * @param {string} customerId - Customer id
   * @param {Object} ctx - Operation context
   * @return {Promise<number>} Number removed
   */
  async unlinkAll(customerId, ctx) {
    const all = await this.repo.findByIndex('customer', customerId, readAs(ctx));
    for (const doc of all) await this.repo.softDelete(doc.id, ctx);
    return all.length;
  }
}

module.exports = { IdentityService };
