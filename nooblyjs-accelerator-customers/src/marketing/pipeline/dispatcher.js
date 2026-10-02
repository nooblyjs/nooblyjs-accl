/**
 * @fileoverview Send pipeline (PRD MK-5, Architecture §7.1).
 *
 * The dispatcher takes communication ids from the core queue and runs each
 * through:
 *
 *   claim (queued → sending, version-checked: never sent twice)
 *   → message gate (paused → defer, cancelled → skip)
 *   → customer and address (blocked/merged/erased, invalid address)
 *   → suppression (all purposes; marketing-only reasons skip transactional)
 *   → consent (marketing only, via the customer module's canContact)
 *   → frequency cap and quiet hours (marketing only, per message flags)
 *   → throttle (per message, per minute)
 *   → render (template + tracking links + open pixel + unsubscribe URL)
 *   → adapter send → sent | deferred for retry | failed
 *
 * Every skip is recorded on the communication with its reason. Test sends
 * bypass the policy checks.
 *
 * Core `working` runs activity scripts in worker threads that cannot reach
 * in-process repositories, so workers here are in-process async loops over
 * the core queue.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { systemContext } = require('../../shared/context');
const { rewriteLinks, addOpenPixel } = require('../tracking');

const CONSENT_REASONS = Object.freeze({
  no_consent: 'no_consent', opted_out: 'opted_out', consent_pending: 'consent_pending',
  customer_blocked: 'customer_blocked', customer_merged: 'customer_merged', customer_erased: 'customer_erased'
});
const MINUTE = 60 * 1000;

class Dispatcher {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   * @param {Object} deps.customer - Customer module services
   * @param {Object} deps.templates - TemplateService
   * @param {Object} deps.suppressions - SuppressionService
   * @param {Object} deps.communications - CommunicationService
   * @param {Object<string, Object>} deps.channels - Adapter per channel
   * @param {Object} deps.trackingUrls - TrackingUrls
   * @param {Object} deps.queue - Core queue
   * @param {string} deps.queueName - Queue name
   * @param {Object} deps.options - Marketing options (`defaults`, `dispatch`)
   * @param {Object} [deps.logger] - Logger
   */
  constructor(deps) {
    Object.assign(this, deps);
    const d = deps.options.dispatch || {};
    this.concurrency = d.concurrency || 8;
    this.pollMs = d.pollMs || 250;
    this.maxAttempts = d.maxAttempts || 3;
    this.retryDelayMs = d.retryDelayMs || 30 * 1000;
    this.defaults = deps.options.defaults || {};
    this.windows_ = new Map();
    this.timer_ = null;
    this.active_ = 0;
    this.stopped_ = true;
  }

  /** Starts polling the queue. */
  start() {
    if (!this.stopped_) return;
    this.stopped_ = false;
    const loop = () => {
      if (this.stopped_) return;
      this.pump_().then((n) => n, () => 0).then((n) => {
        if (this.stopped_) return;
        // keep going while there is work; poll only when the queue is idle
        this.timer_ = setTimeout(loop, n > 0 ? 0 : this.pollMs);
        if (this.timer_.unref) this.timer_.unref();
      });
    };
    loop();
  }

  /** Stops polling (in-flight items finish). */
  stop() {
    this.stopped_ = true;
    if (this.timer_) clearTimeout(this.timer_);
    this.timer_ = null;
  }

  /**
   * Processes queued items until the queue is empty (tests, scripts).
   *
   * @return {Promise<number>} Items processed
   */
  async drain() {
    let total = 0;
    for (;;) {
      const n = await this.pump_();
      total += n;
      if (n === 0) return total;
    }
  }

  async pump_() {
    const jobs = [];
    while (this.active_ + jobs.length < this.concurrency) {
      const item = await this.queue.dequeue(this.queueName);
      if (!item) break;
      jobs.push(item);
    }
    this.active_ += jobs.length;
    await Promise.all(jobs.map((item) => this.process(item.id, item.n)
      .catch((err) => this.logger?.error?.('[accel-customers] dispatch failed', { communicationId: item.id, error: err.message }))
      .finally(() => { this.active_ -= 1; })));
    return jobs.length;
  }

  /**
   * Runs one communication through the pipeline.
   *
   * @param {string} id - Communication id
   * @param {string} tenantId - Tenant
   * @return {Promise<?Object>} Final communication (null when not processed)
   */
  async process(id, tenantId) {
    const ctx = systemContext('marketing-dispatch', { tenantId });
    const comm = await this.repos.communication.find(id, ctx);
    // deferred work waits for the scheduler, which moves it back to queued when due
    if (!comm || comm.status !== 'queued') return null;
    let claimed;
    try {
      claimed = await this.repos.communication.update(id, {}, ctx, {
        expectedVersion: comm.version, system: { status: 'sending', attempts: (comm.attempts || 0) + 1, deferReason: null }
      });
    } catch (err) {
      if (err.statusCode === 412) return null;
      throw err;
    }
    try {
      return await this.run_(claimed, ctx);
    } catch (err) {
      this.logger?.error?.('[accel-customers] pipeline error', { communicationId: id, error: err.message });
      return this.retryOrFail_(claimed, 'pipeline_error', ctx);
    }
  }

  async run_(comm, ctx) {
    const isTest = comm.origin.type === 'test';
    const isMarketing = comm.purpose === 'marketing';
    let message = null;
    let campaign = null;
    if (comm.origin.messageId) {
      message = await this.repos.message.find(comm.origin.messageId, ctx);
      if (!isTest) {
        if (!message || message.status === 'cancelled') return this.skip_(comm, 'skipped', 'cancelled', ctx);
        if (message.status === 'paused') return this.defer_(comm, Date.now() + MINUTE, 'message_paused', ctx);
      }
      campaign = message && message.campaignId ? await this.repos.campaign.find(message.campaignId, ctx) : null;
      if (!isTest && campaign && campaign.status === 'paused') return this.defer_(comm, Date.now() + MINUTE, 'campaign_paused', ctx);
    }

    // recipient
    let customer = null;
    if (comm.customerId) {
      customer = await this.customer.customers.repo.find(comm.customerId, ctx);
      if (!customer) return this.skip_(comm, 'skipped', 'customer_missing', ctx);
      if (!isTest && (customer.status === 'merged' || customer.status === 'erased')) return this.skip_(comm, 'skipped', `customer_${customer.status}`, ctx);
    }
    const to = comm.to || (customer ? await this.addressFor_(comm.channel, customer, ctx) : null);
    if (!to) return this.skip_(comm, 'skipped', 'invalid_address', ctx);

    if (!isTest) {
      const blocked = await this.suppressions.check({ channel: comm.channel, value: to, topicId: comm.topicId, purpose: comm.purpose }, ctx);
      if (blocked) return this.skip_(comm, 'suppressed', 'suppressed', ctx, { to });
      if (isMarketing) {
        const decision = await this.customer.consents.canContact(comm.customerId, { purpose: 'marketing', channel: comm.channel, topicId: comm.topicId || undefined }, ctx);
        if (!decision.allowed) return this.skip_(comm, 'skipped', CONSENT_REASONS[decision.reason] || 'no_consent', ctx, { to });
        if (!message || message.respectFrequencyCap !== false) {
          if (await this.overFrequencyCap_(comm, ctx)) return this.skip_(comm, 'skipped', 'frequency_cap', ctx, { to });
        }
        if (!message || message.respectQuietHours !== false) {
          const until = this.quietHoursEnd_(customer);
          if (until) return this.defer_(comm, until, 'quiet_hours', ctx);
        }
      }
      if (message && message.throttle && message.throttle.perMinute) {
        const until = this.throttle_(message.id, message.throttle.perMinute);
        if (until) return this.defer_(comm, until, 'throttled', ctx);
      }
    }

    // render
    const template = comm.templateId ? await this.repos.template.find(comm.templateId, ctx) : null;
    if (!template) return this.skip_(comm, 'skipped', 'render_failed', ctx, { error: 'template_missing' });
    let rendered;
    let unsubscribeUrl = null;
    try {
      unsubscribeUrl = isMarketing && !isTest ? this.trackingUrls.unsubscribe(ctx.tenantId, comm.id) : null;
      const context = this.renderContext_(comm, customer, campaign, message, unsubscribeUrl);
      const parts = this.templates.renderParts(template, context, comm.locale || (customer && (customer.locale || customer.language)));
      rendered = { subject: parts.subject, bodyHtml: parts.bodyHtml, bodyText: parts.bodyText };
      rendered.locale = parts.locale;
      if (!isTest) {
        const utm = campaign && campaign.utm;
        rendered = {
          ...rendered,
          ...(await rewriteLinks(rendered, {
            utm,
            skipPrefix: this.trackingUrls.publicBase,
            register: async (targetUrl, position) => {
              const link = await this.repos.trackingLink.create({ communicationId: comm.id, targetUrl, position }, ctx);
              return this.trackingUrls.click(ctx.tenantId, comm.id, link.id);
            }
          }))
        };
        if (comm.channel === 'email' && rendered.bodyHtml) rendered.bodyHtml = addOpenPixel(rendered.bodyHtml, this.trackingUrls.open(ctx.tenantId, comm.id));
      }
    } catch (err) {
      this.logger?.warn?.('[accel-customers] render failed', { communicationId: comm.id, error: err.message });
      return this.skip_(comm, 'skipped', 'render_failed', ctx, { to, error: 'render_failed' });
    }

    // send
    const adapter = this.channels[comm.channel];
    if (!adapter) return this.skip_(comm, 'failed', undefined, ctx, { to, error: `no_adapter_for_${comm.channel}` });
    const from = comm.from || (message && message.from) || (this.defaults.from && this.defaults.from[comm.channel]) || undefined;
    const headers = {};
    if (unsubscribeUrl && comm.channel === 'email') {
      headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    let result;
    try {
      result = await adapter.send({
        channel: comm.channel, communicationId: comm.id, to, from, replyTo: (message && message.replyTo) || undefined,
        subject: rendered.subject, html: rendered.bodyHtml || undefined, text: rendered.bodyText || undefined, headers
      });
    } catch (err) {
      const updated = await this.repos.communication.update(comm.id, {}, ctx, {
        system: { to, rendered: { subject: rendered.subject, bodyHtml: rendered.bodyHtml, bodyText: rendered.bodyText }, locale: rendered.locale, templateRevision: template.revision }
      });
      return this.retryOrFail_(updated, sanitizeError(err), ctx);
    }
    const sent = await this.repos.communication.update(comm.id, {}, ctx, {
      system: {
        status: 'sent', to, sentAt: new Date().toISOString(), provider: adapter.name, providerMessageId: result && result.providerMessageId ? String(result.providerMessageId) : undefined,
        rendered: { subject: rendered.subject, bodyHtml: rendered.bodyHtml, bodyText: rendered.bodyText },
        locale: rendered.locale, templateRevision: template.revision, from, error: null
      }
    });
    this.communications.publishCommunication('communication.sent', sent, ctx);
    return sent;
  }

  // ---- policy helpers -----------------------------------------------------

  async addressFor_(channel, customer, ctx) {
    if (channel === 'email') {
      const emails = await this.customer.contactPoints.email.listUnchecked('customer', customer.id, ctx);
      const usable = emails.filter((e) => !['hard_bounce', 'complaint'].includes(e.deliverability));
      const pick = usable.find((e) => e.isPrimary) || usable[0];
      return pick ? pick.address : null;
    }
    if (channel === 'sms') {
      const phones = await this.customer.contactPoints.phone.listUnchecked('customer', customer.id, ctx);
      const usable = phones.filter((p) => p.e164 && p.status !== 'invalid' && p.status !== 'disconnected' && !(p.capabilities && p.capabilities.sms === false));
      const mobile = usable.filter((p) => p.type === 'mobile');
      const pick = mobile.find((p) => p.isPrimary) || mobile[0] || usable.find((p) => p.isPrimary) || usable[0];
      return pick ? pick.e164 : null;
    }
    return null;
  }

  async overFrequencyCap_(comm, ctx) {
    const cap = this.defaults.frequencyCap;
    if (!cap || !cap.count || !cap.perDays || !comm.customerId) return false;
    const since = Date.now() - cap.perDays * 24 * 60 * MINUTE;
    const recent = (await this.repos.communication.findByIndex('customer', comm.customerId, ctx))
      .filter((c) => c.id !== comm.id && c.purpose === 'marketing' && ['sent', 'delivered'].includes(c.status) && c.sentAt && new Date(c.sentAt).getTime() >= since);
    return recent.length >= cap.count;
  }

  /**
   * When the recipient's local time is inside quiet hours, returns when they
   * end (ms epoch); otherwise null.
   */
  quietHoursEnd_(customer, now = new Date()) {
    const q = this.defaults.quietHours;
    if (!q || !q.start || !q.end) return null;
    const tz = (customer && customer.timezone) || q.timezone || 'UTC';
    let hour; let minute;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      hour = Number(parts.find((p) => p.type === 'hour').value);
      minute = Number(parts.find((p) => p.type === 'minute').value);
    } catch {
      return null;
    }
    const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
    const cur = hour * 60 + minute;
    const start = toMin(q.start);
    const end = toMin(q.end);
    const inside = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
    if (!inside) return null;
    const wait = (end - cur + 24 * 60) % (24 * 60) || 24 * 60;
    return now.getTime() + wait * MINUTE - now.getSeconds() * 1000;
  }

  /** Per-message fixed-window rate limit; returns the next window start when full. */
  throttle_(messageId, perMinute, now = Date.now()) {
    const windowStart = now - (now % MINUTE);
    const w = this.windows_.get(messageId);
    if (!w || w.start !== windowStart) {
      this.windows_.set(messageId, { start: windowStart, count: 1 });
      return null;
    }
    if (w.count >= perMinute) return windowStart + MINUTE;
    w.count += 1;
    return null;
  }

  renderContext_(comm, customer, campaign, message, unsubscribeUrl) {
    const email = comm.channel === 'email' ? comm.to : undefined;
    return {
      ...(comm.data && typeof comm.data === 'object' ? comm.data : {}),
      customer: customer ? {
        id: customer.id,
        number: customer.number,
        givenName: (customer.name && customer.name.given) || '',
        familyName: (customer.name && customer.name.family) || '',
        fullName: (customer.name && customer.name.full) || '',
        preferredName: (customer.name && (customer.name.preferred || customer.name.given || customer.name.full)) || '',
        email,
        language: customer.language,
        locale: customer.locale
      } : {},
      campaign: campaign ? { name: campaign.name, number: campaign.number } : {},
      message: message ? { name: message.name, number: message.number } : {},
      unsubscribeUrl: unsubscribeUrl || '',
      now: new Date().toISOString()
    };
  }

  // ---- outcomes -----------------------------------------------------------

  async skip_(comm, status, reason, ctx, extra = {}) {
    const updated = await this.repos.communication.update(comm.id, {}, ctx, { system: { status, skipReason: reason, ...extra } });
    this.communications.publishCommunication(`communication.${status}`, updated, ctx);
    return updated;
  }

  async defer_(comm, until, reason, ctx) {
    const updated = await this.repos.communication.update(comm.id, {}, ctx, {
      system: { status: 'deferred', deferUntil: new Date(until).toISOString(), deferReason: reason, attempts: Math.max((comm.attempts || 1) - 1, 0) }
    });
    this.communications.publishCommunication('communication.deferred', updated, ctx);
    return updated;
  }

  async retryOrFail_(comm, error, ctx) {
    if ((comm.attempts || 1) < this.maxAttempts) {
      const updated = await this.repos.communication.update(comm.id, {}, ctx, {
        system: { status: 'deferred', deferUntil: new Date(Date.now() + this.retryDelayMs * comm.attempts).toISOString(), deferReason: 'retry', error }
      });
      this.communications.publishCommunication('communication.deferred', updated, ctx);
      return updated;
    }
    const failed = await this.repos.communication.update(comm.id, {}, ctx, { system: { status: 'failed', error } });
    this.communications.publishCommunication('communication.failed', failed, ctx);
    return failed;
  }
}

/** Provider errors may echo addresses or credentials: keep only a code. */
function sanitizeError(err) {
  const code = err && (err.code || err.responseCode || err.name);
  return String(code || 'send_failed').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'send_failed';
}

module.exports = { Dispatcher, sanitizeError };
