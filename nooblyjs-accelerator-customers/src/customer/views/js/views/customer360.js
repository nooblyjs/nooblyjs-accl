'use strict';

/**
 * Customer 360: header with actions, profile, identities, and tabs for
 * contact points, consent, notes, timeline and audit.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;
  const STATUS_ACTIONS = { active: ['inactive', 'blocked'], inactive: ['active', 'blocked'], blocked: ['active', 'inactive'], merged: [], erased: [] };

  /**
   * @param {HTMLElement} el - Main container
   * @param {URLSearchParams} params - Hash query (`tab`)
   * @param {string} id - Customer id
   */
  async function render(el, params, id) {
    mount(el, ui.loading());
    let customer;
    try {
      customer = await api.get(`/customers/${encodeURIComponent(id)}`, { expand: 'organization,emails,phones' });
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${err.status === 404 ? 'This customer does not exist or was deleted.' : ui.errorMessage(err)}</div>
        <a href="#/customers" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Back to customers</a>`);
      return;
    }
    const base = `/customers/${encodeURIComponent(customer.id)}`;
    const tab = params.get('tab') || 'contact';
    const name = ui.displayName(customer);
    const email = CX.party.primaryOf(customer.emails);
    const phone = CX.party.primaryOf(customer.phones);
    const refresh = () => render(el, params, id);

    mount(el, h`
      <nav aria-label="breadcrumb" class="mb-3"><ol class="breadcrumb mb-0">
        <li class="breadcrumb-item"><a href="#/customers">Customers</a></li>
        <li class="breadcrumb-item active" aria-current="page">${customer.number}</li></ol></nav>

      <div class="card mb-4"><div class="card-body cx-hero">
        <div class="cx-hero-identity">${ui.avatar(name, customer.id)}
          <div class="min-w-0"><h1 class="cx-hero-name">${name}</h1>
            <div class="cx-hero-meta">
              <span class="cx-mono">${customer.number}</span>${ui.status(customer.status)}${ui.stage(customer.lifecycleStage)}
              ${(customer.tags || []).map((t) => h`<span class="cx-tag">${t}</span>`)}
            </div>
            <div class="cx-hero-meta">
              ${email ? h`<span><i class="bi bi-envelope me-1"></i>${email.address}</span>` : ''}
              ${phone ? h`<span><i class="bi bi-telephone me-1"></i>${phone.e164}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-secondary btn-sm" data-cx-edit><i class="bi bi-pencil me-1"></i>Edit</button>
          ${STATUS_ACTIONS[customer.status] && STATUS_ACTIONS[customer.status].length ? h`
          <div class="dropdown">
            <button class="btn btn-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"><i class="bi bi-toggles me-1"></i>Status</button>
            <ul class="dropdown-menu dropdown-menu-end">${STATUS_ACTIONS[customer.status].map((s) => h`
              <li><button class="dropdown-item" type="button" data-cx-status="${s}">Mark as ${s}</button></li>`)}</ul>
          </div>` : ''}
          <button class="btn btn-outline-danger btn-sm" data-cx-delete><i class="bi bi-trash me-1"></i>Delete</button>
        </div>
      </div></div>

      <div class="row g-4">
        <div class="col-lg-4">
          <div class="card mb-4"><div class="card-body">
            <h2 class="cx-section-title">Profile</h2>
            <dl class="cx-kv">
              <dt>Full name</dt><dd>${(customer.name && customer.name.full) || '—'}</dd>
              <dt>Date of birth</dt><dd>${ui.fmtDate(customer.dateOfBirth)}</dd>
              <dt>Gender</dt><dd>${customer.gender || '—'}</dd>
              <dt>Language</dt><dd>${customer.language || '—'}</dd>
              <dt>Time zone</dt><dd>${customer.timezone || '—'}</dd>
              <dt>Currency</dt><dd>${customer.currency || '—'}</dd>
              <dt>Organization</dt><dd>${customer.organization ? h`<a href="#/organizations/${customer.organization.id}">${customer.organization.name}</a>` : '—'}</dd>
              <dt>Source</dt><dd>${customer.source ? [customer.source.channel, customer.source.system].filter(Boolean).join(' · ') || '—' : '—'}</dd>
              <dt>Created</dt><dd>${ui.fmtDateTime(customer.createdAt)}</dd>
              <dt>Updated</dt><dd>${ui.fmtDateTime(customer.updatedAt)} <span class="text-muted small">(v${customer.version})</span></dd>
            </dl>
          </div></div>
          <div class="card"><div class="card-body" data-cx-identities></div></div>
        </div>
        <div class="col-lg-8">
          <ul class="nav nav-tabs mb-3" role="tablist">
            ${[['contact', 'Contact points', 'person-lines-fill'], ['consent', 'Consent', 'shield-check'], ['notes', 'Notes', 'journal-text'], ['timeline', 'Timeline', 'clock-history'], ['audit', 'Audit', 'list-check']]
    .map(([key, label, icon]) => h`<li class="nav-item" role="presentation">
              <a class="nav-link ${tab === key ? 'active' : ''}" role="tab" aria-selected="${tab === key}" href="#/customers/${customer.id}?tab=${key}"><i class="bi bi-${icon} me-1"></i>${label}</a></li>`)}
          </ul>
          <div class="card"><div class="card-body" data-cx-tab></div></div>
        </div>
      </div>`);

    el.querySelector('[data-cx-edit]').addEventListener('click', () => openEdit(customer, refresh));
    el.querySelectorAll('[data-cx-status]').forEach((btn) => btn.addEventListener('click', () => changeStatus(customer, btn.dataset.cxStatus, refresh)));
    el.querySelector('[data-cx-delete]').addEventListener('click', async () => {
      const ok = await ui.confirm('Delete customer?', `${name} (${customer.number}) and their contact points and identities will be removed. The consent ledger and audit history are kept.`, { confirmLabel: 'Delete customer', danger: true });
      if (!ok) return;
      try {
        await api.del(base, customer.version);
        ui.toast(`${name} deleted`);
        window.location.hash = '#/customers';
      } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    });

    identities(el.querySelector('[data-cx-identities]'), base);
    const pane = el.querySelector('[data-cx-tab]');
    if (tab === 'contact') CX.party.contactPoints(pane, base, refreshHeaderOnly(el, base));
    else if (tab === 'consent') consent(pane, base);
    else if (tab === 'notes') CX.party.notes(pane, base);
    else if (tab === 'timeline') timeline(pane, base);
    else if (tab === 'audit') audit(pane, base);
  }

  /** After contact-point edits only the header contact line can change; re-render quietly. */
  function refreshHeaderOnly(el, base) {
    return async () => {
      try {
        const c = await api.get(base, { expand: 'emails,phones' });
        const email = CX.party.primaryOf(c.emails);
        const phone = CX.party.primaryOf(c.phones);
        const metas = el.querySelectorAll('.cx-hero-meta');
        mount(metas[1], h`${email ? h`<span><i class="bi bi-envelope me-1"></i>${email.address}</span>` : ''}
          ${phone ? h`<span><i class="bi bi-telephone me-1"></i>${phone.e164}</span>` : ''}`);
      } catch { /* header refresh is best effort */ }
    };
  }

  async function openEdit(customer, done) {
    const [ref, orgs] = await Promise.all([api.reference(), CX.customerForm.organizationOptions()]);
    ui.formModal({
      title: `Edit ${ui.displayName(customer)}`,
      fields: CX.customerForm.customerFields(ref, orgs),
      values: customer,
      onSubmit: async (payload) => {
        if (!Object.keys(payload).length) return;
        await api.patch(`/customers/${customer.id}`, payload, customer.version);
        ui.toast('Customer saved');
        done();
      }
    });
  }

  function changeStatus(customer, status, done) {
    ui.formModal({
      title: `Mark as ${status}`,
      size: '',
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 3, maxLength: 500, help: 'Recorded on the status change event.' }],
      submitLabel: `Mark as ${status}`,
      onSubmit: async (payload) => {
        await api.request('POST', `/customers/${customer.id}:status`, { body: { status, reason: payload.reason }, version: customer.version });
        ui.toast(`Status changed to ${status}`);
        done();
      }
    });
  }

  async function identities(el, base) {
    mount(el, ui.loading());
    let items;
    try {
      items = (await api.get(`${base}/identities`)).items;
    } catch (err) {
      mount(el, h`<div class="alert alert-danger mb-0">${ui.errorMessage(err)}</div>`);
      return;
    }
    mount(el, h`
      <h2 class="cx-section-title"><span>Identities</span>
        <button class="btn btn-sm btn-outline-primary" data-cx-add-identity><i class="bi bi-plus-lg"></i> Link</button></h2>
      ${items.length ? h`<ul class="cx-list">${items.map((i) => h`<li>
        <div class="cx-list-main"><div class="cx-mono">${i.namespace}:${i.value}</div>
          <div class="cx-list-sub">${i.source ? `${i.source} · ` : ''}last seen ${ui.relTime(i.lastSeenAt)}</div></div>
        <div class="cx-actions"><button class="cx-icon-btn cx-danger" title="Unlink" aria-label="Unlink" data-cx-unlink="${i.id}"><i class="bi bi-x-lg"></i></button></div>
      </li>`)}</ul>` : h`<p class="text-muted small mb-0">No external identifiers linked.</p>`}`);
    el.querySelector('[data-cx-add-identity]').addEventListener('click', () => ui.formModal({
      title: 'Link identity',
      size: '',
      intro: 'An external identifier from another system, e.g. commerce:123 or loyalty:L-0042.',
      fields: [
        { name: 'namespace', label: 'Namespace', required: true, col: 'col-sm-5', placeholder: 'commerce', maxLength: 64 },
        { name: 'value', label: 'Value', required: true, col: 'col-sm-7', maxLength: 256 },
        { name: 'source', label: 'Source', placeholder: 'admin-ui', maxLength: 50 }
      ],
      submitLabel: 'Link',
      onSubmit: async (payload) => { await api.post(`${base}/identities`, payload); ui.toast('Identity linked'); identities(el, base); }
    }));
    el.querySelectorAll('[data-cx-unlink]').forEach((btn) => btn.addEventListener('click', async () => {
      const item = items.find((i) => i.id === btn.dataset.cxUnlink);
      if (!(await ui.confirm('Unlink identity?', `${item.namespace}:${item.value} will no longer resolve to this customer.`, { confirmLabel: 'Unlink', danger: true }))) return;
      try { await api.del(`${base}/identities/${item.id}`); ui.toast('Identity unlinked'); identities(el, base); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    }));
  }

  async function consent(el, base) {
    mount(el, ui.loading());
    let ref; let state; let ledger;
    try {
      [ref, state, ledger] = await Promise.all([api.reference(), api.get(`${base}/consents/state`), api.get(`${base}/consents`)]);
    } catch (err) {
      mount(el, h`<div class="alert alert-danger mb-0">${ui.errorMessage(err)}</div>`);
      return;
    }
    mount(el, h`
      <h2 class="cx-section-title"><span>Current consent</span>
        <button class="btn btn-sm btn-primary" data-cx-record><i class="bi bi-plus-lg"></i> Record consent</button></h2>
      ${state.items.length ? h`<div class="table-responsive mb-4"><table class="table table-sm align-middle">
        <thead><tr><th>Purpose</th><th>Channel</th><th>Topic</th><th>Status</th><th class="d-none d-md-table-cell">Basis</th><th>Captured</th></tr></thead>
        <tbody>${state.items.map((s) => h`<tr><td>${ui.label(s.purpose)}</td><td>${ui.label(s.channel)}</td><td>${s.topicId || '—'}</td>
          <td>${ui.status(s.status)}</td><td class="d-none d-md-table-cell">${ui.label(s.lawfulBasis)}</td><td>${ui.fmtDate(s.capturedAt)}${s.expiresAt ? h`<div class="cx-list-sub">expires ${ui.fmtDate(s.expiresAt)}</div>` : ''}</td></tr>`)}</tbody>
      </table></div>` : h`<p class="text-muted">No consent recorded. Marketing contact is not allowed until the customer opts in.</p>`}

      <h2 class="cx-section-title">Can we contact them?</h2>
      <form class="row g-2 align-items-end mb-4" data-cx-check>
        <div class="col-sm-4"><label class="form-label" for="cx-chk-purpose">Purpose</label>
          <select class="form-select" id="cx-chk-purpose" name="purpose">${ref.consentPurposes.map((p) => h`<option value="${p}">${ui.label(p)}</option>`)}</select></div>
        <div class="col-sm-3"><label class="form-label" for="cx-chk-channel">Channel</label>
          <select class="form-select" id="cx-chk-channel" name="channel">${ref.consentChannels.filter((c) => c !== 'any').map((c) => h`<option value="${c}">${ui.label(c)}</option>`)}</select></div>
        <div class="col-sm-3"><label class="form-label" for="cx-chk-topic">Topic</label>
          <input class="form-control" id="cx-chk-topic" name="topicId" maxlength="100" placeholder="optional"></div>
        <div class="col-sm-2"><button class="btn btn-secondary w-100" type="submit">Check</button></div>
        <div class="col-12 small" data-cx-check-result aria-live="polite"></div>
      </form>

      <h2 class="cx-section-title">Ledger</h2>
      ${ledger.items.length ? h`<ul class="cx-list">${ledger.items.map((r) => h`<li><div class="cx-list-main">
        <div>${ui.status(r.status)} <span class="ms-1">${ui.label(r.purpose)} · ${ui.label(r.channel)}${r.topicId ? ` · ${r.topicId}` : ''}</span></div>
        <div class="cx-list-sub">${ui.fmtDateTime(r.capturedAt)} · ${ui.label(r.source)} · ${ui.label(r.lawfulBasis)} · by ${r.createdBy}${r.evidence && r.evidence.text ? ` · “${r.evidence.text}”` : ''}</div>
      </div></li>`)}</ul>` : h`<p class="text-muted small mb-0">The ledger is empty.</p>`}`);

    el.querySelector('[data-cx-check]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = event.target.elements;
      const out = el.querySelector('[data-cx-check-result]');
      try {
        const r = await api.get(`${base}/consents/check`, { purpose: f.purpose.value, channel: f.channel.value, topicId: f.topicId.value.trim() || undefined });
        mount(out, h`<span class="cx-status cx-status-${r.allowed ? 'allowed' : 'denied'}">${r.allowed ? 'Allowed' : 'Not allowed'}</span> <span class="text-muted ms-2">${ui.label(r.reason)}</span>`);
      } catch (err) { mount(out, h`<span class="text-danger">${ui.errorMessage(err)}</span>`); }
    });
    el.querySelector('[data-cx-record]').addEventListener('click', () => ui.formModal({
      title: 'Record consent',
      intro: 'Consent records are append-only. To withdraw consent, record an opt-out.',
      fields: [
        { name: 'purpose', label: 'Purpose', type: 'select', options: ref.consentPurposes, required: true, col: 'col-sm-6', default: 'marketing' },
        { name: 'channel', label: 'Channel', type: 'select', options: ref.consentChannels, required: true, col: 'col-sm-6', default: 'email' },
        { name: 'status', label: 'Status', type: 'select', options: ref.consentStatuses, required: true, col: 'col-sm-6', default: 'opt_in' },
        { name: 'topicId', label: 'Topic', col: 'col-sm-6', maxLength: 100, placeholder: 'optional, e.g. newsletter' },
        { name: 'lawfulBasis', label: 'Lawful basis', type: 'select', options: ref.lawfulBases, required: true, col: 'col-sm-6', default: 'consent' },
        { name: 'source', label: 'Source', type: 'select', options: ref.consentSources, required: true, col: 'col-sm-6', default: 'agent' },
        { name: 'evidence.text', label: 'Evidence', type: 'textarea', rows: 2, maxLength: 2000, help: 'What the customer agreed to, or how (e.g. "Verbal consent on call 2026-10-02").' },
        { name: 'expiresAt', label: 'Expires', type: 'date', col: 'col-sm-6' }
      ],
      submitLabel: 'Record',
      onSubmit: async (payload) => {
        const body = { ...payload };
        if (body.expiresAt) body.expiresAt = new Date(`${body.expiresAt}T23:59:59`).toISOString();
        await api.post(`${base}/consents`, body);
        ui.toast('Consent recorded');
        consent(el, base);
      }
    }));
  }

  async function timeline(el, base) {
    const types = { note: true, consent: true, audit: true };
    let before;
    let items = [];
    const load = async (reset) => {
      if (reset) { before = undefined; items = []; }
      const wanted = Object.keys(types).filter((t) => types[t]);
      const page = await api.get(`${base}/timeline`, { limit: 30, before, types: wanted.join(',') });
      items = items.concat(page.items);
      before = page.nextBefore;
      draw();
    };
    const draw = () => {
      mount(el, h`
        <div class="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Entry types">
          ${Object.keys(types).map((t) => h`<button type="button" class="chip ${types[t] ? 'active' : ''}" aria-pressed="${types[t]}" data-cx-type="${t}">${ui.label(t)}</button>`)}
        </div>
        ${items.length ? h`<ol class="cx-timeline">${items.map((e) => h`<li class="cx-tl-${e.type}">
          <div class="cx-timeline-title">${e.title}</div>
          ${e.summary ? h`<div class="${e.type === 'note' ? 'cx-note-body' : 'small'}">${e.summary}</div>` : ''}
          <div class="cx-timeline-meta" title="${ui.fmtDateTime(e.at)}">${ui.relTime(e.at)}${e.actor ? ` · ${e.actor}` : ''}</div>
        </li>`)}</ol>` : ui.empty('clock-history', 'Nothing on the timeline yet.')}
        ${before ? h`<button class="btn btn-secondary btn-sm" data-cx-more>Load older</button>` : ''}`);
      el.querySelectorAll('[data-cx-type]').forEach((btn) => btn.addEventListener('click', () => {
        types[btn.dataset.cxType] = !types[btn.dataset.cxType];
        load(true).catch(fail);
      }));
      const more = el.querySelector('[data-cx-more]');
      if (more) more.addEventListener('click', () => load(false).catch(fail));
    };
    const fail = (err) => mount(el, h`<div class="alert alert-danger mb-0">${ui.errorMessage(err)}</div>`);
    mount(el, ui.loading());
    load(true).catch(fail);
  }

  async function audit(el, base) {
    mount(el, ui.loading());
    try {
      const page = await api.get(`${base}/audit`, { limit: 100 });
      mount(el, page.items.length ? h`<div class="table-responsive"><table class="table table-sm align-middle">
        <thead><tr><th>When</th><th>Action</th><th>By</th><th>Changes</th></tr></thead>
        <tbody>${page.items.map((e) => h`<tr><td class="text-nowrap">${ui.fmtDateTime(e.at)}</td><td>${ui.label(e.action)}</td>
          <td class="cx-mono">${e.actor && e.actor.id}</td>
          <td class="small">${(e.changes || []).slice(0, 6).map((c) => h`<div><span class="cx-mono">${c.path}</span> ${c.op === 'remove' ? 'removed' : h`→ ${formatValue(c.value)}`}</div>`)}${(e.changes || []).length > 6 ? h`<div class="text-muted">+${e.changes.length - 6} more</div>` : ''}</td></tr>`)}</tbody>
      </table></div>` : ui.empty('list-check', 'No audit entries.'));
    } catch (err) {
      mount(el, h`<div class="alert ${err.status === 403 ? 'alert-warning' : 'alert-danger'} mb-0">${err.status === 403 ? 'Your role cannot read the audit log.' : ui.errorMessage(err)}</div>`);
    }
  }

  function formatValue(v) {
    if (v === undefined || v === null) return '—';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  }

  CX.views = CX.views || {};
  CX.views.customer = render;
})(window.CX);
