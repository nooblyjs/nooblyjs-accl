/**
 * @fileoverview CampaignService (PRD MK-3): campaigns and their status
 * lifecycle draft → running ↔ paused → completed → archived.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { validationError, conflict } = require('../../shared/errors');

const TRANSITIONS = Object.freeze({
  draft: ['running', 'archived'],
  running: ['paused', 'completed'],
  paused: ['running', 'completed'],
  completed: ['archived'],
  archived: []
});

class CampaignService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   * @param {Object} deps.events - DomainEventBus
   */
  constructor({ repos, events }) {
    this.repos = repos;
    this.repo = repos.campaign;
    this.events = events;
  }

  async create(input, ctx) {
    this.checkDates_(input || {});
    return this.repo.create(input, ctx, { system: { status: 'draft' } });
  }

  async update(id, patch, ctx, { expectedVersion } = {}) {
    const current = await this.repo.get(id, ctx);
    if (['completed', 'archived'].includes(current.status)) throw conflict(`A ${current.status} campaign cannot be edited`);
    this.checkDates_({ ...current, ...(patch || {}) });
    return this.repo.update(id, patch, ctx, { expectedVersion });
  }

  /**
   * Moves a campaign along TRANSITIONS and emits `campaign.status.changed`.
   *
   * @param {string} id - Campaign id
   * @param {string} status - Target status
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented campaign
   */
  async setStatus(id, status, ctx) {
    const current = await this.repo.get(id, ctx);
    if (!TRANSITIONS[status] && status !== 'draft') {
      throw validationError(`Unknown status '${status}'`, [{ path: 'status', message: `must be one of ${Object.keys(TRANSITIONS).join(', ')}` }]);
    }
    if (current.status === status) return current;
    if (!TRANSITIONS[current.status].includes(status)) {
      throw conflict(`Cannot change a campaign from ${current.status} to ${status}`, { from: current.status, to: status });
    }
    const updated = await this.repo.update(id, {}, ctx, { system: { status } });
    this.events?.publish('campaign.status.changed', {
      module: 'marketing', subject: { entity: 'campaign', id }, data: { from: current.status, to: status }
    }, ctx);
    return updated;
  }

  checkDates_(c) {
    if (c.startAt && c.endAt && new Date(c.endAt) <= new Date(c.startAt)) {
      throw validationError('endAt must be after startAt', [{ path: 'endAt', message: 'is not after startAt' }]);
    }
  }
}

module.exports = { CampaignService, TRANSITIONS };
