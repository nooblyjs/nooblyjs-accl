/**
 * @fileoverview Addresses, phones and emails of customers and organizations
 * (PRD CU-2, CU-3).
 *
 * - Phones are normalised to E.164, emails to lower case, address countries
 *   checked against ISO 3166-1 alpha-2.
 * - One primary per kind (address / phone / email) per party. The first one
 *   added becomes primary; the party's `primaryXId` pointer is kept in sync.
 * - A party cannot hold the same email address or E.164 number twice.
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const KeyedMutex = require('../../shared/repository/mutex');
const { normalisePhone, normaliseEmail, normaliseCountry } = require('../../shared/reference/normalise');
const { notFound, conflict, validationError } = require('../../shared/errors');
const { readAs, loadParty } = require('./support');

const KINDS = Object.freeze({
  address: { pointer: 'primaryAddressId', label: 'Address' },
  phone: { pointer: 'primaryPhoneId', label: 'Phone' },
  email: { pointer: 'primaryEmailId', label: 'Email' }
});

class ContactPointService {
  /**
   * @param {string} kind - `address` | `phone` | `email`
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories: the kind's repo plus `customer` and `organization`
   * @param {Object} [deps.options] - `{ defaultCountry }` for national-format phone numbers
   */
  constructor(kind, { repos, options = {} }) {
    if (!KINDS[kind]) throw new Error(`ContactPointService: unknown kind '${kind}'`);
    this.kind = kind;
    this.config = KINDS[kind];
    this.repos = repos;
    this.repo = repos[kind];
    this.defaultCountry = options.defaultCountry || null;
    this.mutex = new KeyedMutex();
  }

  /**
   * Validates and normalises the value fields of an input or patch, returning
   * the trusted fields to store alongside it.
   *
   * @param {Object} input - Client fields
   * @param {?Object} current - Current document (on update)
   * @return {{input: Object, system: Object}} Cleaned input and system fields
   */
  prepare(input, current = null) {
    const out = { ...input };
    const system = {};
    if (this.kind === 'email' && out.address !== undefined) {
      out.address = normaliseEmail(out.address);
    }
    if (this.kind === 'address' && out.countryCode !== undefined) {
      out.countryCode = normaliseCountry(out.countryCode);
    }
    if (this.kind === 'phone' && (out.raw !== undefined || out.countryCode !== undefined)) {
      const raw = out.raw !== undefined ? out.raw : current && current.raw;
      const hint = out.countryCode || (current && current.countryCode) || this.defaultCountry;
      const normalised = normalisePhone(raw, hint);
      system.e164 = normalised.e164;
      out.countryCode = normalised.countryCode;
      if (normalised.extension && out.extension === undefined) out.extension = normalised.extension;
      if (normalised.extension && typeof raw === 'string') out.raw = raw.replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\s*$/i, '');
    }
    if (out.validFrom && out.validTo && out.validTo < out.validFrom) {
      throw validationError('validTo must not be before validFrom', [{ path: 'validTo', message: 'is before validFrom' }]);
    }
    return { input: out, system };
  }

  /** @return {string} The normalised value that must be unique per party */
  valueOf_(doc) {
    if (this.kind === 'email') return doc.address;
    if (this.kind === 'phone') return doc.e164;
    return null;
  }

  /**
   * Lists a party's contact points of this kind, primary first.
   *
   * @param {string} partyType - `customer` | `organization`
   * @param {string} partyId - Party id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object[]>} Presented documents
   */
  async list(partyType, partyId, ctx) {
    await loadParty(this.repos, partyType, partyId, ctx);
    return this.listUnchecked(partyType, partyId, ctx);
  }

  /** Same as list() without the party existence check (used for expansion). */
  async listUnchecked(partyType, partyId, ctx) {
    const items = (await this.repo.findByIndex('party', partyId, ctx)).filter((d) => d.partyType === partyType);
    return items.sort((a, b) => (Number(b.isPrimary) - Number(a.isPrimary)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /**
   * Returns one contact point of a party, or throws 404.
   *
   * @param {string} partyType - Party type
   * @param {string} partyId - Party id
   * @param {string} id - Contact point id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented document
   */
  async get(partyType, partyId, id, ctx) {
    const doc = await this.repo.find(id, ctx);
    if (!doc || doc.partyId !== partyId || doc.partyType !== partyType) throw notFound(this.kind, id);
    return doc;
  }

  /**
   * Adds a contact point to a party.
   *
   * @param {string} partyType - Party type
   * @param {string} partyId - Party id
   * @param {Object} input - Contact point fields (`isPrimary: true` makes it primary)
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented document
   * @throws {ClientError} 404 party, 409 duplicate value, 422 invalid
   */
  async add(partyType, partyId, input, ctx) {
    await loadParty(this.repos, partyType, partyId, ctx);
    const { input: clean, system } = this.prepare({ ...input, partyType, partyId });
    return this.mutex.run(`${partyType}:${partyId}`, async () => {
      const existing = await this.listUnchecked(partyType, partyId, readAs(ctx));
      const value = this.valueOf_({ ...clean, ...system });
      if (value && existing.some((d) => this.valueOf_(d) === value)) {
        throw conflict(`${this.config.label} already exists on this ${partyType}`, { field: this.kind === 'email' ? 'address' : 'raw' });
      }
      const makePrimary = clean.isPrimary === true || !existing.some((d) => d.isPrimary);
      const created = await this.repo.create({ ...clean, isPrimary: false }, ctx, { system });
      if (makePrimary) return this.setPrimary_(partyType, partyId, created.id, existing, ctx);
      return created;
    });
  }

  /**
   * Updates a contact point. `partyType` / `partyId` cannot change.
   * `isPrimary: true` promotes it; un-setting the primary is not allowed
   * (promote another one instead).
   *
   * @param {string} partyType - Party type
   * @param {string} partyId - Party id
   * @param {string} id - Contact point id
   * @param {Object} patch - Merge patch
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented document
   */
  async update(partyType, partyId, id, patch, ctx, { expectedVersion } = {}) {
    if (patch && (patch.partyType !== undefined || patch.partyId !== undefined)) {
      throw validationError('A contact point cannot move to another party', [{ path: 'partyId', message: 'is immutable' }]);
    }
    return this.mutex.run(`${partyType}:${partyId}`, async () => {
      const current = await this.repo.find(id, readAs(ctx));
      if (!current || current.partyId !== partyId || current.partyType !== partyType) throw notFound(this.kind, id);
      const { isPrimary, ...rest } = patch || {};
      if (isPrimary === false && current.isPrimary) {
        throw validationError('Make another contact point primary instead', [{ path: 'isPrimary', message: 'cannot be cleared on the primary' }]);
      }
      const { input: clean, system } = this.prepare(rest, current);
      const value = this.valueOf_({ ...current, ...clean, ...system });
      if (value && value !== this.valueOf_(current)) {
        const others = await this.listUnchecked(partyType, partyId, readAs(ctx));
        if (others.some((d) => d.id !== id && this.valueOf_(d) === value)) {
          throw conflict(`${this.config.label} already exists on this ${partyType}`);
        }
      }
      let updated = await this.repo.update(id, clean, ctx, { expectedVersion, system });
      if (isPrimary === true && !current.isPrimary) {
        const all = await this.listUnchecked(partyType, partyId, readAs(ctx));
        updated = await this.setPrimary_(partyType, partyId, id, all, ctx);
      }
      return updated;
    });
  }

  /**
   * Removes (soft-deletes) a contact point. When it was primary, the oldest
   * remaining one is promoted.
   *
   * @param {string} partyType - Party type
   * @param {string} partyId - Party id
   * @param {string} id - Contact point id
   * @param {Object} ctx - Operation context
   * @return {Promise<void>}
   */
  async remove(partyType, partyId, id, ctx) {
    await this.mutex.run(`${partyType}:${partyId}`, async () => {
      const current = await this.repo.find(id, readAs(ctx));
      if (!current || current.partyId !== partyId || current.partyType !== partyType) throw notFound(this.kind, id);
      await this.repo.softDelete(id, ctx);
      if (current.isPrimary) {
        const rest = await this.listUnchecked(partyType, partyId, readAs(ctx));
        if (rest.length) await this.setPrimary_(partyType, partyId, rest[0].id, rest, ctx);
        else await this.repos[partyType].update(partyId, {}, ctx, { system: { [this.config.pointer]: null } });
      }
    });
  }

  /**
   * Soft-deletes every contact point of a party (party deletion).
   *
   * @param {string} partyType - Party type
   * @param {string} partyId - Party id
   * @param {Object} ctx - Operation context
   * @return {Promise<number>} Number removed
   */
  async removeAll(partyType, partyId, ctx) {
    const all = await this.listUnchecked(partyType, partyId, readAs(ctx));
    for (const doc of all) await this.repo.softDelete(doc.id, ctx);
    return all.length;
  }

  /**
   * Makes one contact point the party's primary of this kind (caller holds the party lock).
   */
  async setPrimary_(partyType, partyId, id, existing, ctx) {
    for (const doc of existing) {
      if (doc.id !== id && doc.isPrimary) await this.repo.update(doc.id, { isPrimary: false }, ctx);
    }
    const promoted = await this.repo.update(id, { isPrimary: true }, ctx);
    const party = await this.repos[partyType].find(partyId, readAs(ctx));
    if (party && party[this.config.pointer] !== id) {
      await this.repos[partyType].update(partyId, {}, ctx, { system: { [this.config.pointer]: id } });
    }
    return promoted;
  }
}

module.exports = { ContactPointService, KINDS };
