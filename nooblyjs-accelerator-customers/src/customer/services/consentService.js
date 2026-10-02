/**
 * @fileoverview Consent ledger (PRD CU-8).
 *
 * Records are append-only. The current state per `(purpose, channel, topicId)`
 * is the latest unexpired record (by `capturedAt`, then creation order).
 *
 * `canContact()` decides whether a customer may be contacted:
 * 1. Blocked, merged or erased customers: never.
 * 2. The most specific current record decides: `(purpose, channel, topic)`,
 *    then `(purpose, channel)`, then `(purpose, any)`. It must be `opt_in`.
 * 3. A broader `opt_out` captured later than that record overrides it, so
 *    "stop all email" beats an older topic opt-in.
 * 4. No record: denied, except for `service_messages`, which are allowed by
 *    default (contractual basis), unless opted out.
 *
 * Phase 2's send pipeline calls `canContact()` before every marketing send.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { validationError } = require('../../shared/errors');
const { readAs, loadParty } = require('./support');

const BLOCKED_STATUSES = new Set(['blocked', 'merged', 'erased']);
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const keyOf = (r) => `${r.purpose}|${r.channel}|${r.topicId || ''}`;

class ConsentService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories (`consent`, `customer`)
   * @param {Object} deps.events - DomainEventBus
   */
  constructor({ repos, events }) {
    this.repos = repos;
    this.repo = repos.consent;
    this.events = events;
  }

  /**
   * Appends a consent record. Emits `consent.changed` when the current state
   * for that key changes.
   *
   * @param {string} customerId - Customer id
   * @param {Object} input - `{ purpose, channel, topicId?, status, lawfulBasis?, source?, evidence?, capturedAt?, expiresAt? }`
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented record
   * @throws {ClientError} 404 customer, 422 invalid
   */
  async record(customerId, input, ctx) {
    await loadParty(this.repos, 'customer', customerId, ctx);
    const now = Date.now();
    const capturedAt = input && input.capturedAt ? new Date(input.capturedAt) : new Date(now);
    if (Number.isNaN(capturedAt.getTime())) {
      throw validationError('capturedAt must be an ISO-8601 date-time', [{ path: 'capturedAt', message: 'is invalid' }]);
    }
    if (capturedAt.getTime() > now + FUTURE_TOLERANCE_MS) {
      throw validationError('capturedAt cannot be in the future', [{ path: 'capturedAt', message: 'is in the future' }]);
    }
    if (input && input.expiresAt && new Date(input.expiresAt) <= capturedAt) {
      throw validationError('expiresAt must be after capturedAt', [{ path: 'expiresAt', message: 'is not after capturedAt' }]);
    }
    const before = await this.currentFor_(customerId, input || {}, ctx);
    const created = await this.repo.create({ ...input, customerId, capturedAt: capturedAt.toISOString() }, ctx);
    const after = await this.currentFor_(customerId, created, ctx);
    const from = before ? before.status : null;
    const to = after ? after.status : null;
    if (from !== to) {
      this.events?.publish('consent.changed', {
        module: 'customer',
        subject: { entity: 'customer', id: customerId },
        data: { customerId, purpose: created.purpose, channel: created.channel, topicId: created.topicId || null, from, to, consentId: created.id }
      }, ctx);
    }
    return created;
  }

  /**
   * Lists a customer's ledger, newest first.
   *
   * @param {string} customerId - Customer id
   * @param {Object} ctx - Operation context
   * @param {Object} [filter] - `{ purpose, channel }`
   * @return {Promise<Object[]>} Presented records
   */
  async history(customerId, ctx, { purpose, channel } = {}) {
    await loadParty(this.repos, 'customer', customerId, ctx);
    const all = await this.repo.findByIndex('customer', customerId, ctx);
    return sortLedger(all.filter((r) => (!purpose || r.purpose === purpose) && (!channel || r.channel === channel)));
  }

  /**
   * Current consent per `(purpose, channel, topicId)`.
   *
   * @param {string} customerId - Customer id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {Date} [opts.at=now] - Evaluation time (expiry)
   * @return {Promise<Object[]>} One record per key: `{ purpose, channel, topicId, status, lawfulBasis, source, capturedAt, expiresAt, consentId }`
   */
  async getConsentState(customerId, ctx, { at = new Date() } = {}) {
    const all = await this.repo.findByIndex('customer', customerId, readAs(ctx));
    return [...currentByKey(all, at).values()].map(toState).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }

  /**
   * Decides whether a customer may be contacted for a purpose on a channel.
   *
   * @param {string} customerId - Customer id
   * @param {{purpose: string, channel: string, topicId?: string}} request - What the contact is for
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {Date} [opts.at=now] - Evaluation time
   * @return {Promise<{allowed: boolean, reason: string, consentId: ?string}>} Decision
   */
  async canContact(customerId, { purpose, channel, topicId } = {}, ctx, { at = new Date() } = {}) {
    if (!purpose || !channel) {
      throw validationError('purpose and channel are required', [{ path: 'purpose', message: 'is required' }]);
    }
    const customer = await loadParty(this.repos, 'customer', customerId, ctx);
    if (BLOCKED_STATUSES.has(customer.status)) {
      return { allowed: false, reason: `customer_${customer.status}`, consentId: null };
    }
    const current = currentByKey(await this.repo.findByIndex('customer', customerId, readAs(ctx)), at);
    const levels = [];
    if (topicId) levels.push(current.get(`${purpose}|${channel}|${topicId}`));
    levels.push(current.get(`${purpose}|${channel}|`));
    if (channel !== 'any') levels.push(current.get(`${purpose}|any|`));

    const index = levels.findIndex(Boolean);
    if (index === -1) {
      return purpose === 'service_messages'
        ? { allowed: true, reason: 'service_default', consentId: null }
        : { allowed: false, reason: 'no_consent', consentId: null };
    }
    const decisive = levels[index];
    if (decisive.status !== 'opt_in') {
      return { allowed: false, reason: decisive.status === 'pending' ? 'consent_pending' : 'opted_out', consentId: decisive.id };
    }
    const overriding = levels.slice(index + 1)
      .find((r) => r && r.status === 'opt_out' && compareRecords(r, decisive) > 0);
    if (overriding) return { allowed: false, reason: 'opted_out', consentId: overriding.id };
    return { allowed: true, reason: 'opted_in', consentId: decisive.id };
  }

  async currentFor_(customerId, { purpose, channel, topicId }, ctx) {
    const all = await this.repo.findByIndex('customer', customerId, readAs(ctx));
    return currentByKey(all, new Date()).get(`${purpose}|${channel}|${topicId || ''}`) || null;
  }
}

/** Orders records by capturedAt, then createdAt. */
function compareRecords(a, b) {
  return String(a.capturedAt).localeCompare(String(b.capturedAt)) || String(a.createdAt).localeCompare(String(b.createdAt));
}

function sortLedger(records) {
  return records.sort((a, b) => compareRecords(b, a));
}

/** Latest unexpired record per key. */
function currentByKey(records, at) {
  const out = new Map();
  for (const r of records) {
    if (r.expiresAt && new Date(r.expiresAt) <= at) continue;
    if (new Date(r.capturedAt) > at) continue;
    const key = keyOf(r);
    const prev = out.get(key);
    if (!prev || compareRecords(r, prev) > 0) out.set(key, r);
  }
  return out;
}

function toState(r) {
  return {
    purpose: r.purpose,
    channel: r.channel,
    topicId: r.topicId || null,
    status: r.status,
    lawfulBasis: r.lawfulBasis,
    source: r.source,
    capturedAt: r.capturedAt,
    expiresAt: r.expiresAt || null,
    consentId: r.id
  };
}

module.exports = { ConsentService };
