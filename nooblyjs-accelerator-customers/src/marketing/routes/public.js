/**
 * @fileoverview Public marketing routes (`{basePath}/marketing/p`).
 *
 *   GET  /o/{token}.gif   open pixel (always returns the pixel)
 *   GET  /c/{token}       click → 302 to the registered destination
 *   GET  /u/{token}       unsubscribe confirmation page
 *   POST /u/{token}       unsubscribe (form submit or RFC 8058 one-click)
 *   POST /webhooks/{adapter}?tenant=…   provider events (signature required)
 *
 * No session or API key: every request is authenticated by a signed token or
 * a webhook signature, and responses never reveal whether an id exists.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const express = require('express');
const { asyncHandler } = require('../../shared/http');
const { PIXEL } = require('../tracking');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const TENANT_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * @param {Object} params
 * @param {Object} params.router - Public router
 * @param {Object} params.signer - TokenSigner
 * @param {Object} params.communications - CommunicationService
 * @param {Object<string, Object>} params.adapters - Adapters by name
 * @param {string} params.assetBase - Path of the shared UI assets (`{basePath}/_cx`)
 * @param {Object} [params.logger] - Logger
 * @return {void}
 */
function registerPublicRoutes({ router, signer, communications, adapters, assetBase, logger }) {
  const client = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

  router.get('/o/:token', asyncHandler(async (req, res) => {
    const payload = signer.verify(req.params.token.replace(/\.gif$/, ''), 'o');
    if (payload) await communications.recordOpen(payload, client(req)).catch((err) => logger?.warn?.('[accel-customers] open failed', { error: err.message }));
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0', 'Content-Length': PIXEL.length });
    res.end(PIXEL);
  }));

  router.get('/c/:token', asyncHandler(async (req, res) => {
    const payload = signer.verify(req.params.token, 'c');
    const target = payload ? await communications.recordClick(payload, client(req)) : null;
    if (!target || !/^https?:\/\//i.test(target)) {
      return res.status(404).type('html').send(page(assetBase, 'Link not found', 'This link is invalid or has expired.'));
    }
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, target);
  }));

  router.get('/u/:token', (req, res) => {
    if (!signer.verify(req.params.token, 'u')) {
      return res.status(404).type('html').send(page(assetBase, 'Link not found', 'This unsubscribe link is invalid.'));
    }
    return res.type('html').send(page(assetBase, 'Unsubscribe', 'Click below to stop receiving these messages.',
      `<form method="post"><button type="submit" class="btn btn-primary">Unsubscribe</button></form>`));
  });

  router.post('/u/:token', express.urlencoded({ extended: false, limit: '2kb' }), asyncHandler(async (req, res) => {
    const payload = signer.verify(req.params.token, 'u');
    const result = payload ? await communications.unsubscribe(payload, client(req)) : null;
    if (!result) return res.status(404).type('html').send(page(assetBase, 'Link not found', 'This unsubscribe link is invalid.'));
    // RFC 8058 one-click: mail clients POST "List-Unsubscribe=One-Click" and only need a 2xx
    if (req.body && req.body['List-Unsubscribe'] === 'One-Click') return res.status(200).type('text').send('Unsubscribed');
    const what = result.topicId ? `the “${result.topicId}” ${result.channel} messages` : `marketing ${result.channel} messages`;
    return res.type('html').send(page(assetBase, 'You are unsubscribed', `You will no longer receive ${what}.`));
  }));

  router.post('/webhooks/:adapter', express.json({
    limit: '1mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); }
  }), asyncHandler(async (req, res) => {
    const adapter = adapters[req.params.adapter];
    if (!adapter) return res.status(404).json({ error: { code: 'not_found', message: 'Unknown adapter', details: [] } });
    if (!adapter.verifySignature(req)) return res.status(401).json({ error: { code: 'invalid_signature', message: 'Invalid signature', details: [] } });
    const tenantId = typeof req.query.tenant === 'string' && TENANT_RE.test(req.query.tenant) ? req.query.tenant : 'default';
    let processed = 0;
    for (const event of adapter.parseWebhook(req)) {
      if (await communications.applyWebhookEvent(adapter.name, event, tenantId)) processed++;
    }
    return res.json({ processed });
  }));
}

function page(assetBase, title, text, extra = '') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="${esc(assetBase)}/css/styles.css" rel="stylesheet"><link href="${esc(assetBase)}/css/accelerator.css" rel="stylesheet">
</head><body><main class="container py-5 cx-narrow"><div class="card"><div class="card-body p-4">
<h1 class="h3 mb-3">${esc(title)}</h1><p class="mb-3">${esc(text)}</p>${extra}</div></div></main></body></html>`;
}

module.exports = { registerPublicRoutes };
