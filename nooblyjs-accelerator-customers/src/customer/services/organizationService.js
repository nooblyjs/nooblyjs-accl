/**
 * @fileoverview OrganizationService (PRD CU-1): business accounts with their
 * own contact points, a parent hierarchy and member customers.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { validationError, conflict } = require('../../shared/errors');
const { readAs, loadParty } = require('./support');

class OrganizationService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories
   * @param {Object} deps.contactPoints - `{ address, phone, email }` ContactPointServices
   */
  constructor({ repos, contactPoints }) {
    this.repos = repos;
    this.repo = repos.organization;
    this.contactPoints = contactPoints;
  }

  /**
   * @param {Object} input - Organization fields
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented organization
   */
  async create(input, ctx) {
    if (input && input.parentOrganizationId) await loadParty(this.repos, 'organization', input.parentOrganizationId, ctx);
    return this.repo.create(input, ctx);
  }

  /**
   * @param {string} id - Organization id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expand: ['addresses','phones','emails','members'], fields }`
   * @return {Promise<Object>} Presented organization
   */
  async get(id, ctx, { expand = [], fields } = {}) {
    const org = await this.repo.get(id, ctx, { fields });
    const out = { ...org };
    for (const e of expand || []) {
      if (['addresses', 'phones', 'emails'].includes(e)) {
        const kind = { addresses: 'address', phones: 'phone', emails: 'email' }[e];
        out[e] = await this.contactPoints[kind].listUnchecked('organization', id, ctx);
      } else if (e === 'members') {
        out.members = await this.repos.customer.findByIndex('organization', id, ctx);
      } else {
        throw validationError(`Cannot expand '${e}'`, [{ path: 'expand', message: 'expected addresses, phones, emails or members' }]);
      }
    }
    return out;
  }

  /**
   * @param {Object} query - Parsed list query (`q` searches name / number)
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Page
   */
  async list(query, ctx) {
    let q = query;
    if (query.q) {
      const ids = (await this.repo.searchText(query.q, readAs(ctx), { limit: 100 })).map((o) => o.id);
      q = { ...query, filters: [...(query.filters || []), { field: 'id', op: 'in', value: ids.length ? ids : ['-'] }] };
    }
    return this.repo.list(q, ctx);
  }

  /**
   * @param {string} id - Organization id
   * @param {Object} patch - Merge patch
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented organization
   */
  async update(id, patch, ctx, { expectedVersion } = {}) {
    if (patch && patch.parentOrganizationId) {
      if (patch.parentOrganizationId === id) throw validationError('An organization cannot be its own parent', [{ path: 'parentOrganizationId', message: 'is the organization itself' }]);
      await this.assertNoCycle_(id, patch.parentOrganizationId, ctx);
    }
    return this.repo.update(id, patch, ctx, { expectedVersion });
  }

  /**
   * Soft-deletes an organization and its contact points. Refused while
   * customers still belong to it.
   *
   * @param {string} id - Organization id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented deleted organization
   */
  async remove(id, ctx, { expectedVersion } = {}) {
    const members = await this.repos.customer.findByIndex('organization', id, readAs(ctx));
    if (members.length) throw conflict(`Organization has ${members.length} member customer(s); move them first`, { members: members.length });
    const deleted = await this.repo.softDelete(id, ctx, { expectedVersion });
    for (const kind of Object.keys(this.contactPoints)) await this.contactPoints[kind].removeAll('organization', id, ctx);
    return deleted;
  }

  async assertNoCycle_(id, parentId, ctx) {
    const seen = new Set([id]);
    let cursor = parentId;
    while (cursor) {
      if (seen.has(cursor)) throw validationError('Parent organization would create a cycle', [{ path: 'parentOrganizationId', message: 'creates a cycle' }]);
      seen.add(cursor);
      const org = await loadParty(this.repos, 'organization', cursor, ctx);
      cursor = org.parentOrganizationId;
    }
  }
}

module.exports = { OrganizationService };
