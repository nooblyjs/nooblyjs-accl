'use strict';

/**
 * Customers list: stat tiles, typeahead search, filters, sorting, paging and
 * the "new customer" form.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;
  const PAGE = 25;

  /** Customer profile fields, shared by the create and edit forms. */
  function customerFields(ref, orgs, { create = false } = {}) {
    const fields = [
      { name: 'name.prefix', label: 'Title', col: 'col-sm-2', maxLength: 20 },
      { name: 'name.given', label: 'Given name', col: 'col-sm-5', maxLength: 100, autocomplete: 'given-name' },
      { name: 'name.family', label: 'Family name', col: 'col-sm-5', maxLength: 100, autocomplete: 'family-name' },
      { name: 'name.middle', label: 'Middle name', col: 'col-sm-4', maxLength: 100 },
      { name: 'name.preferred', label: 'Preferred name', col: 'col-sm-4', maxLength: 100 },
      { name: 'name.suffix', label: 'Suffix', col: 'col-sm-4', maxLength: 20 }
    ];
    if (create) {
      fields.push(
        { name: 'email', label: 'Email', type: 'email', col: 'col-sm-6', maxLength: 254, help: 'Becomes the primary email.' },
        { name: 'phone', label: 'Phone', type: 'tel', col: 'col-sm-6', maxLength: 40, help: 'International format, e.g. +27 82 123 4567.' }
      );
    }
    fields.push(
      { name: 'lifecycleStage', label: 'Lifecycle stage', type: 'select', options: ref.lifecycleStages, required: true, col: 'col-sm-6', default: 'subscriber' },
      { name: 'organizationId', label: 'Organization', type: 'select', options: orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.number})` })), col: 'col-sm-6' },
      { name: 'dateOfBirth', label: 'Date of birth', type: 'date', col: 'col-sm-4' },
      { name: 'gender', label: 'Gender', col: 'col-sm-4', maxLength: 40 },
      { name: 'language', label: 'Language', col: 'col-sm-4', maxLength: 35, placeholder: 'en-ZA' },
      { name: 'timezone', label: 'Time zone', col: 'col-sm-6', maxLength: 64, placeholder: 'Africa/Johannesburg' },
      { name: 'currency', label: 'Currency', col: 'col-sm-6', maxLength: 3, placeholder: 'ZAR' },
      { name: 'tags', label: 'Tags', type: 'tags', help: 'Comma-separated, e.g. vip, wholesale' }
    );
    return fields;
  }

  /** Loads organizations for the organization select (first 200 by name). */
  async function organizationOptions() {
    try {
      return (await api.get('/organizations', { limit: 200, sort: 'name', fields: 'name,number' })).items;
    } catch {
      return [];
    }
  }

  /** Opens the create-customer form; navigates to the new customer. */
  async function openCreate() {
    const [ref, orgs] = await Promise.all([api.reference(), organizationOptions()]);
    ui.formModal({
      title: 'New customer',
      fields: customerFields(ref, orgs, { create: true }),
      submitLabel: 'Create customer',
      intro: 'Give at least a given, family or preferred name.',
      onSubmit: async (payload) => {
        const created = await api.post('/customers', payload);
        ui.toast(`${ui.displayName(created)} created`);
        window.location.hash = `#/customers/${created.id}`;
      }
    });
  }

  /**
   * Renders the customers list.
   *
   * @param {HTMLElement} el - Main container
   * @param {URLSearchParams} params - Hash query (q, status, stage, sort, page)
   */
  async function render(el, params) {
    const state = {
      q: params.get('q') || '',
      status: params.get('status') || '',
      stage: params.get('stage') || '',
      sort: params.get('sort') || '-createdAt',
      page: Math.max(Number(params.get('page')) || 1, 1)
    };
    const ref = await api.reference();

    mount(el, h`
      <div class="cx-page-header">
        <div><h1 class="cx-page-title">Customers</h1>
          <p class="cx-page-subtitle">Profiles, contact points, identities and consent.</p></div>
        <button class="btn btn-primary" data-cx-new><i class="bi bi-person-plus me-1"></i> New customer</button>
      </div>
      <div class="row g-3 mb-4" data-cx-stats></div>
      <div class="cx-toolbar">
        <div class="input-group cx-search">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input type="search" class="form-control" placeholder="Name, email, phone, number or ID" aria-label="Search customers" value="${state.q}" data-cx-q>
        </div>
        <select class="form-select" aria-label="Status" data-cx-status>
          <option value="">All statuses</option>
          ${ref.customerStatuses.map((s) => h`<option value="${s}" ${s === state.status ? ui.raw('selected') : ''}>${ui.label(s)}</option>`)}
        </select>
        <select class="form-select" aria-label="Lifecycle stage" data-cx-stage>
          <option value="">All stages</option>
          ${ref.lifecycleStages.map((s) => h`<option value="${s}" ${s === state.stage ? ui.raw('selected') : ''}>${ui.label(s)}</option>`)}
        </select>
        <select class="form-select" aria-label="Sort" data-cx-sort>
          ${[['-createdAt', 'Newest first'], ['createdAt', 'Oldest first'], ['name.family', 'Family name A–Z'], ['-updatedAt', 'Recently updated'], ['number', 'Number']]
    .map(([v, l]) => h`<option value="${v}" ${v === state.sort ? ui.raw('selected') : ''}>${l}</option>`)}
        </select>
      </div>
      <div class="card cx-table-card" data-cx-results>${ui.loading()}</div>`);

    el.querySelector('[data-cx-new]').addEventListener('click', () => openCreate().catch((err) => ui.toast(ui.errorMessage(err), { error: true })));

    const navigate = (changes) => {
      const next = { ...state, ...changes };
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) if (v && !(k === 'sort' && v === '-createdAt') && !(k === 'page' && v === 1)) qs.set(k, v);
      const hash = `#/customers${qs.toString() ? `?${qs}` : ''}`;
      if (window.location.hash !== hash) window.location.hash = hash;
    };
    const qInput = el.querySelector('[data-cx-q]');
    qInput.addEventListener('input', ui.debounce(() => navigate({ q: qInput.value.trim(), page: 1 }), 300));
    if (state.q) {
      // the page re-renders on every search; keep typing where the user was
      qInput.focus();
      qInput.setSelectionRange(qInput.value.length, qInput.value.length);
    }
    el.querySelector('[data-cx-status]').addEventListener('change', (e) => navigate({ status: e.target.value, page: 1 }));
    el.querySelector('[data-cx-stage]').addEventListener('change', (e) => navigate({ stage: e.target.value, page: 1 }));
    el.querySelector('[data-cx-sort]').addEventListener('change', (e) => navigate({ sort: e.target.value, page: 1 }));

    renderStats(el.querySelector('[data-cx-stats]'));

    const results = el.querySelector('[data-cx-results]');
    try {
      const query = { limit: PAGE, offset: (state.page - 1) * PAGE, sort: state.sort, expand: 'emails,phones', q: state.q || undefined };
      if (state.status) query['filter[status]'] = state.status;
      if (state.stage) query['filter[lifecycleStage]'] = state.stage;
      const page = await api.get('/customers', query);
      if (!page.items.length) {
        mount(results, ui.empty('people', state.q || state.status || state.stage ? 'No customers match these filters.' : 'No customers yet.'));
        return;
      }
      mount(results, h`
        <div class="table-responsive"><table class="table align-middle">
          <thead><tr><th>Customer</th><th>Email</th><th class="d-none d-lg-table-cell">Phone</th><th>Status</th><th class="d-none d-md-table-cell">Stage</th><th class="d-none d-xl-table-cell">Created</th></tr></thead>
          <tbody>${page.items.map((c) => {
            const email = CX.party.primaryOf(c.emails);
            const phone = CX.party.primaryOf(c.phones);
            return h`<tr class="cx-row-link" data-cx-href="#/customers/${c.id}" tabindex="0">
              <td><div class="d-flex align-items-center gap-2">${ui.avatar(ui.displayName(c), c.id, true)}
                <div><a href="#/customers/${c.id}" class="fw-semibold text-decoration-none">${ui.displayName(c)}</a>
                <div class="cx-list-sub cx-mono">${c.number}</div></div></div></td>
              <td>${email ? email.address : '—'}</td>
              <td class="d-none d-lg-table-cell">${phone ? phone.e164 : '—'}</td>
              <td>${ui.status(c.status)}</td>
              <td class="d-none d-md-table-cell">${ui.stage(c.lifecycleStage)}</td>
              <td class="d-none d-xl-table-cell">${ui.fmtDate(c.createdAt)}</td></tr>`;
          })}</tbody></table></div>
        <div class="cx-pager">
          <span>${page.offset + 1}–${page.offset + page.items.length} of ${page.total}</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" data-cx-prev ${state.page <= 1 ? ui.raw('disabled') : ''}><i class="bi bi-chevron-left"></i> Previous</button>
            <button class="btn btn-sm btn-secondary" data-cx-next ${page.nextCursor ? '' : ui.raw('disabled')}>Next <i class="bi bi-chevron-right"></i></button>
          </div>
        </div>`);
      results.querySelectorAll('[data-cx-href]').forEach((row) => {
        const go = (e) => { if (e.target.closest('a')) return; window.location.hash = row.dataset.cxHref; };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
      });
      results.querySelector('[data-cx-prev]').addEventListener('click', () => navigate({ page: state.page - 1 }));
      results.querySelector('[data-cx-next]').addEventListener('click', () => navigate({ page: state.page + 1 }));
    } catch (err) {
      mount(results, h`<div class="alert alert-danger m-3">${ui.errorMessage(err)}</div>`);
    }
  }

  async function renderStats(el) {
    const tiles = [
      { label: 'Customers', query: {} },
      { label: 'Active', query: { 'filter[status]': 'active' } },
      { label: 'Paying customers', query: { 'filter[lifecycleStage]': 'customer' } },
      { label: 'Blocked', query: { 'filter[status]': 'blocked' } }
    ];
    try {
      const totals = await Promise.all(tiles.map((t) => api.get('/customers', { ...t.query, limit: 1, fields: 'number' }).then((p) => p.total)));
      mount(el, h`${tiles.map((t, i) => h`<div class="col-6 col-lg-3"><div class="cx-stat">
        <div class="cx-stat-label">${t.label}</div><div class="cx-stat-value">${totals[i].toLocaleString()}</div></div></div>`)}`);
    } catch {
      mount(el, '');
    }
  }

  CX.views = CX.views || {};
  CX.views.customers = render;
  CX.customerForm = { customerFields, organizationOptions, openCreate };
})(window.CX);
