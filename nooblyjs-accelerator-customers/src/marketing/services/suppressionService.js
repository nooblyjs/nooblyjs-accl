/**
 * @fileoverview Suppression lists (PRD MK-9) and subscription topics.
 *
 * A suppression blocks an address globally, on a channel or for one topic.
 * Values are normalised (email lower-case, phone E.164) so lookups match
 * however the address was entered. Unsubscribe suppressions only block
 * marketing; bounces, complaints, erasure and legal holds block every send.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { normaliseEmail, normalisePhone } = require('../../shared/reference/normalise');
const { validationError } = require('../../shared/errors');

/** Reasons that also block transactional and service messages. */
const HARD_REASONS = new Set(['hard_bounce', 'complaint', 'erasure', 'legal', 'manual']);

class SuppressionService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   * @param {Object} [deps.options] - `{ defaultCountry }`
   */
  constructor({ repos, options = {} }) {
    this.repos = repos;
    this.repo = repos.suppression;
    this.defaultCountry = options.defaultCountry || null;
  }

  /**
   * Normalises an address for a channel (email, or E.164 for sms).
   *
   * @param {string} value - Address
   * @param {string} [channel] - Channel hint; guessed from the value when absent
   * @return {string} Normalised value
   */
  normalise(value, channel) {
    const v = String(value || '').trim();
    if (channel === 'email' || (!channel && v.includes('@'))) return normaliseEmail(v);
    return normalisePhone(v, this.defaultCountry).e164;
  }

  keyOf_({ scope, channel, topicId, value }) {
    return `${scope}|${scope === 'global' ? '*' : channel || '*'}|${scope === 'topic' ? topicId : '*'}|${value}`;
  }

  /**
   * Adds a suppression; adding an existing one returns it unchanged.
   *
   * @param {Object} input - `{ scope, channel?, topicId?, value, reason, source?, note?, expiresAt? }`
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented suppression
   */
  async add(input, ctx) {
    const scope = input && input.scope;
    if (scope === 'channel' && !input.channel) throw validationError('channel is required for a channel suppression', [{ path: 'channel', message: 'is required' }]);
    if (scope === 'topic' && !input.topicId) throw validationError('topicId is required for a topic suppression', [{ path: 'topicId', message: 'is required' }]);
    const value = this.normalise(input && input.value, input && input.channel);
    const clean = { ...input, value };
    if (scope === 'global') delete clean.channel;
    if (scope !== 'topic') delete clean.topicId;
    const key = this.keyOf_({ ...clean, value });
    const [existing] = await this.repo.findByIndex('key', key, ctx);
    if (existing) return existing;
    return this.repo.create(clean, ctx, { system: { key } });
  }

  /**
   * Finds the suppression that blocks a send, if any.
   *
   * @param {Object} q - `{ channel, value, topicId?, purpose }`
   * @param {Object} ctx - Operation context
   * @param {Date} [at=now] - Evaluation time
   * @return {Promise<?Object>} Blocking suppression
   */
  async check({ channel, value, topicId, purpose }, ctx, at = new Date()) {
    if (!value) return null;
    let normalised;
    try {
      normalised = this.normalise(value, channel);
    } catch {
      return null;
    }
    const entries = await this.repo.findByIndex('value', normalised, ctx);
    return entries.find((s) => {
      if (s.expiresAt && new Date(s.expiresAt) <= at) return false;
      if (s.scope === 'channel' && s.channel !== channel) return false;
      if (s.scope === 'topic' && (s.topicId !== topicId || (s.channel && s.channel !== channel))) return false;
      if (purpose !== 'marketing' && !HARD_REASONS.has(s.reason)) return false;
      return true;
    }) || null;
  }

  async remove(id, ctx) {
    await this.repo.hardDelete((await this.repo.get(id, ctx)).id, ctx);
  }
}

class TopicService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   */
  constructor({ repos }) {
    this.repo = repos.topic;
  }

  /** Returns a topic by key or null. */
  async byKey(key, ctx) {
    if (!key) return null;
    const [topic] = await this.repo.findByIndex('key', String(key).toLowerCase(), ctx);
    return topic || null;
  }

  /** Throws 422 when a topic key is given but unknown. */
  async assertExists(key, ctx, path = 'topicId') {
    if (key && !(await this.byKey(key, ctx))) {
      throw validationError(`Unknown topic '${key}'`, [{ path, message: 'is not a known topic key' }]);
    }
  }
}

module.exports = { SuppressionService, TopicService, HARD_REASONS };
