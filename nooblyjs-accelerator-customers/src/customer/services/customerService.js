/**
 * @fileoverview CustomerService (PRD CU-1, CU-6, CU-7, scenario 1).
 *
 * Customers are created with optional nested contact points, identities and
 * consents. Status changes go through `setStatus()` (a small state machine);
 * lifecycle stage is a plain field. `upsertByIdentity()` is the integration
 * entry point for other accelerators (e.g. commerce checkout).
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const KeyedMutex = require('../../shared/repository/mutex');
const { normaliseLocaleFields, normaliseEmail, normalisePhone } = require('../../shared/reference/normalise');
const { validationError, conflict, badRequest } = require('../../shared/errors');
const { getPath, validate } = require('../../shared/schema');
const { readAs, loadParty } = require('./support');

/** Allowed status transitions via setStatus(). `merged` / `erased` come from merge and DSAR (Phase 5). */
const STATUS_TRANSITIONS = Object.freeze({
  active: ['inactive', 'blocked'],
  inactive: ['active', 'blocked'],
  blocked: ['active', 'inactive'],
  merged: [],
  erased: []
});

const EXPANDABLE = Object.freeze(['addresses', 'phones', 'emails', 'identities', 'consentState', 'organization', 'notes']);
const NESTED = Object.freeze(['emails', 'phones', 'addresses', 'identities', 'consents', 'email', 'phone']);
const NAME_PARTS = ['prefix', 'given', 'middle', 'family', 'suffix'];

