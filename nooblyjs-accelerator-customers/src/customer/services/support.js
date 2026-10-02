/**
 * @fileoverview Helpers shared by the customer-domain services.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { createContext } = require('../../shared/context');
const { notFound } = require('../../shared/errors');

/**
 * A read context with every permission but the caller's tenant, actor and
 * correlation id. Services use it for internal reads that need raw (unmasked)
 * values. Never use it for writes: audit entries must show the real permissions.
 *
 * @param {Object} ctx - Caller context
 * @return {Object} Elevated read context
 */
function readAs(ctx) {
  return createContext({
    tenantId: ctx.tenantId, actor: ctx.actor, roles: ctx.roles, permissions: ['*'], correlationId: ctx.correlationId
  });
}

/**
 * Loads a party (customer or organization) or throws 404.
 *
 * @param {Object} repos - Repositories (`customer`, `organization`)
 * @param {string} partyType - `customer` | `organization`
 * @param {string} partyId - Party id
 * @param {Object} ctx - Caller context
 * @return {Promise<Object>} Raw party document
 */
async function loadParty(repos, partyType, partyId, ctx) {
  const repo = repos[partyType];
  const party = repo ? await repo.find(partyId, readAs(ctx)) : null;
  if (!party) throw notFound(partyType || 'party', partyId);
  return party;
}

/**
 * Sorts newest first by a timestamp field.
 *
 * @param {Object[]} items - Items
 * @param {string} [field='createdAt'] - Field holding an ISO timestamp
 * @return {Object[]} Same array, sorted
 */
function newestFirst(items, field = 'createdAt') {
  return items.sort((a, b) => String(b[field]).localeCompare(String(a[field])));
}

module.exports = { readAs, loadParty, newestFirst };
