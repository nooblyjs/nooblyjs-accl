/**
 * @fileoverview Marketing scheduler: one background tick that
 *   1. starts messages whose `nextRunAt` is due,
 *   2. re-queues deferred communications whose `deferUntil` has passed
 *      (quiet hours, throttling, retries, paused messages),
 *   3. completes message runs with no open communications.
 *
 * Schedules live on the message documents (`nextRunAt`), so they survive a
 * restart; `recover()` re-queues communications that were queued when the
 * process stopped (the memory queue does not persist) and fails those that
 * were mid-send, so nothing is ever sent twice.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { systemContext } = require('../../shared/context');

class MarketingScheduler {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   * @param {Object} deps.messages - MessageService
   * @param {Object} deps.communications - CommunicationService
   * @param {Object} deps.dataService - Core dataService (recovery scan)
   * @param {Set<string>} deps.tenants - Tenants with marketing activity
   * @param {number} [deps.tickMs=5000] - Tick interval
   * @param {Object} [deps.logger] - Logger
   */
  constructor({ repos, messages, communications, dataService, tenants, tickMs = 5000, logger }) {
    this.repos = repos;
    this.messages = messages;
    this.communications = communications;
    this.dataService = dataService;
    this.tenants = tenants;
    this.tickMs = tickMs;
    this.logger = logger;
    this.timer_ = null;
    this.ticking_ = null;
  }

  start() {
    if (this.timer_) return;
    this.timer_ = setInterval(() => { this.tick().catch(() => {}); }, this.tickMs);
    if (this.timer_.unref) this.timer_.unref();
  }

  stop() {
    if (this.timer_) clearInterval(this.timer_);
    this.timer_ = null;
  }

  /**
   * Runs one tick (also callable directly, e.g. from tests). Overlapping
   * calls share the in-flight tick.
   *
   * @param {Date} [now=new Date()] - Reference time
   * @return {Promise<{started: number, requeued: number, completed: number}>} Counts
   */
  tick(now = new Date()) {
    if (!this.ticking_) {
      this.ticking_ = this.tick_(now).finally(() => { this.ticking_ = null; });
    }
    return this.ticking_;
  }

  async tick_(now) {
    const counts = { started: 0, requeued: 0, completed: 0 };
    for (const tenantId of this.tenants) {
      const ctx = systemContext('marketing-scheduler', { tenantId });
      for (const m of await this.repos.message.findByIndex('status', 'scheduled', ctx)) {
        if (m.nextRunAt && new Date(m.nextRunAt) <= now) {
          try {
            await this.messages.run(m.id, ctx);
            counts.started++;
          } catch (err) {
            this.logger?.error?.('[accel-customers] message run failed', { messageId: m.id, error: err.message });
          }
        }
      }
      for (const c of await this.repos.communication.findByIndex('status', 'deferred', ctx)) {
        if (!c.deferUntil || new Date(c.deferUntil) <= now) {
          await this.repos.communication.update(c.id, {}, ctx, { expectedVersion: c.version, system: { status: 'queued', deferUntil: null } })
            .then(() => this.communications.enqueue(c.id, tenantId))
            .then(() => { counts.requeued++; })
            .catch((err) => { if (err.statusCode !== 412) throw err; });
        }
      }
      for (const m of await this.repos.message.findByIndex('status', 'sending', ctx)) {
        const after = await this.messages.completeIfDone(m.id, ctx);
        if (after.status !== 'sending') counts.completed++;
      }
    }
    return counts;
  }

  /**
   * Finds tenants with marketing data and re-queues queued communications.
   *
   * @param {string} prefix - Container prefix
   * @return {Promise<number>} Communications re-queued
   */
  async recover(prefix) {
    let requeued = 0;
    for (const m of await this.dataService.listAll(`${prefix}_messages`)) if (m && m.tenantId) this.tenants.add(m.tenantId);
    for (const c of await this.dataService.listAll(`${prefix}_communications`)) {
      if (!c || !c.tenantId) continue;
      this.tenants.add(c.tenantId);
      if (c.status === 'sending') {
        // Interrupted mid-send: the provider may already have accepted it.
        // Never risk a double send; record it as failed for an operator to review.
        await this.repos.communication.update(c.id, {}, systemContext('marketing-recover', { tenantId: c.tenantId }), {
          system: { status: 'failed', error: 'interrupted' }
        });
      } else if (c.status === 'queued') {
        await this.communications.enqueue(c.id, c.tenantId);
        requeued++;
      }
    }
    return requeued;
  }
}

module.exports = { MarketingScheduler };
