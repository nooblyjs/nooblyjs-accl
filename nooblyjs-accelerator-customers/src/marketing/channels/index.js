/**
 * @fileoverview Channel adapters (PRD MK-1).
 *
 * An adapter delivers one rendered message and interprets its provider's
 * webhooks. Hosts pass adapters per channel in `options.marketing.channels`;
 * the default is the console adapter for every channel.
 *
 *   class MyAdapter extends ChannelAdapter {
 *     async send(msg) { return { providerMessageId } }
 *     verifySignature(req) { return true }
 *     parseWebhook(req) { return [{ providerMessageId, type, occurredAt }] }
 *   }
 *
 * Webhook event types: delivered, bounce_hard, bounce_soft, complaint, open,
 * click, failed.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const crypto = require('crypto');

const WEBHOOK_TYPES = Object.freeze(['delivered', 'bounce_hard', 'bounce_soft', 'complaint', 'open', 'click', 'failed']);

class ChannelAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.name] - Adapter name (used in webhook URLs)
   * @param {string} [options.webhookSecret] - Shared secret for webhook signatures
   */
  constructor(options = {}) {
    this.name = options.name || 'adapter';
    this.webhookSecret = options.webhookSecret || null;
  }

  /**
   * Delivers a message.
   *
   * @param {Object} message - `{ channel, to, from, replyTo, subject, html, text, headers, communicationId }`
   * @return {Promise<{providerMessageId: string}>} Provider reference
   */
  // eslint-disable-next-line no-unused-vars
  async send(message) {
    throw new Error(`${this.constructor.name}.send() is not implemented`);
  }

  /**
   * Checks a webhook request's signature. Default: HMAC-SHA256 of the raw
   * JSON body in `X-CX-Signature: sha256=<hex>` with `webhookSecret`.
   *
   * @param {Object} req - Express request (with `rawBody` when available)
   * @return {boolean} Whether the request is authentic
   */
  verifySignature(req) {
    if (!this.webhookSecret) return false;
    const header = String(req.headers['x-cx-signature'] || '');
    const body = req.rawBody !== undefined ? req.rawBody : JSON.stringify(req.body || {});
    const expected = `sha256=${crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex')}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Maps a webhook request to events. Default format:
   * `{ events: [{ providerMessageId, type, occurredAt?, url?, error? }] }`.
   *
   * @param {Object} req - Express request
   * @return {Array<{providerMessageId: string, type: string, occurredAt: string, url?: string, error?: string}>} Events
   */
  parseWebhook(req) {
    const events = req.body && Array.isArray(req.body.events) ? req.body.events : [];
    return events
      .filter((e) => e && typeof e.providerMessageId === 'string' && WEBHOOK_TYPES.includes(e.type))
      .slice(0, 1000)
      .map((e) => ({
        providerMessageId: e.providerMessageId,
        type: e.type,
        occurredAt: e.occurredAt && !Number.isNaN(Date.parse(e.occurredAt)) ? new Date(e.occurredAt).toISOString() : new Date().toISOString(),
        url: typeof e.url === 'string' ? e.url.slice(0, 2000) : undefined,
        error: typeof e.error === 'string' ? e.error.slice(0, 300) : undefined
      }));
  }
}

/**
 * Development adapter: records messages in an in-memory outbox (newest last,
 * capped) instead of sending them, and logs a one-line summary without PII.
 */
class ConsoleAdapter extends ChannelAdapter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger (`info`)
   * @param {number} [options.outboxSize=1000] - Messages kept in `outbox`
   * @param {function(Object): boolean} [options.fail] - Return true to simulate a provider failure
   * @param {string} [options.webhookSecret] - Secret for simulated webhooks
   */
  constructor(options = {}) {
    super({ name: 'console', ...options });
    this.logger = options.logger || null;
    this.outboxSize = options.outboxSize || 1000;
    this.fail = options.fail || null;
    this.outbox = [];
    this.sequence = 0;
  }

  async send(message) {
    if (this.fail && this.fail(message)) {
      const err = new Error('Simulated provider failure');
      err.code = 'simulated_failure';
      throw err;
    }
    this.sequence += 1;
    const providerMessageId = `console-${Date.now().toString(36)}-${this.sequence}`;
    this.outbox.push({ ...message, providerMessageId, sentAt: new Date().toISOString() });
    if (this.outbox.length > this.outboxSize) this.outbox.splice(0, this.outbox.length - this.outboxSize);
    this.logger?.info?.(`[accel-customers] console ${message.channel} sent`, { communicationId: message.communicationId, providerMessageId });
    return { providerMessageId };
  }

  /** Empties the outbox (tests). */
  clear() {
    this.outbox = [];
  }
}

/**
 * Email over SMTP through a host-supplied transport with a nodemailer-style
 * `sendMail()` (e.g. `nodemailer.createTransport(...)`). The accelerator has
 * no SMTP dependency of its own.
 */
class SmtpAdapter extends ChannelAdapter {
  /**
   * @param {Object} options
   * @param {{sendMail: function(Object): Promise<{messageId: string}>}} options.transport - Mail transport
   * @param {string} [options.webhookSecret] - Secret for bounce/complaint webhooks
   */
  constructor(options = {}) {
    super({ name: 'smtp', ...options });
    if (!options.transport || typeof options.transport.sendMail !== 'function') {
      throw new Error('SmtpAdapter: a transport with sendMail() is required');
    }
    this.transport = options.transport;
  }

  async send(message) {
    if (message.channel !== 'email') throw new Error('SmtpAdapter only sends email');
    const from = message.from && message.from.address
      ? (message.from.name ? `"${message.from.name.replace(/"/g, '')}" <${message.from.address}>` : message.from.address)
      : undefined;
    const info = await this.transport.sendMail({
      from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers
    });
    return { providerMessageId: String((info && info.messageId) || '').replace(/^<|>$/g, '') || `smtp-${message.communicationId}` };
  }
}

/** Factories exposed as `customers.adapters`. */
const adapters = {
  console: (options) => new ConsoleAdapter(options),
  smtp: (options) => new SmtpAdapter(options)
};

module.exports = { ChannelAdapter, ConsoleAdapter, SmtpAdapter, adapters, WEBHOOK_TYPES };
