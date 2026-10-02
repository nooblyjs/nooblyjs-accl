/**
 * @fileoverview The marketing module (PRD §6.3, roadmap Phase 2).
 *
 * Templates, campaigns, messages, the send pipeline, communications sent,
 * engagement tracking, suppressions and topics, with a REST API at
 * `{basePath}/marketing/api/v1`, public tracking routes at
 * `{basePath}/marketing/p` and an admin UI at `{basePath}/marketing/`.
 *
 * Options (`options.marketing`):
 *   channels   { email: adapter, sms: adapter }          default: console adapters
 *   defaults   { from: { email: { address, name } },
 *                frequencyCap: { count, perDays },       default: off
 *                quietHours: { start: '21:00', end: '08:00', timezone } }  default: off
 *   tracking   { baseUrl: 'https://example.com', signingSecret }   absolute links in messages
 *   dispatch   { concurrency, pollMs, maxAttempts, retryDelayMs }
 *   scheduler  { tickMs }
 *   autoStart  false to run the dispatcher and scheduler manually (tests)
 *
 * In-process API (`cx.marketing`): sendTransactional, drain, tick, services,
 * schemas, channels.
 *
 * @author NooblyJS Team
 * @since 0.1.0
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const { createModule } = require('../shared/module');
const { BaseRepository } = require('../shared/repository');
const { systemContext } = require('../shared/context');
const schemas = require('./schemas');
const { ConsoleAdapter } = require('./channels');
const { TokenSigner, TrackingUrls } = require('./tracking');
const { TemplateService } = require('./services/templateService');
const { CampaignService } = require('./services/campaignService');
const { SuppressionService, TopicService } = require('./services/suppressionService');
const { CommunicationService } = require('./services/communicationService');
const { MessageService } = require('./services/messageService');
const { Dispatcher } = require('./pipeline/dispatcher');
const { MarketingScheduler } = require('./pipeline/scheduler');
const { registerRoutes } = require('./routes');
const { registerPublicRoutes } = require('./routes/public');
const { seedMarketing } = require('./seed');

const STATUS_VERBS = Object.freeze({
  sent: 'sent', delivered: 'delivered', bounced: 'bounced', failed: 'failed', suppressed: 'suppressed', skipped: 'skipped',
  queued: 'queued', deferred: 'deferred', sending: 'sending'
});

/**
 * Creates the marketing module and mounts its API, public routes and UI.
 *
 * @param {Object} params
 * @param {Object} params.app - Host Express app
 * @param {Object} params.shared - Shared mount context (see index.js)
 * @param {Object} params.modules - Modules created so far (needs `customer`)
 * @return {Object} Module
 */
