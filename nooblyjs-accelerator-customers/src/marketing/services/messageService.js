/**
 * @fileoverview MessageService (PRD MK-4, MK-8, MK-17).
 *
 * Messages are send definitions: template + audience + schedule. Lifecycle:
 *
 *   draft → scheduled → sending → sent            (immediate / at)
 *   draft → scheduled → sending → scheduled → …   (recurring cron)
 *   scheduled | sending ↔ paused;  any open state → cancelled
 *
 * A run resolves the audience and creates one queued communication per
 * recipient, keyed `(messageId, runId, customerId)` so a run never
 * double-sends. Audience v1: explicit customer ids and/or a simple rule (a
 * list of filters over customer fields plus `email`, `phone` and
 * `countryCode` from the primary contact points). Segments arrive in Phase 4.
 *
 * Also hosts `sendTransactional()` and test sends.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { randomUUID } = require('crypto');
const { isValid: isValidCron, nextMatch } = require('nooblyjs-core/src/scheduling/providers/cronExpression');
const { validationError, conflict, badRequest, notFound } = require('../../shared/errors');
const QueryEngine = require('../../shared/repository/queryEngine');
const { missingRequired, sampleData } = require('../templating/renderer');
const { OPEN_ENDED } = require('./communicationService');

const COMPUTED_FIELDS = new Set(['email', 'phone', 'countryCode']);
const MAX_AUDIENCE = 100000;
const EDITABLE = new Set(['draft', 'paused']);

class MessageService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   * @param {Object} deps.customer - Customer module services
   * @param {Object} deps.templates - TemplateService
   * @param {Object} deps.campaigns - CampaignService
   * @param {Object} deps.topics - TopicService
   * @param {Object} deps.communications - CommunicationService
   * @param {Object} deps.dispatcher - Dispatcher
   * @param {Object} deps.events - DomainEventBus
   * @param {Set<string>} deps.tenants - Tenants with marketing activity
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.repo = deps.repos.message;
  }

  // ---- CRUD ---------------------------------------------------------------

  async create(input, ctx) {
    await this.checkReferences_(input || {}, ctx);
    const created = await this.repo.create(input, ctx, { system: { status: 'draft', runCount: 0 } });
    this.tenants.add(ctx.tenantId);
    return created;
  }

  async update(id, patch, ctx, { expectedVersion } = {}) {
    const current = await this.repo.get(id, ctx);
    if (!EDITABLE.has(current.status)) throw conflict(`A ${current.status} message cannot be edited; pause it first`);
    await this.checkReferences_({ ...current, ...(patch || {}) }, ctx);
    return this.repo.update(id, patch, ctx, { expectedVersion });
  }

  async remove(id, ctx) {
    const current = await this.repo.get(id, ctx);
    if (current.status !== 'draft' && current.status !== 'cancelled') throw conflict('Only draft or cancelled messages can be deleted');
    return this.repo.softDelete(id, ctx);
  }

  // ---- lifecycle ----------------------------------------------------------

  /**
   * Schedules a draft (or paused) message. Immediate messages start now.
   *
   * @param {string} id - Message id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented message
   */
  async schedule(id, ctx) {
    const message = await this.repo.get(id, ctx);
    if (!['draft', 'paused'].includes(message.status)) throw conflict(`A ${message.status} message cannot be scheduled`);
    const template = await this.templates.repo.get(message.templateId, ctx);
    if (template.status !== 'approved') throw conflict('The template must be approved before scheduling', { templateId: template.id });
    const campaign = await this.campaigns.repo.get(message.campaignId, ctx);
    if (['completed', 'archived'].includes(campaign.status)) throw conflict(`The campaign is ${campaign.status}`);
    if (!hasAudience(message.audience)) throw validationError('The audience is empty', [{ path: 'audience', message: 'needs customerIds or a rule' }]);
    const nextRunAt = this.nextRun_(message.schedule || {}, new Date(), true);
    if (campaign.status === 'draft') await this.campaigns.setStatus(campaign.id, 'running', ctx);
    const scheduled = await this.repo.update(id, {}, ctx, { system: { status: 'scheduled', nextRunAt } });
    this.tenants.add(ctx.tenantId);
    this.publish_('message.scheduled', scheduled, ctx, { nextRunAt });
    if (new Date(nextRunAt) <= new Date()) return this.run(id, ctx);
    return scheduled;
  }

  /**
   * Starts a run: resolves the audience and queues one communication each.
   *
   * @param {string} id - Message id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented message (status sending)
   */
  async run(id, ctx) {
    const message = await this.repo.get(id, ctx);
    if (message.status !== 'scheduled') throw conflict(`A ${message.status} message cannot start`);
    const runId = randomUUID();
    const recurring = message.schedule && message.schedule.type === 'recurring';
    const started = await this.repo.update(id, {}, ctx, {
      system: {
        status: 'sending', currentRunId: runId, lastRunAt: new Date().toISOString(), runCount: (message.runCount || 0) + 1,
        // advance from the slot that just ran, so a late tick never re-runs the same slot
        nextRunAt: recurring ? this.nextRun_(message.schedule, new Date(Math.max(Date.now(), new Date(message.nextRunAt || 0).getTime())), false) : null
      }
    });
    const campaign = await this.campaigns.repo.find(message.campaignId, ctx);
    const topicId = message.topicId || (campaign && campaign.topicId) || undefined;
    const audience = await this.resolveAudience(message.audience, ctx);
    for (const customerId of audience) {
      await this.communications.create({
        customerId,
        channel: message.channel,
        purpose: message.purpose || 'marketing',
        topicId,
        origin: { type: 'campaign', campaignId: message.campaignId, messageId: message.id, runId },
        idempotencyKey: `msg:${message.id}:${recurring ? runId : 'once'}:${customerId}`,
        templateId: message.templateId,
        from: message.from
      }, ctx);
    }
    this.publish_('message.started', started, ctx, { runId, recipients: audience.length });
    if (!audience.length) return this.completeIfDone(id, ctx);
    return started;
  }

  /**
   * Finishes a run when none of its communications are still open.
   *
   * @param {string} id - Message id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented message
   */
  async completeIfDone(id, ctx) {
    const message = await this.repo.get(id, ctx);
    if (message.status !== 'sending') return message;
    const comms = await this.repos.communication.findByIndex('message', id, ctx);
    if (comms.some((c) => c.origin.runId === message.currentRunId && OPEN_ENDED.has(c.status))) return message;
    const recurring = message.schedule && message.schedule.type === 'recurring' && message.nextRunAt;
    const done = await this.repo.update(id, {}, ctx, { system: { status: recurring ? 'scheduled' : 'sent' } });
    const stats = await this.communications.stats(id, ctx, { runId: message.currentRunId });
    this.publish_('message.completed', done, ctx, { runId: message.currentRunId, stats });
    return done;
  }

  async pause(id, ctx) {
    const message = await this.repo.get(id, ctx);
    if (!['scheduled', 'sending'].includes(message.status)) throw conflict(`A ${message.status} message cannot be paused`);
    return this.repo.update(id, {}, ctx, { system: { status: 'paused' } });
  }

  /**
   * Resumes a paused message: back to sending when a run is in progress,
   * else back to scheduled.
   */
  async resume(id, ctx) {
    const message = await this.repo.get(id, ctx);
    if (message.status !== 'paused') throw conflict(`A ${message.status} message cannot be resumed`);
    const comms = message.currentRunId ? await this.repos.communication.findByIndex('message', id, ctx) : [];
    const inRun = comms.some((c) => c.origin.runId === message.currentRunId && OPEN_ENDED.has(c.status));
    if (inRun) return this.repo.update(id, {}, ctx, { system: { status: 'sending' } });
    return this.schedule(id, ctx);
  }

  /** Cancels a message; its queued communications are skipped as cancelled. */
  async cancel(id, ctx) {
    const message = await this.repo.get(id, ctx);
    if (['sent', 'cancelled'].includes(message.status)) throw conflict(`A ${message.status} message cannot be cancelled`);
    const cancelled = await this.repo.update(id, {}, ctx, { system: { status: 'cancelled', nextRunAt: null } });
    for (const c of await this.repos.communication.findByIndex('message', id, ctx)) {
      if (c.status === 'queued' || c.status === 'deferred') {
        await this.repos.communication.update(c.id, {}, ctx, { system: { status: 'skipped', skipReason: 'cancelled', deferUntil: null } });
      }
    }
    this.publish_('message.cancelled', cancelled, ctx);
    return cancelled;
  }

  // ---- audience -----------------------------------------------------------

  /**
   * Resolves an audience definition to customer ids.
   *
   * @param {Object} audience - `{ customerIds?, excludeCustomerIds?, rule?: { filters } }`
   * @param {Object} ctx - Operation context
   * @return {Promise<string[]>} Customer ids (deduplicated, live customers only)
   */
  async resolveAudience(audience = {}, ctx) {
    const customers = this.customer.customers.repo;
    const ids = new Set();
    for (const id of audience.customerIds || []) {
      if (await customers.find(id, ctx)) ids.add(id);
    }
    const filters = (audience.rule && audience.rule.filters) || [];
    if (filters.length) {
      const direct = filters.filter((f) => !COMPUTED_FIELDS.has(f.field));
      const computed = filters.filter((f) => COMPUTED_FIELDS.has(f.field));
      const page = await customers.list({ filters: direct.map(normaliseFilter), limit: MAX_AUDIENCE, offset: 0 }, ctx);
      for (const c of page.items) {
        if (!computed.length) {
          ids.add(c.id);
          continue;
        }
        const view = await this.audienceView_(c, ctx);
        if (computed.every((f) => QueryEngine.matchFilter(view, normaliseFilter(f)))) ids.add(c.id);
      }
    }
    for (const id of audience.excludeCustomerIds || []) ids.delete(id);
    return [...ids].slice(0, MAX_AUDIENCE);
  }

  /** Counts an audience and returns a small sample (UI preview). */
  async previewAudience(audience, ctx) {
    await this.checkRule_(audience);
    const ids = await this.resolveAudience(audience || {}, ctx);
    const sample = [];
    for (const id of ids.slice(0, 10)) sample.push(await this.customer.customers.repo.find(id, ctx));
    return { count: ids.length, sample: sample.filter(Boolean) };
  }

  async audienceView_(customer, ctx) {
    const cp = this.customer.contactPoints;
    const primary = (list) => list.find((x) => x.isPrimary) || list[0] || null;
    const email = primary(await cp.email.listUnchecked('customer', customer.id, ctx));
    const phone = primary(await cp.phone.listUnchecked('customer', customer.id, ctx));
    const address = primary(await cp.address.listUnchecked('customer', customer.id, ctx));
    return { email: email && email.address, phone: phone && phone.e164, countryCode: address && address.countryCode };
  }

  // ---- sends outside campaigns -------------------------------------------

  /**
   * Sends a transactional or service message now (PRD MK-8). Marketing
   * consent, frequency caps and quiet hours do not apply; bounces,
   * complaints and legal suppressions do.
   *
   * @param {Object} input
   * @param {string} input.template - Template id or key (must be approved)
   * @param {string} [input.customerId] - Recipient customer
   * @param {string} [input.to] - Explicit address (defaults to the customer's primary)
   * @param {Object} [input.data] - Variables for the template
   * @param {string} [input.purpose='transactional'] - `transactional` or `service`
   * @param {string} [input.idempotencyKey] - Repeat-safe key (same key → same communication)
   * @param {string} [input.locale] - Preferred locale
   * @param {Object} ctx - Operation context
   * @return {Promise<{communication: Object, created: boolean}>} The communication after dispatch
   */
  async sendTransactional(input, ctx) {
    if (!input || typeof input !== 'object') throw badRequest('body must be an object');
    const purpose = input.purpose || 'transactional';
    if (!['transactional', 'service'].includes(purpose)) {
      throw validationError('purpose must be transactional or service', [{ path: 'purpose', message: 'must be transactional or service' }]);
    }
    if (!input.customerId && !input.to) throw validationError('customerId or to is required', [{ path: 'customerId', message: 'or to is required' }]);
    if (input.customerId && !(await this.customer.customers.repo.find(input.customerId, ctx))) throw notFound('customer', input.customerId);
    const template = await this.templates.resolve(input.template, ctx);
    if (template.status !== 'approved') throw conflict('The template must be approved', { templateId: template.id });
    const data = input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {};
    const missing = missingRequired(template.variables, data);
    if (missing.length) throw validationError('Template data is incomplete', missing);
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length > 200)) {
      throw validationError('idempotencyKey must be a string of at most 200 characters', [{ path: 'idempotencyKey', message: 'is invalid' }]);
    }
    const result = await this.communications.create({
      customerId: input.customerId,
      to: input.to,
      channel: template.channel,
      purpose,
      origin: { type: 'transactional' },
      idempotencyKey: input.idempotencyKey ? `tx:${input.idempotencyKey}` : undefined,
      templateId: template.id,
      data,
      locale: input.locale
    }, ctx, { enqueue: false });
    if (result.created) await this.dispatcher.process(result.communication.id, ctx.tenantId);
    return { communication: await this.repos.communication.get(result.communication.id, ctx), created: result.created };
  }

  /**
   * Sends one copy of a message to a test recipient (PRD MK-17). No policy
   * checks, no tracking; recorded with origin `test`.
   *
   * @param {string} id - Message id
   * @param {Object} target - `{ customerId }` or `{ to }`
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} The test communication
   */
  async testSend(id, target, ctx) {
    const message = await this.repo.get(id, ctx);
    if (!target || (!target.customerId && !target.to)) throw validationError('customerId or to is required', [{ path: 'to', message: 'or customerId is required' }]);
    if (target.customerId && !(await this.customer.customers.repo.find(target.customerId, ctx))) throw notFound('customer', target.customerId);
    const template = await this.templates.repo.get(message.templateId, ctx);
    const { communication } = await this.communications.create({
      customerId: target.customerId,
      to: target.to,
      channel: message.channel,
      purpose: message.purpose || 'marketing',
      origin: { type: 'test', campaignId: message.campaignId, messageId: message.id },
      idempotencyKey: `test:${randomUUID()}`,
      templateId: message.templateId,
      data: target.customerId ? undefined : sampleData(template.variables),
      from: message.from
    }, ctx, { enqueue: false });
    await this.dispatcher.process(communication.id, ctx.tenantId);
    return this.repos.communication.get(communication.id, ctx);
  }

  // ---- internals ----------------------------------------------------------

  async checkReferences_(m, ctx) {
    if (m.campaignId) await this.campaigns.repo.get(m.campaignId, ctx);
    if (m.templateId) {
      const template = await this.templates.repo.get(m.templateId, ctx);
      if (m.channel && template.channel !== m.channel) {
        throw validationError(`Template is for ${template.channel}, message is ${m.channel}`, [{ path: 'templateId', message: 'channel does not match' }]);
      }
      if (template.status === 'retired') throw validationError('Template is retired', [{ path: 'templateId', message: 'is retired' }]);
    }
    if (m.topicId) await this.topics.assertExists(m.topicId, ctx);
    await this.checkRule_(m.audience);
    if (m.schedule) this.nextRun_(m.schedule, new Date(), true, { validateOnly: true });
  }

  async checkRule_(audience) {
    const filters = (audience && audience.rule && audience.rule.filters) || [];
    const schema = this.customer.customers.repo.schema;
    filters.forEach((f, i) => {
      if (!f || typeof f.field !== 'string') throw validationError('Invalid audience filter', [{ path: `audience.rule.filters[${i}]`, message: 'needs a field' }]);
      if (!COMPUTED_FIELDS.has(f.field) && !schema.fields[f.field.split('.')[0]]) {
        throw validationError(`Unknown audience field '${f.field}'`, [{ path: `audience.rule.filters[${i}].field`, message: 'is not a customer field' }]);
      }
    });
  }

  /**
   * Next run time for a schedule.
   *
   * @param {Object} schedule - `{ type, at, cron }`
   * @param {Date} now - Reference time
   * @param {boolean} first - First run (immediate → now; at → its time)
   * @param {Object} [opts] - `{ validateOnly }`
   * @return {?string} ISO time
   */
  nextRun_(schedule, now, first, { validateOnly = false } = {}) {
    const type = schedule.type || 'immediate';
    if (type === 'immediate') return now.toISOString();
    if (type === 'at') {
      if (!schedule.at) throw validationError('schedule.at is required', [{ path: 'schedule.at', message: 'is required' }]);
      if (!validateOnly && new Date(schedule.at) < new Date(now.getTime() - 60 * 1000)) {
        throw validationError('schedule.at is in the past', [{ path: 'schedule.at', message: 'is in the past' }]);
      }
      return new Date(Math.max(new Date(schedule.at).getTime(), now.getTime())).toISOString();
    }
    if (!schedule.cron || !isValidCron(schedule.cron)) throw validationError('schedule.cron must be a 5-field cron expression', [{ path: 'schedule.cron', message: 'is invalid' }]);
    if (validateOnly) return null;
    const next = nextMatch(schedule.cron, now);
    return next ? next.toISOString() : null;
  }

  publish_(type, message, ctx, data = {}) {
    this.events?.publish(type, {
      module: 'marketing', subject: { entity: 'message', id: message.id }, data: { messageId: message.id, status: message.status, ...data }
    }, ctx);
  }
}

function hasAudience(a) {
  return Boolean(a && ((a.customerIds && a.customerIds.length) || (a.rule && a.rule.filters && a.rule.filters.length)));
}

function normaliseFilter(f) {
  return { field: f.field, op: f.op || 'eq', value: f.value };
}

module.exports = { MessageService, COMPUTED_FIELDS };
