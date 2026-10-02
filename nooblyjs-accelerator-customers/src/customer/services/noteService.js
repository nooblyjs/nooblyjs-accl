/**
 * @fileoverview Notes on customers and organizations (pinned first, newest first).
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const { notFound, validationError } = require('../../shared/errors');
const { readAs, loadParty } = require('./support');

class NoteService {
  /**
   * @param {Object} deps
   * @param {Object} deps.repos - Repositories (`note`, `customer`, `organization`)
   */
  constructor({ repos }) {
    this.repos = repos;
    this.repo = repos.note;
  }

  /**
   * @param {string} subjectType - `customer` | `organization`
   * @param {string} subjectId - Subject id
   * @param {Object} ctx - Operation context
   * @return {Promise<Object[]>} Presented notes
   */
  async list(subjectType, subjectId, ctx) {
    await loadParty(this.repos, subjectType, subjectId, ctx);
    return this.listUnchecked(subjectType, subjectId, ctx);
  }

  /** list() without the subject existence check. */
  async listUnchecked(subjectType, subjectId, ctx) {
    const notes = (await this.repo.findByIndex('subject', subjectId, ctx)).filter((n) => n.subjectType === subjectType);
    return notes.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /**
   * @param {string} subjectType - Subject type
   * @param {string} subjectId - Subject id
   * @param {Object} input - `{ body, visibility?, pinned? }`
   * @param {Object} ctx - Operation context
   * @return {Promise<Object>} Presented note
   */
  async add(subjectType, subjectId, input, ctx) {
    await loadParty(this.repos, subjectType, subjectId, ctx);
    if (!input || typeof input.body !== 'string' || !input.body.trim()) {
      throw validationError('A note needs a body', [{ path: 'body', message: 'is required' }]);
    }
    return this.repo.create({ ...input, subjectType, subjectId }, ctx);
  }

  /**
   * @param {string} subjectType - Subject type
   * @param {string} subjectId - Subject id
   * @param {string} id - Note id
   * @param {Object} patch - `{ body?, visibility?, pinned? }`
   * @param {Object} ctx - Operation context
   * @param {Object} [opts] - `{ expectedVersion }`
   * @return {Promise<Object>} Presented note
   */
  async update(subjectType, subjectId, id, patch, ctx, { expectedVersion } = {}) {
    await this.own_(subjectType, subjectId, id, ctx);
    if (patch && (patch.subjectId !== undefined || patch.subjectType !== undefined)) {
      throw validationError('A note cannot move to another subject', [{ path: 'subjectId', message: 'is immutable' }]);
    }
    return this.repo.update(id, patch, ctx, { expectedVersion });
  }

  /**
   * @param {string} subjectType - Subject type
   * @param {string} subjectId - Subject id
   * @param {string} id - Note id
   * @param {Object} ctx - Operation context
   * @return {Promise<void>}
   */
  async remove(subjectType, subjectId, id, ctx) {
    await this.own_(subjectType, subjectId, id, ctx);
    await this.repo.softDelete(id, ctx);
  }

  async own_(subjectType, subjectId, id, ctx) {
    const note = await this.repo.find(id, readAs(ctx));
    if (!note || note.subjectId !== subjectId || note.subjectType !== subjectType) throw notFound('note', id);
    return note;
  }
}

module.exports = { NoteService };
