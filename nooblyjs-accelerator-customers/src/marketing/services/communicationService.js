/**
 * @fileoverview CommunicationService (PRD MK-6, MK-7, MK-9, MK-10).
 *
 * Communications are the "communications sent" records: one per recipient
 * per message run (or per transactional send), created `queued` and moved
 * through the status lifecycle by the dispatcher. This service creates and
 * queries them and applies engagement: opens, clicks, one-click
 * unsubscribes and provider webhooks (delivery, bounces, complaints).
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { randomUUID } = require('crypto');
const { systemContext } = require('../../shared/context');
const { hashIp, isMachineOpen } = require('../tracking');

const TERMINAL = new Set(['sent', 'delivered', 'bounced', 'failed', 'suppressed', 'skipped']);
const OPEN_ENDED = new Set(['queued', 'deferred', 'sending']);

class CommunicationService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   * @param {Object} deps.customer - Customer module services
   * @param {Object} deps.suppressions - SuppressionService
   * @param {Object} deps.events - DomainEventBus
   * @param {Object} deps.queue - Core queue
   * @param {string} deps.queueName - Dispatch queue name
   * @param {Set<string>} deps.tenants - Tenants with marketing activity (for background sweeps)
   * @param {string} deps.ipSalt - Salt for IP hashes
   * @param {Object} [deps.logger] - Logger
   */
  constructor({ repos, customer, suppressions, events, queue, queueName, tenants, ipSalt, logger }) {
    this.repos = repos;
    this.repo = repos.communication;
    this.customer = customer;
    this.suppressions = suppressions;
    this.events = events;
    this.queue = queue;
    this.queueName = queueName;
    this.tenants = tenants;
    this.ipSalt = ipSalt;
    this.logger = logger;
  }

  /**
   * Creates a queued communication, or returns the existing one for the same
   * idempotency key (`{ communication, created: false }`).
   *
   * @param {Object} input - Communication fields (status is set here)
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ enqueue = true }`
   * @return {Promise<{communication: Object, created: boolean}>} Result
   */
  async create(input, ctx, { enqueue = true } = {}) {
    const idempotencyKey = input.idempotencyKey || `auto:${randomUUID()}`;
    const [existing] = await this.repo.findByIndex('idempotency', idempotencyKey, ctx);
    if (existing) return { communication: existing, created: false };
    let communication;
    try {
      communication = await this.repo.create({ ...input, idempotencyKey, status: 'queued', queuedAt: new Date().toISOString() }, ctx);
    } catch (err) {
      if (err.statusCode === 409) {
        const [winner] = await this.repo.findByIndex('idempotency', idempotencyKey, ctx);
        if (winner) return { communication: winner, created: false };
      }
      throw err;
    }
    this.tenants.add(ctx.tenantId);
    this.publishCommunication('communication.queued', communication, ctx);
    if (enqueue) await this.enqueue(communication.id, ctx.tenantId);
    return { communication, created: true };
  }

  /** Puts a communication on the dispatch queue. */
  async enqueue(id, tenantId) {
    await this.queue.enqueue(this.queueName, { id, n: tenantId });
  }

  /**
   * Lists communications (newest first by default).
   *
   * @param {Object} query - Parsed list query
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Page
   */
  async list(query, ctx) {
    const q = { ...query };
    if (!q.sort || !q.sort.length) q.sort = [{ field: 'createdAt', dir: -1 }];
    return this.repo.list(q, ctx);
  }

  async get(id, ctx) {
    return this.repo.get(id, ctx);
  }

  /** Engagement events of one communication, oldest first. */
  async engagement(id, ctx) {
    await this.repo.get(id, ctx);
    const events = await this.repos.engagement.findByIndex('communication', id, ctx);
    return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  /**
   * Delivery and engagement counts for a message (all runs) or a single run.
   *
   * @param {string} messageId - Message id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ runId }`
   * @return {Promise<Object>} `{ total, byStatus, bySkipReason, opened, clicked, unsubscribed, bounced, openRate, clickRate }`
   */
  async stats(messageId, ctx, { runId } = {}) {
    // test sends are not part of the report
    let comms = (await this.repo.findByIndex('message', messageId, readAll(ctx))).filter((c) => c.origin.type !== 'test');
    if (runId) comms = comms.filter((c) => c.origin && c.origin.runId === runId);
    const byStatus = {};
    const bySkipReason = {};
    let opened = 0; let clicked = 0; let unsubscribed = 0;
    for (const c of comms) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      if (c.skipReason) bySkipReason[c.skipReason] = (bySkipReason[c.skipReason] || 0) + 1;
      if (c.firstOpenedAt) opened++;
      if (c.firstClickedAt) clicked++;
      if (c.unsubscribedAt) unsubscribed++;
    }
    const sent = (byStatus.sent || 0) + (byStatus.delivered || 0) + (byStatus.bounced || 0);
    const rate = (n) => (sent ? Math.round((n / sent) * 10000) / 100 : 0);
    return {
      total: comms.length,
      byStatus,
      bySkipReason,
      sent,
      delivered: byStatus.delivered || 0,
      bounced: byStatus.bounced || 0,
      opened,
      clicked,
      unsubscribed,
      pending: comms.filter((c) => OPEN_ENDED.has(c.status)).length,
      openRate: rate(opened),
      clickRate: rate(clicked),
      unsubscribeRate: rate(unsubscribed)
    };
  }

  // ---- engagement ---------------------------------------------------------

  /**
   * Records an open from the tracking pixel.
   *
   * @param {Object} payload - Verified token payload `{ n, c }`
   * @param {Object} req - `{ ip, userAgent }`
   * @return {Promise<void>}
   */
  async recordOpen(payload, req) {
    const ctx = systemContext('marketing-tracking', { tenantId: payload.n });
    const comm = await this.repo.find(payload.c, ctx);
    if (!comm || !['sent', 'delivered'].includes(comm.status)) return;
    const machine = isMachineOpen(req.userAgent);
    await this.addEngagement_(comm, 'open', { isMachineOpen: machine, ...this.clientInfo_(req) }, ctx);
    const system = { openCount: (comm.openCount || 0) + 1 };
    if (!comm.firstOpenedAt && !machine) system.firstOpenedAt = new Date().toISOString();
    await this.repo.update(comm.id, {}, ctx, { system });
  }

  /**
   * Records a click and returns the registered destination.
   *
   * @param {Object} payload - Verified token payload `{ n, c, l }`
   * @param {Object} req - `{ ip, userAgent }`
   * @return {Promise<?string>} Target URL, or null when unknown
   */
  async recordClick(payload, req) {
    const ctx = systemContext('marketing-tracking', { tenantId: payload.n });
    const link = await this.repos.trackingLink.find(payload.l, ctx);
    if (!link || link.communicationId !== payload.c) return null;
    const comm = await this.repo.find(payload.c, ctx);
    if (comm) {
      await this.addEngagement_(comm, 'click', { url: link.targetUrl, linkId: link.id, ...this.clientInfo_(req) }, ctx);
      const now = new Date().toISOString();
      const system = { clickCount: (comm.clickCount || 0) + 1 };
      if (!comm.firstClickedAt) system.firstClickedAt = now;
      // a click proves the message was opened, even when images were blocked
      if (!comm.firstOpenedAt) system.firstOpenedAt = now;
      await this.repo.update(comm.id, {}, ctx, { system });
    }
    return link.targetUrl;
  }

  /**
   * One-click unsubscribe (RFC 8058): writes an opt-out consent record with
   * evidence and a suppression, scoped to the message topic when there is
   * one, else to the channel. Idempotent.
   *
   * @param {Object} payload - Verified token payload `{ n, c }`
   * @param {Object} req - `{ ip, userAgent }`
   * @return {Promise<?{channel: string, topicId: ?string}>} What was unsubscribed, or null for an unknown communication
   */
  async unsubscribe(payload, req) {
    const ctx = systemContext('marketing-unsubscribe', { tenantId: payload.n });
    const comm = await this.repo.find(payload.c, ctx);
    if (!comm) return null;
    const scope = { channel: comm.channel, topicId: comm.topicId || null };
    if (comm.unsubscribedAt) return scope;
    const customerExists = comm.customerId && await this.customer.customers.repo.find(comm.customerId, ctx);
    if (customerExists) {
      await this.customer.consents.record(comm.customerId, {
        purpose: 'marketing',
        channel: comm.channel,
        topicId: comm.topicId || undefined,
        status: 'opt_out',
        source: 'unsubscribe_link',
        lawfulBasis: 'consent',
        evidence: { ip: req.ip ? String(req.ip).slice(0, 64) : undefined, userAgent: req.userAgent ? String(req.userAgent).slice(0, 500) : undefined, communicationId: comm.id }
      }, ctx);
    }
    if (comm.to) {
      await this.suppressions.add({
        scope: comm.topicId ? 'topic' : 'channel', channel: comm.channel, topicId: comm.topicId || undefined,
        value: comm.to, reason: 'unsubscribe', source: `communication:${comm.id}`
      }, ctx);
    }
    await this.addEngagement_(comm, 'unsubscribe', this.clientInfo_(req), ctx);
    await this.repo.update(comm.id, {}, ctx, { system: { unsubscribedAt: new Date().toISOString() } });
    return scope;
  }

  /**
   * Applies one provider webhook event to its communication.
   *
   * @param {string} provider - Adapter name
   * @param {Object} event - `{ providerMessageId, type, occurredAt, url?, error? }`
   * @param {string} tenantId - Tenant
   * @return {Promise<boolean>} True when a communication was found
   */
  async applyWebhookEvent(provider, event, tenantId) {
    const ctx = systemContext(`marketing-webhook:${provider}`, { tenantId });
    const [comm] = await this.repo.findByIndex('provider', event.providerMessageId, ctx);
    if (!comm) return false;
    const at = event.occurredAt;
    switch (event.type) {
      case 'delivered':
        if (comm.status === 'sent') await this.setStatus_(comm, 'delivered', { deliveredAt: at }, ctx);
        await this.addEngagement_(comm, 'delivered', { occurredAt: at, provider }, ctx);
        break;
      case 'bounce_hard':
      case 'complaint':
        await this.setStatus_(comm, comm.status === 'delivered' && event.type === 'complaint' ? 'delivered' : 'bounced', { error: event.error || event.type }, ctx);
        await this.addEngagement_(comm, event.type, { occurredAt: at, provider }, ctx);
        await this.suppressHard_(comm, event.type === 'complaint' ? 'complaint' : 'hard_bounce', provider, ctx);
        break;
      case 'bounce_soft':
        await this.addEngagement_(comm, 'bounce_soft', { occurredAt: at, provider }, ctx);
        break;
      case 'failed':
        if (!['delivered', 'bounced'].includes(comm.status)) await this.setStatus_(comm, 'failed', { error: event.error || 'provider_failed' }, ctx);
        break;
      case 'open':
        await this.recordOpen({ n: tenantId, c: comm.id }, {});
        break;
      case 'click':
        await this.addEngagement_(comm, 'click', { occurredAt: at, provider, url: event.url }, ctx);
        if (!comm.firstClickedAt) await this.repo.update(comm.id, {}, ctx, { system: { firstClickedAt: at, clickCount: (comm.clickCount || 0) + 1 } });
        break;
      default:
        return false;
    }
    return true;
  }

  // ---- internals ----------------------------------------------------------

  async suppressHard_(comm, reason, provider, ctx) {
    if (comm.to) {
      await this.suppressions.add({ scope: 'channel', channel: comm.channel, value: comm.to, reason, source: `webhook:${provider}` }, ctx);
    }
    if (comm.channel === 'email' && comm.customerId) {
      const emails = await this.customer.contactPoints.email.listUnchecked('customer', comm.customerId, ctx);
      const match = emails.find((e) => e.address === comm.to);
      if (match) {
        await this.customer.repos.email.update(match.id, { deliverability: reason === 'complaint' ? 'complaint' : 'hard_bounce', lastBounceAt: new Date().toISOString() }, ctx);
      }
    }
  }

  async setStatus_(comm, status, extra, ctx) {
    const updated = await this.repo.update(comm.id, {}, ctx, { system: { status, ...extra } });
    this.publishCommunication(`communication.${status}`, updated, ctx);
    return updated;
  }

  async addEngagement_(comm, type, extra, ctx) {
    const doc = {
      communicationId: comm.id,
      customerId: comm.customerId || 'unknown',
      messageId: comm.origin && comm.origin.messageId,
      type,
      occurredAt: extra.occurredAt || new Date().toISOString(),
      ...pick(extra, ['url', 'linkId', 'ipHash', 'userAgent', 'isMachineOpen', 'provider'])
    };
    const created = await this.repos.engagement.create(doc, ctx);
    this.events?.publish(`engagement.${type}`, {
      module: 'marketing',
      subject: { entity: 'communication', id: comm.id },
      data: { communicationId: comm.id, customerId: comm.customerId, messageId: doc.messageId || null, type, engagementId: created.id }
    }, ctx);
    return created;
  }

  clientInfo_(req) {
    return {
      ipHash: hashIp(req.ip, this.ipSalt) || undefined,
      userAgent: req.userAgent ? String(req.userAgent).slice(0, 300) : undefined
    };
  }

  publishCommunication(type, comm, ctx) {
    this.events?.publish(type, {
      module: 'marketing',
      subject: { entity: 'communication', id: comm.id },
      data: {
        communicationId: comm.id,
        customerId: comm.customerId || null,
        channel: comm.channel,
        purpose: comm.purpose,
        status: comm.status,
        skipReason: comm.skipReason || null,
        messageId: (comm.origin && comm.origin.messageId) || null,
        campaignId: (comm.origin && comm.origin.campaignId) || null
      }
    }, ctx);
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function readAll(ctx) {
  return systemContext('marketing-read', { tenantId: ctx.tenantId, correlationId: ctx.correlationId });
}

module.exports = { CommunicationService, TERMINAL, OPEN_ENDED };
