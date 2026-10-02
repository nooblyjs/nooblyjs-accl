/**
 * @fileoverview Marketing-domain schemas (Architecture §5.3): Template,
 * Campaign, Message, Communication, EngagementEvent, TrackingLink,
 * Suppression, Topic.
 *
 * Template content has its own `revision` counter; the envelope `version`
 * stays the optimistic-concurrency counter.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { defineSchema } = require('../../shared/schema');

const CHANNELS = Object.freeze(['email', 'sms']);
const TEMPLATE_STATUSES = Object.freeze(['draft', 'approved', 'retired']);
const TEMPLATE_CATEGORIES = Object.freeze(['marketing', 'transactional', 'service']);
const CAMPAIGN_STATUSES = Object.freeze(['draft', 'running', 'paused', 'completed', 'archived']);
const CAMPAIGN_OBJECTIVES = Object.freeze(['awareness', 'acquisition', 'activation', 'retention', 'winback', 'service']);
const CAMPAIGN_TYPES = Object.freeze(['one_off', 'recurring', 'triggered']);
const MESSAGE_STATUSES = Object.freeze(['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled']);
const PURPOSES = Object.freeze(['marketing', 'transactional', 'service']);
const COMMUNICATION_STATUSES = Object.freeze(['queued', 'deferred', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'suppressed', 'skipped']);
const SKIP_REASONS = Object.freeze([
  'no_consent', 'opted_out', 'consent_pending', 'suppressed', 'frequency_cap', 'invalid_address', 'customer_blocked',
  'customer_merged', 'customer_erased', 'customer_missing', 'cancelled', 'render_failed'
]);
const ENGAGEMENT_TYPES = Object.freeze(['delivered', 'open', 'click', 'reply', 'unsubscribe', 'complaint', 'bounce_soft', 'bounce_hard']);
const SUPPRESSION_SCOPES = Object.freeze(['global', 'channel', 'topic']);
const SUPPRESSION_REASONS = Object.freeze(['unsubscribe', 'hard_bounce', 'complaint', 'manual', 'erasure', 'legal']);
const KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const template = defineSchema({
  name: 'template',
  description: 'Message content per channel, with locale variants and declared variables',
  fields: {
    key: { type: 'string', required: true, lowercase: true, pattern: KEY_RE, description: 'Stable key used by sendTransactional, e.g. order-confirmation' },
    name: { type: 'string', required: true, maxLength: 200 },
    channel: { type: 'enum', values: CHANNELS, required: true },
    category: { type: 'enum', values: TEMPLATE_CATEGORIES, default: 'marketing' },
    status: { type: 'enum', values: TEMPLATE_STATUSES, readOnly: true, description: 'Changed through :approve / :retire' },
    revision: { type: 'integer', readOnly: true, description: 'Increments when content changes' },
    defaultLocale: { type: 'string', maxLength: 35, default: 'en' },
    locales: {
      type: 'array',
      required: true,
      maxItems: 20,
      items: {
        type: 'object',
        fields: {
          locale: { type: 'string', required: true, maxLength: 35 },
          subject: { type: 'string', maxLength: 300 },
          preheader: { type: 'string', maxLength: 300 },
          bodyHtml: { type: 'string', maxLength: 200000, trim: false },
          bodyText: { type: 'string', maxLength: 100000, trim: false },
          smsText: { type: 'string', maxLength: 1600, trim: false }
        }
      }
    },
    variables: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true, pattern: VARIABLE_RE },
          type: { type: 'enum', values: ['string', 'number', 'boolean', 'date', 'url', 'json'], default: 'string' },
          required: { type: 'boolean', default: false },
          sample: { type: 'json' }
        }
      }
    },
    approvedBy: { type: 'string', readOnly: true },
    approvedAt: { type: 'datetime', readOnly: true }
  },
  indexes: [{ name: 'key', fields: ['key'], unique: true }, { name: 'status', fields: ['status'] }],
  search: ['key', 'name']
});

const campaign = defineSchema({
  name: 'campaign',
  description: 'A marketing programme grouping messages',
  numberPrefix: 'CMP',
  fields: {
    name: { type: 'string', required: true, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    objective: { type: 'enum', values: CAMPAIGN_OBJECTIVES, default: 'retention' },
    type: { type: 'enum', values: CAMPAIGN_TYPES, default: 'one_off' },
    status: { type: 'enum', values: CAMPAIGN_STATUSES, readOnly: true },
    ownerUserId: { type: 'ref' },
    startAt: { type: 'datetime' },
    endAt: { type: 'datetime' },
    budget: { type: 'object', fields: { amount: { type: 'number', min: 0 }, currency: { type: 'string', maxLength: 3, uppercase: true } } },
    utm: {
      type: 'object',
      fields: {
        source: { type: 'string', maxLength: 100 },
        medium: { type: 'string', maxLength: 100 },
        campaign: { type: 'string', maxLength: 100 },
        content: { type: 'string', maxLength: 100 }
      }
    },
    goal: { type: 'object', fields: { metric: { type: 'string', maxLength: 50 }, target: { type: 'number' } } },
    topicId: { type: 'string', maxLength: 64, description: 'Subscription topic key' }
  },
  indexes: [{ name: 'status', fields: ['status'] }],
  search: ['number', 'name']
});

const filterSpec = {
  type: 'object',
  fields: {
    field: { type: 'string', required: true, maxLength: 100 },
    op: { type: 'enum', values: ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'prefix', 'exists'], default: 'eq' },
    value: { type: 'json' }
  }
};

const message = defineSchema({
  name: 'message',
  description: 'A send definition: template, audience, schedule and throttle',
  numberPrefix: 'MSG',
  fields: {
    campaignId: { type: 'ref', required: true },
    name: { type: 'string', required: true, maxLength: 200 },
    channel: { type: 'enum', values: CHANNELS, required: true },
    purpose: { type: 'enum', values: ['marketing', 'service'], default: 'marketing' },
    templateId: { type: 'ref', required: true },
    topicId: { type: 'string', maxLength: 64, description: 'Defaults to the campaign topic' },
    audience: {
      type: 'object',
      required: true,
      fields: {
        customerIds: { type: 'array', maxItems: 10000, items: { type: 'string', maxLength: 64 } },
        excludeCustomerIds: { type: 'array', maxItems: 10000, items: { type: 'string', maxLength: 64 } },
        rule: { type: 'object', fields: { filters: { type: 'array', maxItems: 20, items: filterSpec } } }
      }
    },
    schedule: {
      type: 'object',
      fields: {
        type: { type: 'enum', values: ['immediate', 'at', 'recurring'], default: 'immediate' },
        at: { type: 'datetime' },
        cron: { type: 'string', maxLength: 100, description: '5-field cron, evaluated in server time' }
      }
    },
    throttle: { type: 'object', fields: { perMinute: { type: 'integer', min: 1, max: 100000 } } },
    respectQuietHours: { type: 'boolean', default: true },
    respectFrequencyCap: { type: 'boolean', default: true },
    from: { type: 'object', fields: { address: { type: 'string', maxLength: 254 }, name: { type: 'string', maxLength: 100 } } },
    replyTo: { type: 'string', maxLength: 254 },
    status: { type: 'enum', values: MESSAGE_STATUSES, readOnly: true },
    nextRunAt: { type: 'datetime', readOnly: true },
    lastRunAt: { type: 'datetime', readOnly: true },
    runCount: { type: 'integer', readOnly: true },
    currentRunId: { type: 'string', readOnly: true }
  },
  indexes: [{ name: 'campaign', fields: ['campaignId'] }, { name: 'status', fields: ['status'] }],
  search: ['number', 'name']
});

const communication = defineSchema({
  name: 'communication',
  description: 'One message to one recipient: the "communications sent" record',
  parentField: 'customerId',
  fields: {
    customerId: { type: 'ref', description: 'Recipient; absent only for test sends to a raw address' },
    channel: { type: 'enum', values: CHANNELS, required: true },
    purpose: { type: 'enum', values: PURPOSES, required: true },
    topicId: { type: 'string', maxLength: 64 },
    origin: {
      type: 'object',
      required: true,
      fields: {
        type: { type: 'enum', values: ['campaign', 'transactional', 'test'], required: true },
        campaignId: { type: 'ref' },
        messageId: { type: 'ref' },
        runId: { type: 'string', maxLength: 64 }
      }
    },
    idempotencyKey: { type: 'string', required: true, maxLength: 300 },
    to: { type: 'string', maxLength: 254, pii: true },
    from: { type: 'object', fields: { address: { type: 'string', maxLength: 254 }, name: { type: 'string', maxLength: 100 } } },
    templateId: { type: 'ref' },
    templateRevision: { type: 'integer' },
    locale: { type: 'string', maxLength: 35 },
    data: { type: 'json', pii: true, description: 'Transactional payload' },
    rendered: {
      type: 'object',
      pii: true,
      fields: {
        subject: { type: 'string', maxLength: 300 },
        bodyHtml: { type: 'string', maxLength: 300000, trim: false },
        bodyText: { type: 'string', maxLength: 150000, trim: false }
      }
    },
    status: { type: 'enum', values: COMMUNICATION_STATUSES, required: true },
    skipReason: { type: 'enum', values: SKIP_REASONS },
    deferUntil: { type: 'datetime' },
    deferReason: { type: 'string', maxLength: 50 },
    attempts: { type: 'integer', default: 0 },
    provider: { type: 'string', maxLength: 50 },
    providerMessageId: { type: 'string', maxLength: 200 },
    error: { type: 'string', maxLength: 300 },
    queuedAt: { type: 'datetime' },
    sentAt: { type: 'datetime' },
    deliveredAt: { type: 'datetime' },
    firstOpenedAt: { type: 'datetime' },
    firstClickedAt: { type: 'datetime' },
    openCount: { type: 'integer', default: 0 },
    clickCount: { type: 'integer', default: 0 },
    unsubscribedAt: { type: 'datetime' }
  },
  indexes: [
    { name: 'idempotency', fields: ['idempotencyKey'], unique: true },
    { name: 'customer', fields: ['customerId'] },
    { name: 'message', fields: ['origin.messageId'] },
    { name: 'status', fields: ['status'] },
    { name: 'provider', fields: ['providerMessageId'] }
  ]
});

const engagement = defineSchema({
  name: 'engagement',
  description: 'Append-only engagement event on a communication',
  appendOnly: true,
  parentField: 'customerId',
  fields: {
    communicationId: { type: 'ref', required: true },
    customerId: { type: 'ref', required: true },
    messageId: { type: 'ref' },
    type: { type: 'enum', values: ENGAGEMENT_TYPES, required: true },
    url: { type: 'string', maxLength: 2000 },
    linkId: { type: 'ref' },
    occurredAt: { type: 'datetime', required: true },
    ipHash: { type: 'string', maxLength: 64 },
    userAgent: { type: 'string', maxLength: 300 },
    isMachineOpen: { type: 'boolean' },
    provider: { type: 'string', maxLength: 50 }
  },
  indexes: [{ name: 'communication', fields: ['communicationId'] }, { name: 'customer', fields: ['customerId'] }, { name: 'message', fields: ['messageId'] }]
});

const trackingLink = defineSchema({
  name: 'trackingLink',
  description: 'A registered click destination (no open redirects)',
  fields: {
    communicationId: { type: 'ref', required: true },
    targetUrl: { type: 'string', required: true, maxLength: 2000, trim: false },
    position: { type: 'integer' }
  },
  indexes: [{ name: 'communication', fields: ['communicationId'] }]
});

const suppression = defineSchema({
  name: 'suppression',
  description: 'An address that must not be contacted (globally, on a channel, or for a topic)',
  fields: {
    scope: { type: 'enum', values: SUPPRESSION_SCOPES, required: true },
    channel: { type: 'enum', values: CHANNELS },
    topicId: { type: 'string', maxLength: 64 },
    value: { type: 'string', required: true, maxLength: 254, pii: true, description: 'Email address or E.164 number' },
    reason: { type: 'enum', values: SUPPRESSION_REASONS, required: true },
    source: { type: 'string', maxLength: 100 },
    note: { type: 'string', maxLength: 500 },
    expiresAt: { type: 'datetime' },
    key: { type: 'string', readOnly: true, description: 'scope|channel|topic|value' }
  },
  indexes: [{ name: 'key', fields: ['key'], unique: true }, { name: 'value', fields: ['value'] }],
  search: ['value']
});

const topic = defineSchema({
  name: 'topic',
  description: 'A subscription topic (newsletter, offers, product news)',
  fields: {
    key: { type: 'string', required: true, lowercase: true, pattern: KEY_RE },
    name: { type: 'string', required: true, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    channel: { type: 'enum', values: CHANNELS },
    public: { type: 'boolean', default: true }
  },
  indexes: [{ name: 'key', fields: ['key'], unique: true }]
});

module.exports = {
  template, campaign, message, communication, engagement, trackingLink, suppression, topic,
  CHANNELS, TEMPLATE_STATUSES, TEMPLATE_CATEGORIES, CAMPAIGN_STATUSES, CAMPAIGN_OBJECTIVES, CAMPAIGN_TYPES,
  MESSAGE_STATUSES, PURPOSES, COMMUNICATION_STATUSES, SKIP_REASONS, ENGAGEMENT_TYPES, SUPPRESSION_SCOPES,
  SUPPRESSION_REASONS, VARIABLE_RE
};
