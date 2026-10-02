'use strict';

/**
 * Organizations: list with search and create, and a detail page with
 * profile, contact points, member customers and notes.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;
  const PAGE = 25;

  function orgFields(ref, orgs, selfId) {
    return [
      { name: 'name', label: 'Name', required: true, col: 'col-sm-6', maxLength: 200 },
      { name: 'legalName', label: 'Legal name', col: 'col-sm-6', maxLength: 300 },
      { name: 'registrationNumber', label: 'Registration number', col: 'col-sm-6', maxLength: 100 },
      { name: 'taxId', label: 'Tax / VAT number', col: 'col-sm-6', maxLength: 100 },
      { name: 'industry', label: 'Industry', col: 'col-sm-6', maxLength: 100 },
      { name: 'employeeBand', label: 'Employees', type: 'select', options: ref.employeeBands, col: 'col-sm-6' },
      { name: 'website', label: 'Website', type: 'url', col: 'col-sm-8', maxLength: 300, placeholder: 'https://' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], required: true, col: 'col-sm-4', default: 'active' },
      { name: 'parentOrganizationId', label: 'Parent organization', type: 'select', options: orgs.filter((o) => o.id !== selfId).map((o) => ({ value: o.id, label: `${o.name} (${o.number})` })) }
    ];
  }

  async function list(el, params) {
    const state = { q: params.get('q') || '', page: Math.max(Number(params.get('page')) || 1, 1) };
    mount(el, h`
      <div class="cx-page-header">
        <div><h1 class="cx-page-title">Organizations</h1><p class="cx-page-subtitle">Business accounts and the people who belong to them.</p></div>
        <button class="btn btn-primary" data-cx-new><i class="bi bi-building-add me-1"></i> New organization</button>
      </div>
      <div class="cx-toolbar"><div class="input-group cx-search">
        <span class="input-group-text"><i class="bi bi-search"></i></span>
        <input type="search" class="form-control" placeholder="Name or number" aria-label="Search organizations" value="${state.q}" data-cx-q>
      </div></div>
      <div class="card cx-table-card" data-cx-results>${ui.loading()}</div>`);

    const navigate = (changes) => {
      const next = { ...state, ...changes };
      const qs = new URLSearchParams();
      if (next.q) qs.set('q', next.q);
      if (next.page > 1) qs.set('page', next.page);
      window.location.hash = `#/organizations${qs.toString() ? `?${qs}` : ''}`;
    };
    const qInput = el.querySelector('[data-cx-q]');
    qInput.addEventListener('input', ui.debounce(() => navigate({ q: qInput.value.trim(), page: 1 }), 300));
    if (state.q) { qInput.focus(); qInput.setSelectionRange(qInput.value.length, qInput.value.length); }
    el.querySelector('[data-cx-new]').addEventListener('click', async () => {
      const [ref, orgs] = await Promise.all([api.reference(), api.get('/organizations', { limit: 200, sort: 'name', fields: 'name,number' }).then((p) => p.items)]);
      ui.formModal({
        title: 'New organization',
        fields: orgFields(ref, orgs),
        submitLabel: 'Create organization',
        onSubmit: async (payload) => {
          const created = await api.post('/organizations', payload);
          ui.toast(`${created.name} created`);
          window.location.hash = `#/organizations/${created.id}`;
        }
      });
    });

    const results = el.querySelector('[data-cx-results]');
    try {
      const page = await api.get('/organizations', { limit: PAGE, offset: (state.page - 1) * PAGE, sort: 'name', q: state.q || undefined });
      if (!page.items.length) { mount(results, ui.empty('building', state.q ? 'No organizations match.' : 'No organizations yet.')); return; }
      mount(results, h`<div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>Organization</th><th class="d-none d-md-table-cell">Industry</th><th class="d-none d-lg-table-cell">Employees</th><th>Status</th></tr></thead>
        <tbody>${page.items.map((o) => h`<tr class="cx-row-link" data-cx-href="#/organizations/${o.id}" tabindex="0">
          <td><a href="#/organizations/${o.id}" class="fw-semibold text-decoration-none">${o.name}</a><div class="cx-list-sub cx-mono">${o.number}</div></td>
          <td class="d-none d-md-table-cell">${o.industry || '—'}</td><td class="d-none d-lg-table-cell">${o.employeeBand || '—'}</td><td>${ui.status(o.status)}</td></tr>`)}</tbody>
      </table></div>
      <div class="cx-pager"><span>${page.offset + 1}–${page.offset + page.items.length} of ${page.total}</span>
        <div class="btn-group">
          <button class="btn btn-sm btn-secondary" data-cx-prev ${state.page <= 1 ? ui.raw('disabled') : ''}><i class="bi bi-chevron-left"></i> Previous</button>
          <button class="btn btn-sm btn-secondary" data-cx-next ${page.nextCursor ? '' : ui.raw('disabled')}>Next <i class="bi bi-chevron-right"></i></button>
        </div></div>`);
      results.querySelectorAll('[data-cx-href]').forEach((row) => {
        const go = (e) => { if (!e.target.closest('a')) window.location.hash = row.dataset.cxHref; };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
      });
      results.querySelector('[data-cx-prev]').addEventListener('click', () => navigate({ page: state.page - 1 }));
      results.querySelector('[data-cx-next]').addEventListener('click', () => navigate({ page: state.page + 1 }));
    } catch (err) {
      mount(results, h`<div class="alert alert-danger m-3">${ui.errorMessage(err)}</div>`);
    }
  }

  async function detail(el, params, id) {
    mount(el, ui.loading());
    let org;
    try {
      org = await api.get(`/organizations/${encodeURIComponent(id)}`, { expand: 'members' });
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${err.status === 404 ? 'This organization does not exist or was deleted.' : ui.errorMessage(err)}</div>
        <a href="#/organizations" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Back</a>`);
      return;
    }
    const base = `/organizations/${encodeURIComponent(org.id)}`;
    const tab = params.get('tab') || 'contact';
    let parent = null;
    if (org.parentOrganizationId) parent = await api.get(`/organizations/${org.parentOrganizationId}`, { fields: 'name,number' }).catch(() => null);

    mount(el, h`
      <nav aria-label="breadcrumb" class="mb-3"><ol class="breadcrumb mb-0">
        <li class="breadcrumb-item"><a href="#/organizations">Organizations</a></li>
        <li class="breadcrumb-item active" aria-current="page">${org.number}</li></ol></nav>
      <div class="card mb-4"><div class="card-body cx-hero">
        <div class="cx-hero-identity">${ui.avatar(org.name, org.id)}
          <div><h1 class="cx-hero-name">${org.name}</h1>
            <div class="cx-hero-meta"><span class="cx-mono">${org.number}</span>${ui.status(org.status)}${org.industry ? h`<span>${org.industry}</span>` : ''}</div></div></div>
        <div class="d-flex gap-2">
          <button class="btn btn-secondary btn-sm" data-cx-edit><i class="bi bi-pencil me-1"></i>Edit</button>
          <button class="btn btn-outline-danger btn-sm" data-cx-delete><i class="bi bi-trash me-1"></i>Delete</button>
        </div>
      </div></div>
      <div class="row g-4">
        <div class="col-lg-4">
          <div class="card mb-4"><div class="card-body"><h2 class="cx-section-title">Profile</h2>
            <dl class="cx-kv">
              <dt>Legal name</dt><dd>${org.legalName || '—'}</dd>
              <dt>Registration</dt><dd>${org.registrationNumber || '—'}</dd>
              <dt>Tax number</dt><dd>${org.taxId || '—'}</dd>
              <dt>Employees</dt><dd>${org.employeeBand || '—'}</dd>
              <dt>Website</dt><dd>${org.website ? h`<a href="${org.website}" target="_blank" rel="noopener noreferrer">${org.website.replace(/^https?:\/\//, '')}</a>` : '—'}</dd>
              <dt>Parent</dt><dd>${parent ? h`<a href="#/organizations/${parent.id}">${parent.name}</a>` : '—'}</dd>
              <dt>Created</dt><dd>${ui.fmtDateTime(org.createdAt)}</dd>
            </dl></div></div>
          <div class="card"><div class="card-body"><h2 class="cx-section-title">People <span class="text-muted small">${org.members.length}</span></h2>
            ${org.members.length ? h`<ul class="cx-list">${org.members.slice(0, 50).map((c) => h`<li><div class="d-flex align-items-center gap-2">${ui.avatar(ui.displayName(c), c.id, true)}
              <div><a href="#/customers/${c.id}">${ui.displayName(c)}</a><div class="cx-list-sub">${c.number}</div></div></div>${ui.status(c.status)}</li>`)}</ul>`
              : h`<p class="text-muted small mb-0">No customers linked. Set the organization on a customer's profile.</p>`}
          </div></div>
        </div>
        <div class="col-lg-8">
          <ul class="nav nav-tabs mb-3" role="tablist">
            ${[['contact', 'Contact points', 'person-lines-fill'], ['notes', 'Notes', 'journal-text']].map(([key, label, icon]) => h`<li class="nav-item" role="presentation">
              <a class="nav-link ${tab === key ? 'active' : ''}" role="tab" aria-selected="${tab === key}" href="#/organizations/${org.id}?tab=${key}"><i class="bi bi-${icon} me-1"></i>${label}</a></li>`)}
          </ul>
          <div class="card"><div class="card-body" data-cx-tab></div></div>
        </div>
      </div>`);

    el.querySelector('[data-cx-edit]').addEventListener('click', async () => {
      const [ref, orgs] = await Promise.all([api.reference(), api.get('/organizations', { limit: 200, sort: 'name', fields: 'name,number' }).then((p) => p.items)]);
      ui.formModal({
        title: `Edit ${org.name}`,
        fields: orgFields(ref, orgs, org.id),
        values: org,
        onSubmit: async (payload) => {
          if (!Object.keys(payload).length) return;
          await api.patch(base, payload, org.version);
          ui.toast('Organization saved');
          detail(el, params, id);
        }
      });
    });
    el.querySelector('[data-cx-delete]').addEventListener('click', async () => {
      if (!(await ui.confirm('Delete organization?', `${org.name} and its contact points will be removed.`, { confirmLabel: 'Delete', danger: true }))) return;
      try {
        await api.del(base, org.version);
        ui.toast(`${org.name} deleted`);
        window.location.hash = '#/organizations';
      } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    });

    const pane = el.querySelector('[data-cx-tab]');
    if (tab === 'notes') CX.party.notes(pane, base);
    else CX.party.contactPoints(pane, base);
  }

  CX.views = CX.views || {};
  CX.views.organizations = list;
  CX.views.organization = detail;
})(window.CX);
