/**
 * @fileoverview Customer 360 timeline (PRD CU-11).
 *
 * v1 merges entries at query time from registered providers. Built-in
 * providers cover notes, consent records and the audit log of the customer
 * and its contact points / identities. Marketing (communications,
 * engagement) and support (interactions, issues) register their own
 * providers in later phases via `register()`.
 *
 * Entry shape: `{ id, type, at, title, summary?, actor?, ref: { entity, id }, data? }`.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { validationError } = require('../../shared/errors');
const { loadParty } = require('./support');

const ENTITY_LABELS = Object.freeze({
  customer: 'Customer', email: 'Email', phone: 'Phone', address: 'Address', identity: 'Identity'
});
const ACTION_LABELS = Object.freeze({
  create: 'added', update: 'updated', delete: 'removed', erase: 'erased', merge: 'merged', export: 'exported', view_pii: 'viewed'
});
const MAX_LIMIT = 200;

class TimelineService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories
   * @param {Object} deps.audit - AuditService
   */
  constructor({ repos, audit }) {
    this.repos = repos;
    this.audit = audit;
    this.providers = new Map();
    this.register('note', (customerId, ctx) => this.notes_(customerId, ctx));
    this.register('consent', (customerId, ctx) => this.consents_(customerId, ctx));
    this.register('audit', (customerId, ctx) => this.audit_(customerId, ctx));
  }

  /**
   * Registers a timeline provider. A provider returns entries for one customer.
   *
   * @param {string} type - Entry type it produces (also the `types` filter value)
   * @param {function(string, Object, Object): Promise<Object[]>} provider - `(customerId, ctx, opts) => entries`
   * @return {function(): void} Unregister function
   */
  register(type, provider) {
    if (typeof provider !== 'function') throw new Error('TimelineService.register: provider must be a function');
    this.providers.set(type, provider);
    return () => this.providers.delete(type);
  }

  /**
   * Returns a customer's timeline, newest first.
   *
   * @param {string} customerId - Customer id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {number} [opts.limit=50] - Maximum entries (≤ 200)
   * @param {string} [opts.before] - Only entries strictly before this ISO time (paging)
   * @param {string[]} [opts.types] - Restrict to these entry types
   * @return {Promise<{items: Object[], nextBefore: ?string}>} Entries and the cursor for the next page
   */
  async list(customerId, ctx, { limit = 50, before, types } = {}) {
    await loadParty(this.repos, 'customer', customerId, ctx);
    if (before !== undefined && Number.isNaN(Date.parse(before))) {
      throw validationError('before must be an ISO-8601 date-time', [{ path: 'before', message: 'is invalid' }]);
    }
    const max = Math.min(Math.max(Number(limit) || 50, 1), MAX_LIMIT);
    const wanted = types && types.length ? types.filter((t) => this.providers.has(t)) : [...this.providers.keys()];
    const batches = await Promise.all(wanted.map((t) => Promise.resolve(this.providers.get(t)(customerId, ctx, { before, limit: max }))
      .catch(() => [])));
    let items = batches.flat().filter((e) => e && e.at);
    if (before) items = items.filter((e) => e.at < new Date(before).toISOString());
    items.sort((a, b) => b.at.localeCompare(a.at) || String(b.id).localeCompare(String(a.id)));
    const page = items.slice(0, max);
    return { items: page, nextBefore: items.length > max ? page[page.length - 1].at : null };
  }

  async notes_(customerId, ctx) {
    const notes = await this.repos.note.findByIndex('subject', customerId, ctx);
    return notes.filter((n) => n.subjectType === 'customer').map((n) => ({
      id: `note:${n.id}`,
      type: 'note',
      at: n.createdAt,
      title: n.pinned ? 'Pinned note' : 'Note',
      summary: typeof n.body === 'string' ? n.body.slice(0, 280) : '',
      actor: n.createdBy,
      ref: { entity: 'note', id: n.id }
    }));
  }

  async consents_(customerId, ctx) {
    const records = await this.repos.consent.findByIndex('customer', customerId, ctx);
    return records.map((r) => ({
      id: `consent:${r.id}`,
      type: 'consent',
      at: r.capturedAt || r.createdAt,
      title: `${r.status === 'opt_in' ? 'Opted in to' : r.status === 'opt_out' ? 'Opted out of' : 'Pending consent for'} ${r.purpose.replace(/_/g, ' ')} (${r.channel}${r.topicId ? ` · ${r.topicId}` : ''})`,
      summary: `Source: ${r.source}; basis: ${r.lawfulBasis}`,
      actor: r.createdBy,
      ref: { entity: 'consent', id: r.id },
      data: { purpose: r.purpose, channel: r.channel, topicId: r.topicId || null, status: r.status }
    }));
  }

  async audit_(customerId, ctx) {
    // entries about the customer and its contact points / identities, including removed ones
    const page = await this.audit.list({ relatedTo: customerId, limit: 1000 }, ctx);
    return page.items
      .filter((e) => ENTITY_LABELS[e.entity])
      .filter((e) => !(e.action === 'update' && onlyBookkeeping(e.changes)))
      .map((e) => ({
        id: `audit:${e.id}`,
        type: 'audit',
        at: e.at,
        title: `${ENTITY_LABELS[e.entity]} ${ACTION_LABELS[e.action] || e.action}`,
        summary: e.action === 'update' ? summarise(e.changes) : '',
        actor: e.actor && e.actor.id,
        ref: { entity: e.entity, id: e.entityId }
      }));
  }
}

/** Primary flags and pointers change as side effects of contact-point edits. */
const BOOKKEEPING_PATHS = new Set(['/isPrimary', '/primaryEmailId', '/primaryPhoneId', '/primaryAddressId']);

function onlyBookkeeping(changes = []) {
  return changes.length > 0 && changes.every((c) => BOOKKEEPING_PATHS.has(c.path));
}

function summarise(changes = []) {
  const fields = [...new Set(changes.map((c) => c.path.split('/')[1]).filter(Boolean))]
    .filter((f) => !['deletedAt', 'partyType', 'partyId', 'customerId'].includes(f));
  if (!fields.length) return '';
  return `Fields: ${fields.slice(0, 8).join(', ')}${fields.length > 8 ? ', …' : ''}`;
}

module.exports = { TimelineService };
