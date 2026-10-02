/**
 * @fileoverview Tracking (PRD MK-7, MK-13, MK-10 one-click unsubscribe).
 *
 * Public URLs never carry raw ids: they carry an HMAC-signed token
 * `base64url(payload).base64url(sig)`, where the payload names the token
 * kind, tenant and communication (and link). Click tokens resolve to a
 * stored TrackingLink, so the redirect target is always a URL that was in
 * the rendered message: there is no open redirect.
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const crypto = require('crypto');

const KINDS = Object.freeze({ open: 'o', click: 'c', unsubscribe: 'u' });
const SIG_BYTES = 16;

class TokenSigner {
  /**
   * @param {string} secret - HMAC secret (≥ 16 characters)
   */
  constructor(secret) {
    if (!secret || String(secret).length < 16) throw new Error('TokenSigner: secret must be at least 16 characters');
    this.secret = String(secret);
  }

  /**
   * @param {Object} payload - Small JSON payload
   * @return {string} Signed token
   */
  sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.mac_(body)}`;
  }

  /**
   * @param {string} token - Token from a URL
   * @param {string} [kind] - Expected `k` (o, c, u)
   * @return {?Object} Payload, or null when invalid, tampered, expired or of another kind
   */
  verify(token, kind) {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = this.mac_(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    if (kind && payload.k !== kind) return null;
    if (payload.x && Date.now() > payload.x) return null;
    return payload;
  }

  mac_(body) {
    return crypto.createHmac('sha256', this.secret).update(body).digest().subarray(0, SIG_BYTES).toString('base64url');
  }
}

/**
 * Builds the public tracking URLs for one communication.
 */
class TrackingUrls {
  /**
   * @param {Object} deps
   * @param {TokenSigner} deps.signer - Token signer
   * @param {string} deps.publicBase - Absolute base of the public routes, e.g. `https://example.com/applications/marketing/p`
   */
  constructor({ signer, publicBase }) {
    this.signer = signer;
    this.publicBase = publicBase.replace(/\/$/, '');
  }

  open(tenantId, communicationId) {
    return `${this.publicBase}/o/${this.signer.sign({ k: KINDS.open, n: tenantId, c: communicationId })}.gif`;
  }

  click(tenantId, communicationId, linkId) {
    return `${this.publicBase}/c/${this.signer.sign({ k: KINDS.click, n: tenantId, c: communicationId, l: linkId })}`;
  }

  unsubscribe(tenantId, communicationId) {
    return `${this.publicBase}/u/${this.signer.sign({ k: KINDS.unsubscribe, n: tenantId, c: communicationId })}`;
  }
}

/**
 * Appends UTM parameters that the URL does not already carry.
 *
 * @param {string} url - Absolute http(s) URL
 * @param {Object} [utm] - `{ source, medium, campaign, content }`
 * @return {string} URL with utm_* parameters
 */
function withUtm(url, utm) {
  if (!utm) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const [k, v] of Object.entries(utm)) {
    if (v && !parsed.searchParams.has(`utm_${k}`)) parsed.searchParams.set(`utm_${k}`, v);
  }
  return parsed.toString();
}

/** http(s) URLs in plain text (SMS / text bodies). */
const TEXT_URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;
/** href="http(s)://…" attributes in HTML. */
const HREF_RE = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi;

/**
 * Replaces http(s) links with tracking links. `register(url, position)`
 * stores the destination and returns its tracking URL. Links to the
 * public tracking base (unsubscribe) are left alone.
 *
 * @param {Object} rendered - `{ bodyHtml?, bodyText? }`
 * @param {Object} opts
 * @param {function(string, number): Promise<string>} opts.register - Destination → tracking URL
 * @param {string} opts.skipPrefix - URLs starting with this are not rewritten
 * @param {Object} [opts.utm] - UTM defaults
 * @return {Promise<Object>} Rewritten copy
 */
async function rewriteLinks(rendered, { register, skipPrefix, utm }) {
  const cache = new Map();
  let position = 0;
  const track = async (url) => {
    const decoded = url.replace(/&amp;/g, '&');
    if (skipPrefix && decoded.startsWith(skipPrefix)) return url;
    const target = withUtm(decoded, utm);
    if (!cache.has(target)) cache.set(target, await register(target, position++));
    return cache.get(target);
  };
  const replaceAsync = async (text, re, fn) => {
    const matches = [...text.matchAll(re)];
    let out = '';
    let last = 0;
    for (const m of matches) {
      out += text.slice(last, m.index) + await fn(...m);
      last = m.index + m[0].length;
    }
    return out + text.slice(last);
  };
  const out = { ...rendered };
  if (out.bodyHtml) {
    out.bodyHtml = await replaceAsync(out.bodyHtml, HREF_RE, async (all, prefix, quote, url) => `${prefix}${quote}${(await track(url)).replace(/&/g, '&amp;')}${quote}`);
  }
  if (out.bodyText) out.bodyText = await replaceAsync(out.bodyText, TEXT_URL_RE, (url) => track(url));
  return out;
}

/**
 * Adds a 1×1 open pixel before `</body>` (or at the end).
 *
 * @param {string} html - Rendered HTML
 * @param {string} pixelUrl - Open-tracking URL
 * @return {string} HTML with pixel
 */
function addOpenPixel(html, pixelUrl) {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : `${html}${img}`;
}

/**
 * One-way hash of an IP address for engagement records (no raw IPs stored).
 *
 * @param {string} ip - Client IP
 * @param {string} secret - Salt
 * @return {?string} Hex hash prefix
 */
function hashIp(ip, secret) {
  if (!ip) return null;
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 32);
}

/**
 * Heuristic for machine (privacy-proxy) opens, e.g. Apple Mail Privacy
 * Protection and Gmail image proxy fetches.
 *
 * @param {string} userAgent - Request User-Agent
 * @return {boolean} Whether the open is likely automated
 */
function isMachineOpen(userAgent) {
  const ua = String(userAgent || '');
  return /GoogleImageProxy|YahooMailProxy|Mozilla\/5\.0$|^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\)$/.test(ua);
}

/** 43-byte transparent GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

module.exports = { TokenSigner, TrackingUrls, KINDS, withUtm, rewriteLinks, addOpenPixel, hashIp, isMachineOpen, PIXEL };
