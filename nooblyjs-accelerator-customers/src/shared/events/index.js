/**
 * @fileoverview DomainEventBus.
 *
 * Publishes versioned domain events (Architecture §8) on the host's shared
 * EventEmitter as `cx.{type}` and mirrors them to the core `notifying` topic
 * `cx.{module}`. Handlers registered through the bus are isolated (a throwing
 * or rejecting handler is logged, never propagated to the publisher) and are
 * removed by `close()`.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const { randomUUID } = require('crypto');

const SPEC_VERSION = '1.0';

class DomainEventBus {
  /**
   * @param {Object} deps
   * @param {EventEmitter} deps.eventEmitter - Host's shared emitter
   * @param {Object} [deps.notifying] - Core notifying service
   * @param {Object} [deps.logger] - Core logger
   * @param {string} [deps.prefix='cx'] - Event type prefix
   */
  constructor({ eventEmitter, notifying = null, logger = null, prefix = 'cx' }) {
    if (!eventEmitter) throw new Error('DomainEventBus: eventEmitter is required');
    this.eventEmitter = eventEmitter;
    this.notifying = notifying;
    this.logger = logger;
    this.prefix = prefix;
    this.listeners_ = [];
  }

  /**
   * Builds and publishes an event.
   *
   * @param {string} type - Event type without prefix, e.g. `customer.created`
   * @param {Object} body
   * @param {string} body.module - Owning module (`customer`, `marketing`, `support`)
   * @param {{entity: string, id: string}} [body.subject] - Subject of the event
   * @param {Object} [body.data] - Payload (callers must not include unmasked PII)
   * @param {*} [body.changes] - Changed paths / redacted diff
   * @param {Object} [ctx] - Operation context
   * @return {Object} The published envelope
   */
  publish(type, { module, subject = null, data = {}, changes = undefined }, ctx = {}) {
    const envelope = {
      id: `evt_${randomUUID()}`,
      type: `${this.prefix}.${type}`,
      specVersion: SPEC_VERSION,
      occurredAt: new Date().toISOString(),
      tenantId: ctx.tenantId || 'default',
      actor: ctx.actor || { type: 'system', id: 'system' },
      correlationId: ctx.correlationId || null,
      module,
      subject,
      data
    };
    if (changes !== undefined) envelope.changes = changes;

    this.eventEmitter.emit(envelope.type, envelope);
    if (this.notifying && module) {
      Promise.resolve()
        .then(() => this.notifying.notify(`${this.prefix}.${module}`, envelope))
        .catch((err) => this.logger?.warn?.('[DomainEventBus] notify failed', { type: envelope.type, error: err.message }));
    }
    return envelope;
  }

  /**
   * Subscribes to an event type (with or without the prefix).
   *
   * @param {string} type - e.g. `customer.created` or `cx.customer.created`
   * @param {function(Object): (void|Promise<void>)} handler - Receives the envelope
   * @return {function(): void} Unsubscribe function
   */
  on(type, handler) {
    const fullType = type.startsWith(`${this.prefix}.`) ? type : `${this.prefix}.${type}`;
    const wrapped = (envelope) => {
      try {
        const result = handler(envelope);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => this.handlerFailed_(fullType, err));
        }
      } catch (err) {
        this.handlerFailed_(fullType, err);
      }
    };
    this.eventEmitter.on(fullType, wrapped);
    const entry = { type: fullType, wrapped, handler };
    this.listeners_.push(entry);
    return () => this.remove_(entry);
  }

  /**
   * Removes a handler added with `on`.
   *
   * @param {string} type - Event type
   * @param {Function} handler - Original handler
   * @return {void}
   */
  off(type, handler) {
    const fullType = type.startsWith(`${this.prefix}.`) ? type : `${this.prefix}.${type}`;
    const entry = this.listeners_.find((l) => l.type === fullType && l.handler === handler);
    if (entry) this.remove_(entry);
  }

  /** @return {number} Handlers currently registered through the bus */
  listenerCount() {
    return this.listeners_.length;
  }

  /** Removes every handler registered through the bus. */
  close() {
    for (const entry of [...this.listeners_]) this.remove_(entry);
  }

  remove_(entry) {
    this.eventEmitter.removeListener(entry.type, entry.wrapped);
    this.listeners_ = this.listeners_.filter((l) => l !== entry);
  }

  handlerFailed_(type, err) {
    this.logger?.error?.('[DomainEventBus] handler failed', { type, error: err && err.message });
  }
}

module.exports = { DomainEventBus, SPEC_VERSION };