module.exports = function createMarketingModule({ app, shared, modules }) {
  const scaffold = createModule({ name: 'marketing', app, shared, viewsDir: path.join(__dirname, 'views') });
  const options = shared.options.marketing || {};
  const customerOptions = shared.options.customer || {};
  const customer = modules.customer.services;
  const { core, logger } = shared;
  if (!core.queue) throw new Error('marketing: the core ServiceRegistry must provide queue()');

  const deps = shared.repositoryDeps('marketing');
  const repos = {};
  for (const key of ['template', 'campaign', 'message', 'communication', 'engagement', 'trackingLink', 'suppression', 'topic']) {
    repos[key] = new BaseRepository(schemas[key], deps);
  }

  // channels
  const channels = { ...(options.channels || {}) };
  for (const channel of schemas.CHANNELS) {
    if (!channels[channel]) channels[channel] = new ConsoleAdapter({ logger, webhookSecret: options.webhookSecret });
  }
  const adapters = {};
  for (const adapter of Object.values(channels)) adapters[adapter.name] = adapter;

  // tracking
  const tracking = options.tracking || {};
  let secret = tracking.signingSecret;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    logger?.warn?.('[accel-customers] marketing.tracking.signingSecret is not set: tracking and unsubscribe links stop working after a restart');
  }
  const signer = new TokenSigner(secret);
  const publicBaseUrl = `${String(tracking.baseUrl || '').replace(/\/$/, '')}${scaffold.publicBase}`;
  const trackingUrls = new TrackingUrls({ signer, publicBase: publicBaseUrl });
  if (!tracking.baseUrl) logger?.warn?.('[accel-customers] marketing.tracking.baseUrl is not set: links in messages are relative');

  // services
  const tenants = new Set(['default']);
  const queueName = `${shared.options.containerPrefix}.marketing.dispatch`;
  const templates = new TemplateService({ repos });
  const campaigns = new CampaignService({ repos, events: shared.events });
  const suppressions = new SuppressionService({ repos, options: customerOptions });
  const topics = new TopicService({ repos });
  const communications = new CommunicationService({
    repos, customer, suppressions, events: shared.events, queue: core.queue, queueName, tenants, ipSalt: secret, logger
  });
  const dispatcher = new Dispatcher({
    repos, customer, templates, suppressions, communications, channels, trackingUrls, queue: core.queue, queueName, options, logger
  });
  const messages = new MessageService({
    repos, customer, templates, campaigns, topics, communications, dispatcher, events: shared.events, tenants
  });
  const scheduler = new MarketingScheduler({
    repos, messages, communications, dataService: core.dataService, tenants, tickMs: (options.scheduler && options.scheduler.tickMs) || 5000, logger
  });
  const services = { templates, campaigns, suppressions, topics, communications, messages, dispatcher, scheduler, repos };

  registerRoutes({ router: scaffold.router, rbac: shared.rbac, services, customer, channels, openapi: scaffold.openapi });
  registerPublicRoutes({
    router: scaffold.publicRouter, signer, communications, adapters, assetBase: `${shared.options.basePath}/_cx`, logger
  });
  scaffold.finalize();

  // customer 360 timeline: communications and engagement
  const unregister = [
    modules.customer.api.registerTimelineProvider('communication', async (customerId, ctx) => {
      const comms = await repos.communication.findByIndex('customer', customerId, ctx);
      return comms.filter((c) => c.origin.type !== 'test').map((c) => ({
        id: `communication:${c.id}`,
        type: 'communication',
        at: c.sentAt || c.queuedAt || c.createdAt,
        title: `${c.channel === 'email' ? 'Email' : 'SMS'} ${STATUS_VERBS[c.status] || c.status}${c.rendered && c.rendered.subject ? `: ${c.rendered.subject}` : ''}`,
        summary: [c.purpose, c.skipReason ? `reason: ${c.skipReason.replace(/_/g, ' ')}` : null, c.firstOpenedAt ? 'opened' : null, c.firstClickedAt ? 'clicked' : null].filter(Boolean).join(' · '),
        actor: c.createdBy,
        ref: { entity: 'communication', id: c.id }
      }));
    }),
    modules.customer.api.registerTimelineProvider('engagement', async (customerId, ctx) => {
      const events = await repos.engagement.findByIndex('customer', customerId, ctx);
      return events.filter((e) => ['click', 'unsubscribe', 'complaint', 'bounce_hard'].includes(e.type)).map((e) => ({
        id: `engagement:${e.id}`,
        type: 'engagement',
        at: e.occurredAt,
        title: { click: 'Clicked a link', unsubscribe: 'Unsubscribed', complaint: 'Marked as spam', bounce_hard: 'Email bounced' }[e.type],
        summary: e.url ? e.url.slice(0, 200) : '',
        ref: { entity: 'communication', id: e.communicationId }
      }));
    })
  ];

  const sys = (ctx) => ctx || systemContext('marketing');
  const api = {
    services,
    schemas,
    channels,
    /** See MessageService#sendTransactional. Resolves with the communication. */
    sendTransactional: async (input, ctx) => (await messages.sendTransactional(input, sys(ctx))).communication,
    /** Processes everything queued (tests and scripts). */
    drain: () => dispatcher.drain(),
    /** Runs one scheduler tick (tests and scripts). */
    tick: (now) => scheduler.tick(now)
  };

  return {
    name: 'marketing',
    api,
    services,
    apiBase: scaffold.apiBase,
    uiBase: scaffold.uiBase,
    async init() {
      for (const repo of Object.values(repos)) await repo.init();
      const requeued = await scheduler.recover(shared.options.containerPrefix);
      if (requeued) logger?.info?.(`[accel-customers] re-queued ${requeued} communications`);
      if (shared.options.seed) await seedMarketing(services);
      if (options.autoStart !== false) {
        dispatcher.start();
        scheduler.start();
      }
    },
    async shutdown() {
      dispatcher.stop();
      scheduler.stop();
      unregister.forEach((fn) => fn());
    }
  };
};