class CustomerService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories
   * @param {Object} deps.contactPoints - `{ address, phone, email }` ContactPointServices
   * @param {Object} deps.identities - IdentityService
   * @param {Object} deps.consents - ConsentService
   * @param {Object} deps.notes - NoteService
   * @param {Object} deps.events - DomainEventBus
   * @param {Object} [deps.options] - `{ defaultCountry }`
   */
  constructor({ repos, contactPoints, identities, consents, notes, events, options = {} }) {
    this.repos = repos;
    this.repo = repos.customer;
    this.contactPoints = contactPoints;
    this.identities = identities;
    this.consents = consents;
    this.notes = notes;
    this.events = events;
    this.defaultCountry = options.defaultCountry || null;
    this.mutex = new KeyedMutex();
  }

  // ---- CRUD ---------------------------------------------------------------

  /**
   * Creates a customer, optionally with nested `emails`, `phones`,
   * `addresses`, `identities` and `consents` (and `email` / `phone`
   * shorthands). Nested items are validated before anything is written; if a
   * write still fails, everything created so far is removed.
   *
   * @param {Object} input - Customer fields plus nested collections
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented customer, expanded with what was created
   * @throws {ClientError} 404 organization, 409 identity conflict, 422 invalid
   */
  async create(input, ctx) {
    const { profile, nested } = this.split_(input);
    const prepared = await this.prepareProfile_(profile, null, ctx);
    const plan = await this.planNested_(nested, ctx, null);
    const customer = await this.repo.create(prepared, ctx, { system: { status: 'active' } });
    try {
      await this.applyNested_(customer.id, plan, ctx);
    } catch (err) {
      await this.rollback_(customer.id, ctx);
      throw err;
    }
    return this.get(customer.id, ctx, { expand: plan.expand });
  }

  /**
   * Returns a customer, optionally expanded.
   *
   * @param {string} id - Customer id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts]
   * @param {string[]} [opts.expand] - Any of EXPANDABLE
   * @param {string[]} [opts.fields] - Sparse fieldset
   * @return {Promise<Object>} Presented customer
   */
  async get(id, ctx, { expand = [], fields } = {}) {
    const customer = await this.repo.get(id, ctx, { fields });
    return this.expand_(customer, expand, ctx);
  }

  /**
   * Lists customers. `query.q` narrows to typeahead matches (name, email,
   * phone, identity, number).
   *
   * @param {Object} query - Parsed list query (see shared/http parseListQuery)
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Page `{ items, total, limit, offset, nextCursor }`
   */
  async list(query, ctx) {
    this.checkExpand_(query.expand);
    let q = query;
    if (query.q) {
      const ids = (await this.typeahead(query.q, readAs(ctx), { limit: 500 })).map((c) => c.id);
      q = { ...query, filters: [...(query.filters || []), { field: 'id', op: 'in', value: ids.length ? ids : ['-'] }] };
    }
    const page = await this.repo.list(q, ctx);
    if (query.expand && query.expand.length) {
      page.items = await Promise.all(page.items.map((c) => this.expand_(c, query.expand, ctx)));
    }
    return page;
  }

  /**
   * Updates profile fields (merge patch). Contact points, identities and
   * consents have their own endpoints.
   *
   * @param {string} id - Customer id
   * @param {Object} patch - Merge patch
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented customer
   */
  async update(id, patch, ctx, { expectedVersion } = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw validationError('customer must be a JSON object');
    }
    for (const key of NESTED) {
      if (patch[key] !== undefined) {
        throw validationError(`'${key}' cannot be changed here; use the customer's ${key} endpoint`, [{ path: key, message: 'use the sub-resource endpoint' }]);
      }
    }
    if (patch.status !== undefined) {
      throw validationError('Use the :status action to change status', [{ path: 'status', message: 'use the :status action' }]);
    }
    const current = await this.repo.get(id, readAs(ctx));
    const prepared = await this.prepareProfile_(patch, current, ctx);
    return this.repo.update(id, prepared, ctx, { expectedVersion });
  }

  /**
   * Changes status along STATUS_TRANSITIONS and emits `customer.status.changed`.
   *
   * @param {string} id - Customer id
   * @param {string} status - Target status
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ reason, expectedVersion }`
   * @return {Promise<Object>} Presented customer
   * @throws {ClientError} 409 when the transition is not allowed
   */
  async setStatus(id, status, ctx, { reason, expectedVersion } = {}) {
    const current = await this.repo.get(id, readAs(ctx));
    if (!Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, status)) {
      throw validationError(`Unknown status '${status}'`, [{ path: 'status', message: `must be one of ${Object.keys(STATUS_TRANSITIONS).join(', ')}` }]);
    }
    if (current.status === status) return this.repo.get(id, ctx);
    if (!STATUS_TRANSITIONS[current.status].includes(status)) {
      throw conflict(`Cannot change status from ${current.status} to ${status}`, { from: current.status, to: status });
    }
    const updated = await this.repo.update(id, {}, ctx, { expectedVersion, system: { status } });
    this.events?.publish('customer.status.changed', {
      module: 'customer',
      subject: { entity: 'customer', id },
      data: { from: current.status, to: status, reason: reason ? String(reason).slice(0, 500) : null }
    }, ctx);
    return updated;
  }

  /**
   * Soft-deletes a customer with its contact points and identities (which
   * frees the identities for re-use). Notes and the consent ledger are kept.
   *
   * @param {string} id - Customer id
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented deleted customer
   */
  async remove(id, ctx, { expectedVersion } = {}) {
    const deleted = await this.repo.softDelete(id, ctx, { expectedVersion });
    for (const kind of Object.keys(this.contactPoints)) await this.contactPoints[kind].removeAll('customer', id, ctx);
    await this.identities.unlinkAll(id, ctx);
    return deleted;
  }

  // ---- lookup -------------------------------------------------------------

  /**
   * Exact lookup by email, phone, identity or number (first match wins in that order of parameters given).
   *
   * @param {Object} params - `{ email?, phone?, identity? ('ns:value'), number? }`
   * @param {Object} ctx - Operation context
   * @return {Promise<Object[]>} Presented customers
   * @throws {ClientError} 400 when no parameter is given
   */
  async lookup({ email, phone, identity, number } = {}, ctx) {
    const ids = new Set();
    if (email !== undefined) {
      const address = normaliseEmail(email);
      for (const e of await this.repos.email.findByIndex('address', address, readAs(ctx))) {
        if (e.partyType === 'customer') ids.add(e.partyId);
      }
    }
    if (phone !== undefined) {
      const { e164 } = normalisePhone(phone, this.defaultCountry);
      for (const p of await this.repos.phone.findByIndex('e164', e164, readAs(ctx))) {
        if (p.partyType === 'customer') ids.add(p.partyId);
      }
    }
    if (identity !== undefined) {
      const { namespace, value } = this.identities.parse(identity);
      const customerId = await this.identities.resolve(namespace, value, ctx);
      if (customerId) ids.add(customerId);
    }
    if (number !== undefined) {
      for (const c of await this.repo.findByIndex('number', String(number).trim(), readAs(ctx))) ids.add(c.id);
    }
    if (email === undefined && phone === undefined && identity === undefined && number === undefined) {
      throw badRequest('lookup needs email, phone, identity or number');
    }
    return this.loadMany_([...ids], ctx);
  }

  /**
   * Typeahead over names, numbers, emails, phones and identity values.
   *
   * @param {string} text - Search text (2+ characters)
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ limit = 10 }`
   * @return {Promise<Object[]>} Presented customers, best first
   */
  async typeahead(text, ctx, { limit = 10 } = {}) {
    const q = String(text || '').trim();
    if (q.length < 2) return [];
    const ids = [];
    const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
    const sys = readAs(ctx);

    if (/^cus-\d+$/i.test(q)) (await this.repo.findByIndex('number', q.toUpperCase(), sys)).forEach((c) => add(c.id));
    if (q.includes('@')) {
      try {
        (await this.repos.email.findByIndex('address', normaliseEmail(q), sys)).forEach((e) => e.partyType === 'customer' && add(e.partyId));
      } catch { /* partial address: fall through to text search */ }
    }
    if (/^[+\d][\d\s()-]{5,}$/.test(q)) {
      try {
        const { e164 } = normalisePhone(q, this.defaultCountry);
        (await this.repos.phone.findByIndex('e164', e164, sys)).forEach((p) => p.partyType === 'customer' && add(p.partyId));
      } catch { /* not a full number */ }
    }
    const max = limit * 3;
    (await this.repo.searchText(q, sys, { limit: max })).forEach((c) => add(c.id));
    (await this.repos.email.searchText(q, sys, { limit: max })).forEach((e) => e.partyType === 'customer' && add(e.partyId));
    (await this.repos.phone.searchText(q, sys, { limit: max })).forEach((p) => p.partyType === 'customer' && add(p.partyId));
    (await this.repos.identity.searchText(q, sys, { limit: max })).forEach((i) => add(i.customerId));
    return this.loadMany_(ids.slice(0, Math.max(1, limit) * 2), ctx).then((list) => list.slice(0, limit));
  }

  // ---- integration --------------------------------------------------------

  /**
   * Finds or creates the customer behind an external identity (PRD scenario 1).
   *
   * 1. The identity is already linked → update that customer with `profile`.
   * 2. Otherwise a customer with the profile's email exists → link the identity and update.
   * 3. Otherwise → create the customer with the identity.
   *
   * New emails/phones/addresses in the profile are added; existing ones are left alone.
   *
   * @param {{namespace: string, value: string, source?: string}} identity - External id
   * @param {Object} profile - Customer fields, `email` / `phone` shorthands and nested collections
   * @param {Object} ctx - Operation context
   * @return {Promise<{customer: Object, created: boolean, matchedBy: ?string}>} Result
   */
  async upsertByIdentity(identity, profile = {}, ctx) {
    const key = this.identities.normalise(identity && identity.namespace, identity && identity.value);
    return this.mutex.run(`upsert:${ctx.tenantId}:${key.namespace}:${key.value}`, async () => {
      const { profile: fields, nested } = this.split_(profile);
      let customerId = await this.identities.resolve(key.namespace, key.value, ctx);
      let matchedBy = customerId ? 'identity' : null;
      const email = nested.emails[0] && (typeof nested.emails[0] === 'string' ? nested.emails[0] : nested.emails[0].address);
      if (!customerId && email) {
        const [match] = await this.lookup({ email }, readAs(ctx));
        if (match) {
          customerId = match.id;
          matchedBy = 'email';
        }
      }
      if (!customerId) {
        const customer = await this.create({
          ...profile, identities: [...(nested.identities || []), { ...key, source: identity.source }]
        }, ctx);
        return { customer, created: true, matchedBy: null };
      }

      if (Object.keys(fields).length) await this.update(customerId, fields, ctx);
      await this.identities.link(customerId, { ...key, source: identity.source }, ctx);
      const plan = await this.planNested_({ ...nested, identities: nested.identities || [] }, ctx, customerId, { skipExisting: true });
      await this.applyNested_(customerId, plan, ctx);
      const customer = await this.get(customerId, ctx, { expand: ['emails', 'phones', 'identities'] });
      return { customer, created: false, matchedBy };
    });
  }

  // ---- internals ----------------------------------------------------------

  split_(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('customer must be a JSON object');
    const { emails, phones, addresses, identities, consents, email, phone, ...profile } = input;
    const asArray = (v, name) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) throw validationError(`${name} must be an array`, [{ path: name, message: 'must be an array' }]);
      if (v.length > 20) throw validationError(`${name} has too many items`, [{ path: name, message: 'at most 20 items' }]);
      return v;
    };
    const nested = {
      emails: asArray(emails, 'emails'),
      phones: asArray(phones, 'phones'),
      addresses: asArray(addresses, 'addresses'),
      identities: asArray(identities, 'identities'),
      consents: asArray(consents, 'consents')
    };
    if (email !== undefined && email !== null) nested.emails.unshift(String(email));
    if (phone !== undefined && phone !== null) nested.phones.unshift(String(phone));
    return { profile, nested };
  }

  async prepareProfile_(profile, current, ctx) {
    const out = { ...profile };
    if (out.name !== undefined && out.name !== null) {
      if (typeof out.name === 'string') out.name = { full: out.name };
      if (typeof out.name !== 'object' || Array.isArray(out.name)) {
        throw validationError('name must be an object', [{ path: 'name', message: 'must be an object' }]);
      }
      const merged = { ...((current && current.name) || {}), ...out.name };
      for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
      const parts = NAME_PARTS.map((p) => (typeof merged[p] === 'string' ? merged[p].trim() : '')).filter(Boolean);
      const explicitFull = out.name.full !== undefined && out.name.full !== null;
      if (!explicitFull && parts.length) merged.full = parts.join(' ');
      if (!merged.full && !merged.preferred) {
        throw validationError('A customer needs a name', [{ path: 'name', message: 'needs given, family, full or preferred' }]);
      }
      // On update send a merge patch (nulls clear parts); on create send the whole name.
      out.name = current ? { ...out.name, full: merged.full } : merged;
    } else if (!current) {
      throw validationError('A customer needs a name', [{ path: 'name', message: 'is required' }]);
    }
    Object.assign(out, normaliseLocaleFields(out));
    if (out.organizationId) await loadParty(this.repos, 'organization', out.organizationId, ctx);
    return out;
  }

  /** Validates nested items and works out what to create, before any write. */
  async planNested_(nested, ctx, customerId, { skipExisting = false } = {}) {
    const plan = { emails: [], phones: [], addresses: [], identities: [], consents: [], expand: [] };
    const sys = readAs(ctx);
    const existing = customerId && skipExisting ? {
      emails: new Set((await this.contactPoints.email.listUnchecked('customer', customerId, sys)).map((e) => e.address)),
      phones: new Set((await this.contactPoints.phone.listUnchecked('customer', customerId, sys)).map((p) => p.e164)),
      addresses: new Set((await this.contactPoints.address.listUnchecked('customer', customerId, sys))
        .map((a) => `${a.line1}|${a.postalCode || ''}|${a.countryCode}`.toLowerCase()))
    } : null;

    const seenEmail = new Set();
    for (const [i, item] of nested.emails.entries()) {
      const input = typeof item === 'string' ? { address: item } : item;
      const { input: clean } = this.prepareChild_('email', input, `emails[${i}]`);
      if (seenEmail.has(clean.address) || (existing && existing.emails.has(clean.address))) continue;
      seenEmail.add(clean.address);
      plan.emails.push(clean);
    }
    const seenPhone = new Set();
    for (const [i, item] of nested.phones.entries()) {
      const input = typeof item === 'string' ? { raw: item } : item;
      const { input: clean, system } = this.prepareChild_('phone', input, `phones[${i}]`);
      if (seenPhone.has(system.e164) || (existing && existing.phones.has(system.e164))) continue;
      seenPhone.add(system.e164);
      plan.phones.push(clean);
    }
    for (const [i, item] of nested.addresses.entries()) {
      const { input: clean } = this.prepareChild_('address', item, `addresses[${i}]`);
      const key = `${clean.line1}|${clean.postalCode || ''}|${clean.countryCode}`.toLowerCase();
      if (existing && existing.addresses.has(key)) continue;
      plan.addresses.push(clean);
    }
    for (const [i, item] of nested.identities.entries()) {
      let key;
      try {
        key = this.identities.normalise(item && item.namespace, item && item.value);
      } catch (err) {
        err.details = (err.details || []).map((d) => ({ ...d, path: `identities[${i}].${d.path}` }));
        throw err;
      }
      const owner = await this.identities.resolve(key.namespace, key.value, ctx);
      if (owner && owner !== customerId) {
        throw conflict(`Identity ${key.namespace}:${key.value} belongs to another customer`, { existingCustomerId: owner });
      }
      if (!plan.identities.some((x) => x.namespace === key.namespace && x.value === key.value)) {
        plan.identities.push({ ...key, source: item.source });
      }
    }
    for (const [i, item] of nested.consents.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw validationError(`consents[${i}] must be an object`, [{ path: `consents[${i}]`, message: 'must be an object' }]);
      }
      try {
        validate(this.repos.consent.schema, { ...item, customerId: 'pending' });
      } catch (err) {
        err.details = (err.details || []).map((d) => ({ ...d, path: `consents[${i}].${d.path}` }));
        throw err;
      }
      plan.consents.push(item);
    }
    for (const [name, list] of [['emails', plan.emails], ['phones', plan.phones], ['addresses', plan.addresses], ['identities', plan.identities]]) {
      if (list.length) plan.expand.push(name);
    }
    if (plan.consents.length) plan.expand.push('consentState');
    return plan;
  }

  prepareChild_(kind, input, path) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw validationError(`${path} must be an object`, [{ path, message: 'must be an object' }]);
    }
    try {
      const prepared = this.contactPoints[kind].prepare(input);
      // validate the shape early; party fields are set when the customer exists
      validate(this.repos[kind].schema, { ...prepared.input, partyType: 'customer', partyId: 'pending' });
      return prepared;
    } catch (err) {
      if (err.details) err.details = err.details.map((d) => ({ ...d, path: `${path}.${d.path}` }));
      throw err;
    }
  }

  async applyNested_(customerId, plan, ctx) {
    for (const input of plan.emails) await this.contactPoints.email.add('customer', customerId, input, ctx);
    for (const input of plan.phones) await this.contactPoints.phone.add('customer', customerId, input, ctx);
    for (const input of plan.addresses) await this.contactPoints.address.add('customer', customerId, input, ctx);
    for (const input of plan.identities) await this.identities.link(customerId, input, ctx);
    for (const input of plan.consents) await this.consents.record(customerId, input, ctx);
  }

  async rollback_(customerId, ctx) {
    const sys = readAs(ctx);
    for (const kind of Object.keys(this.contactPoints)) {
      for (const doc of await this.contactPoints[kind].listUnchecked('customer', customerId, sys)) {
        await this.repos[kind].hardDelete(doc.id, ctx);
      }
    }
    for (const doc of await this.repos.identity.findByIndex('customer', customerId, sys)) await this.repos.identity.hardDelete(doc.id, ctx);
    for (const doc of await this.repos.consent.findByIndex('customer', customerId, sys)) await this.repos.consent.hardDelete(doc.id, ctx);
    await this.repo.hardDelete(customerId, ctx);
  }

  checkExpand_(expand = []) {
    for (const e of expand || []) {
      if (!EXPANDABLE.includes(e)) throw badRequest(`Cannot expand '${e}' (expected ${EXPANDABLE.join(', ')})`);
    }
  }

  async expand_(customer, expand = [], ctx) {
    this.checkExpand_(expand);
    if (!expand || !expand.length) return customer;
    const out = { ...customer };
    for (const e of expand) {
      if (e === 'addresses') out.addresses = await this.contactPoints.address.listUnchecked('customer', customer.id, ctx);
      if (e === 'phones') out.phones = await this.contactPoints.phone.listUnchecked('customer', customer.id, ctx);
      if (e === 'emails') out.emails = await this.contactPoints.email.listUnchecked('customer', customer.id, ctx);
      if (e === 'identities') out.identities = await this.identities.list(customer.id, ctx);
      if (e === 'consentState') out.consentState = await this.consents.getConsentState(customer.id, ctx);
      if (e === 'notes') out.notes = await this.notes.listUnchecked('customer', customer.id, ctx);
      if (e === 'organization') {
        out.organization = customer.organizationId ? await this.repos.organization.find(customer.organizationId, ctx) : null;
      }
    }
    return out;
  }

  async loadMany_(ids, ctx) {
    const docs = await Promise.all(ids.map((id) => this.repo.find(id, ctx)));
    return docs.filter(Boolean);
  }
}

/**
 * Display name for a customer document.
 *
 * @param {Object} customer - Customer
 * @return {string} Preferred or full name
 */
function displayName(customer) {
  return getPath(customer, 'name.preferred') || getPath(customer, 'name.full') || customer.number || customer.id;
}

module.exports = { CustomerService, STATUS_TRANSITIONS, EXPANDABLE, displayName };
