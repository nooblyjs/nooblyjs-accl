/**
 * @fileoverview TemplateService (PRD MK-2).
 *
 * Templates hold per-locale content and declared variables. Content is
 * checked on every save (syntax, undeclared variables, channel fields) and
 * HTML is sanitised. Content changes bump `revision` and send an approved
 * template back to draft, so nothing unapproved goes out. Only approved
 * templates can be sent (test sends excepted).
 *
 * @author NooblyJS Team
 * @since 0.3.0
 */

'use strict';

const { validationError, conflict, notFound } = require('../../shared/errors');
const { actorId } = require('../../shared/context');
const renderer = require('../templating/renderer');

const CONTENT_FIELDS = ['locales', 'variables', 'channel'];

class TemplateService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Marketing repositories
   */
  constructor({ repos }) {
    this.repos = repos;
    this.repo = repos.template;
  }

  /**
   * @param {Object} input - Template fields
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented template (status draft, revision 1)
   */
  async create(input, ctx) {
    const clean = this.prepare_(input || {}, null);
    return this.repo.create(clean, ctx, { system: { status: 'draft', revision: 1 } });
  }

  /**
   * @param {string} id - Template id
   * @param {Object} patch - Merge patch (arrays replace)
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented template
   */
  async update(id, patch, ctx, { expectedVersion } = {}) {
    const current = await this.repo.get(id, ctx);
    if (current.status === 'retired') throw conflict('Retired templates cannot be edited');
    if (patch && patch.key !== undefined && patch.key !== current.key) {
      throw validationError('The key of a template cannot change', [{ path: 'key', message: 'is immutable' }]);
    }
    const clean = this.prepare_(patch || {}, current);
    const contentChanged = CONTENT_FIELDS.some((f) => clean[f] !== undefined && JSON.stringify(clean[f]) !== JSON.stringify(current[f]));
    const system = contentChanged ? { revision: (current.revision || 1) + 1, status: 'draft', approvedBy: null, approvedAt: null } : {};
    return this.repo.update(id, clean, ctx, { expectedVersion, system });
  }

  /** Approves a draft for sending. */
  async approve(id, ctx) {
    const current = await this.repo.get(id, ctx);
    if (current.status === 'retired') throw conflict('Retired templates cannot be approved');
    if (current.status === 'approved') return current;
    this.prepare_(current, current, { strict: true });
    return this.repo.update(id, {}, ctx, { system: { status: 'approved', approvedBy: actorId(ctx), approvedAt: new Date().toISOString() } });
  }

  /** Retires a template (no new sends; history keeps referring to it). */
  async retire(id, ctx) {
    await this.repo.get(id, ctx);
    return this.repo.update(id, {}, ctx, { system: { status: 'retired' } });
  }

  /**
   * Resolves a template by id or key.
   *
   * @param {string} idOrKey - Id or key
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Template
   * @throws {ClientError} 404
   */
  async resolve(idOrKey, ctx) {
    const byId = await this.repo.find(idOrKey, ctx);
    if (byId) return byId;
    const [byKey] = await this.repo.findByIndex('key', String(idOrKey || '').toLowerCase(), ctx);
    if (!byKey) throw notFound('template', idOrKey);
    return byKey;
  }

  /**
   * Picks the locale variant: exact, then language, then default, then first.
   *
   * @param {Object} template - Template
   * @param {string} [locale] - Wanted locale
   * @return {Object} Locale variant
   */
  localeFor(template, locale) {
    const list = template.locales || [];
    const want = String(locale || '').toLowerCase();
    return list.find((l) => l.locale.toLowerCase() === want)
      || list.find((l) => want && l.locale.toLowerCase().split('-')[0] === want.split('-')[0])
      || list.find((l) => l.locale === template.defaultLocale)
      || list[0];
  }

  /**
   * Renders a template for a context (no tracking, no side effects).
   *
   * @param {Object} template - Template
   * @param {Object} context - Render context (`customer`, data roots, …)
   * @param {string} [locale] - Wanted locale
   * @return {{locale: string, subject: string, bodyHtml: string, bodyText: string}} Rendered parts
   */
  renderParts(template, context, locale) {
    const variant = this.localeFor(template, locale);
    if (!variant) throw validationError('Template has no content');
    if (template.channel === 'sms') {
      return { locale: variant.locale, subject: '', bodyHtml: '', bodyText: renderer.render(variant.smsText || variant.bodyText || '', context) };
    }
    return {
      locale: variant.locale,
      subject: renderer.render(variant.subject || '', context).replace(/[\r\n]+/g, ' ').trim(),
      bodyHtml: variant.bodyHtml ? renderer.render(variant.bodyHtml, context, { html: true }) : '',
      bodyText: variant.bodyText ? renderer.render(variant.bodyText, context) : ''
    };
  }

  /**
   * Validates content and sanitises HTML.
   *
   * @param {Object} input - Input or patch
   * @param {?Object} current - Current template (update)
   * @param {Object} [opts] - `{ strict }` also requires channel content (approval)
   * @return {Object} Cleaned input
   */
  prepare_(input, current, { strict = false } = {}) {
    const out = { ...input };
    const channel = out.channel || (current && current.channel);
    const variables = out.variables !== undefined ? out.variables : (current && current.variables) || [];
    const locales = out.locales !== undefined ? out.locales : (current && current.locales);
    if (Array.isArray(locales)) {
      const errors = [];
      const seen = new Set();
      locales.forEach((l, i) => {
        if (!l || typeof l !== 'object') return;
        if (seen.has(String(l.locale).toLowerCase())) errors.push({ path: `locales[${i}].locale`, message: 'is duplicated' });
        seen.add(String(l.locale).toLowerCase());
        if (channel === 'email' && !l.subject && (strict || out.locales !== undefined)) errors.push({ path: `locales[${i}].subject`, message: 'is required for email' });
        if (channel === 'email' && !l.bodyHtml && !l.bodyText && (strict || out.locales !== undefined)) errors.push({ path: `locales[${i}].bodyHtml`, message: 'email needs bodyHtml or bodyText' });
        if (channel === 'sms' && !l.smsText && (strict || out.locales !== undefined)) errors.push({ path: `locales[${i}].smsText`, message: 'is required for sms' });
        try {
          renderer.checkReferences({ subject: l.subject, preheader: l.preheader, bodyHtml: l.bodyHtml, bodyText: l.bodyText, smsText: l.smsText }, variables || []);
        } catch (err) {
          for (const d of err.details || []) errors.push({ path: `locales[${i}].${d.path}`, message: d.message });
        }
      });
      if (locales.length === 0) errors.push({ path: 'locales', message: 'needs at least one locale' });
      if (errors.length) throw validationError(`Invalid template content: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`, errors);
      if (out.locales !== undefined) out.locales = locales.map((l) => (l && l.bodyHtml ? { ...l, bodyHtml: renderer.sanitizeHtml(l.bodyHtml) } : l));
    }
    return out;
  }
}

module.exports = { TemplateService };
