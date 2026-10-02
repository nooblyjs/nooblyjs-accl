'use strict';

/**
 * Campaigns: list with create, and a detail page with status actions and
 * the campaign's messages.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;
  const NEXT_STATUS = { draft: ['running', 'archived'], running: ['paused', 'completed'], paused: ['running', 'completed'], completed: ['archived'], archived: [] };
  const STATUS_LABEL = { running: 'Start', paused: 'Pause', completed: 'Complete', archived: 'Archive' };

  function campaignFields(ref, topics) {
    return [
      { name: 'name', label: 'Name', required: true, maxLength: 200 },
      { name: 'description', label: 'Description', type: 'textarea', rows: 2, maxLength: 2000 },
      { name: 'objective', label: 'Objective', type: 'select', options: ref.campaignObjectives, required: true, col: 'col-sm-6', default: 'retention' },
      { name: 'type', label: 'Type', type: 'select', options: ref.campaignTypes, required: true, col: 'col-sm-6', default: 'one_off' },
      { name: 'topicId', label: 'Subscription topic', type: 'select', options: topics.map((t) => ({ value: t.key, label: t.name })), col: 'col-sm-6', help: 'Unsubscribes from this campaign opt out of the topic only.' },
      { name: 'ownerUserId', label: 'Owner', col: 'col-sm-6', maxLength: 64 },
      { name: 'startAt', label: 'Starts', type: 'datetime-local', col: 'col-sm-6' },
      { name: 'endAt', label: 'Ends', type: 'datetime-local', col: 'col-sm-6' },
      { name: 'utm.source', label: 'UTM source', col: 'col-sm-4', maxLength: 100 },
      { name: 'utm.medium', label: 'UTM medium', col: 'col-sm-4', maxLength: 100 },
      { name: 'utm.campaign', label: 'UTM campaign', col: 'col-sm-4', maxLength: 100 }
    ];
  }

  /** datetime-local inputs give local time without a zone; send ISO. */
  function toIso(payload) {
    for (const k of ['startAt', 'endAt']) if (payload[k]) payload[k] = new Date(payload[k]).toISOString();
    return payload;
  }

  const localInput = (iso) => {
    if (!iso) return undefined;
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  async function topicsList() {
    try { return (await api.get('/topics', { limit: 200 })).items; } catch { return []; }
  }

  async function list(el, params) {
    const state = { q: params.get('q') || '', status: params.get('status') || '' };
    const ref = await CX.marketingRef();
    mount(el, h`
      <div class="cx-page-header">
        <div><h1 class="cx-page-title">Campaigns</h1><p class="cx-page-subtitle">Programmes that group your messages, with goals, UTM tags and a subscription topic.</p></div>
        <button class="btn btn-primary" data-cx-new><i class="bi bi-plus-lg me-1"></i> New campaign</button>
      </div>
      <div class="cx-toolbar">
        <div class="input-group cx-search"><span class="input-group-text"><i class="bi bi-search"></i></span>
          <input type="search" class="form-control" placeholder="Name or number" aria-label="Search campaigns" value="${state.q}" data-cx-q></div>
        <select class="form-select" aria-label="Status" data-cx-status><option value="">All statuses</option>
          ${ref.campaignStatuses.map((s) => h`<option value="${s}" ${s === state.status ? ui.raw('selected') : ''}>${ui.label(s)}</option>`)}</select>
      </div>
      <div class="card cx-table-card" data-cx-results>${ui.loading()}</div>`);

    const navigate = (changes) => {
      const next = { ...state, ...changes };
      const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
      window.location.hash = `#/campaigns${qs.toString() ? `?${qs}` : ''}`;
    };
    const qInput = el.querySelector('[data-cx-q]');
    qInput.addEventListener('input', ui.debounce(() => navigate({ q: qInput.value.trim() }), 300));
    if (state.q) { qInput.focus(); qInput.setSelectionRange(qInput.value.length, qInput.value.length); }
    el.querySelector('[data-cx-status]').addEventListener('change', (e) => navigate({ status: e.target.value }));
    el.querySelector('[data-cx-new]').addEventListener('click', async () => {
      ui.formModal({
        title: 'New campaign',
        fields: campaignFields(ref, await topicsList()),
        submitLabel: 'Create campaign',
        onSubmit: async (payload) => {
          const created = await api.post('/campaigns', toIso(payload));
          ui.toast(`${created.name} created`);
          window.location.hash = `#/campaigns/${created.id}`;
        }
      });
    });

    const results = el.querySelector('[data-cx-results]');
    try {
      const query = { limit: 100, sort: '-createdAt', q: state.q || undefined };
      if (state.status) query['filter[status]'] = state.status;
      const page = await api.get('/campaigns', query);
      if (!page.items.length) { mount(results, ui.empty('megaphone', 'No campaigns yet.')); return; }
      mount(results, h`<div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>Campaign</th><th>Status</th><th class="d-none d-md-table-cell">Objective</th><th class="d-none d-lg-table-cell">Topic</th><th class="d-none d-lg-table-cell">Created</th></tr></thead>
        <tbody>${page.items.map((c) => h`<tr class="cx-row-link" data-cx-href="#/campaigns/${c.id}" tabindex="0">
          <td><a href="#/campaigns/${c.id}" class="fw-semibold text-decoration-none">${c.name}</a><div class="cx-list-sub cx-mono">${c.number}</div></td>
          <td>${ui.status(c.status)}</td><td class="d-none d-md-table-cell">${ui.label(c.objective)}</td>
          <td class="d-none d-lg-table-cell">${c.topicId || '—'}</td><td class="d-none d-lg-table-cell">${ui.fmtDate(c.createdAt)}</td></tr>`)}</tbody>
      </table></div>`);
      CX.rowLinks(results);
    } catch (err) {
      mount(results, h`<div class="alert alert-danger m-3">${ui.errorMessage(err)}</div>`);
    }
  }

  async function detail(el, params, id) {
    mount(el, ui.loading());
    let campaign;
    try {
      campaign = await api.get(`/campaigns/${encodeURIComponent(id)}`, { expand: 'messages' });
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${err.status === 404 ? 'This campaign does not exist.' : ui.errorMessage(err)}</div><a href="#/campaigns" class="btn btn-secondary">Back</a>`);
      return;
    }
    const ref = await CX.marketingRef();
    const refresh = () => detail(el, params, id);
    const editable = !['completed', 'archived'].includes(campaign.status);
    mount(el, h`
      <nav aria-label="breadcrumb" class="mb-3"><ol class="breadcrumb mb-0">
        <li class="breadcrumb-item"><a href="#/campaigns">Campaigns</a></li><li class="breadcrumb-item active" aria-current="page">${campaign.number}</li></ol></nav>
      <div class="card mb-4"><div class="card-body cx-hero">
        <div><h1 class="cx-hero-name">${campaign.name}</h1>
          <div class="cx-hero-meta"><span class="cx-mono">${campaign.number}</span>${ui.status(campaign.status)}<span>${ui.label(campaign.objective)}</span>${campaign.topicId ? h`<span class="cx-tag">${campaign.topicId}</span>` : ''}</div>
          ${campaign.description ? h`<p class="mt-2 mb-0 text-muted">${campaign.description}</p>` : ''}</div>
        <div class="d-flex flex-wrap gap-2">
          ${editable ? h`<button class="btn btn-secondary btn-sm" data-cx-edit><i class="bi bi-pencil me-1"></i>Edit</button>` : ''}
          ${NEXT_STATUS[campaign.status].map((s) => h`<button class="btn btn-sm ${s === 'running' ? 'btn-primary' : 'btn-secondary'}" data-cx-status="${s}">${STATUS_LABEL[s]}</button>`)}
        </div>
      </div></div>
      <div class="card"><div class="card-body">
        <h2 class="cx-section-title"><span>Messages</span>${editable ? h`<button class="btn btn-sm btn-primary" data-cx-new-message><i class="bi bi-plus-lg"></i> New message</button>` : ''}</h2>
        ${campaign.messages.length ? h`<div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>Message</th><th>Channel</th><th>Status</th><th class="d-none d-md-table-cell">Next / last run</th></tr></thead>
          <tbody>${campaign.messages.map((m) => h`<tr class="cx-row-link" data-cx-href="#/messages/${m.id}" tabindex="0">
            <td><a href="#/messages/${m.id}" class="fw-semibold text-decoration-none">${m.name}</a><div class="cx-list-sub cx-mono">${m.number}</div></td>
            <td><i class="bi bi-${m.channel === 'email' ? 'envelope' : 'chat-text'} me-1"></i>${ui.label(m.channel)}</td><td>${ui.status(m.status)}</td>
            <td class="d-none d-md-table-cell">${m.nextRunAt ? `next ${ui.fmtDateTime(m.nextRunAt)}` : m.lastRunAt ? `last ${ui.fmtDateTime(m.lastRunAt)}` : '—'}</td></tr>`)}</tbody>
        </table></div>` : ui.empty('envelope', 'No messages yet. Add one to start sending.')}
      </div></div>`);
    CX.rowLinks(el);
    const editBtn = el.querySelector('[data-cx-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', async () => ui.formModal({
        title: `Edit ${campaign.name}`,
        fields: campaignFields(ref, await topicsList()),
        values: { ...campaign, startAt: localInput(campaign.startAt), endAt: localInput(campaign.endAt) },
        onSubmit: async (payload) => {
          if (!Object.keys(payload).length) return;
          await api.patch(`/campaigns/${campaign.id}`, toIso(payload), campaign.version);
          ui.toast('Campaign saved');
          refresh();
        }
      }));
    }
    el.querySelectorAll('[data-cx-status]').forEach((btn) => btn.addEventListener('click', async () => {
      const status = btn.dataset.cxStatus;
      if (['completed', 'archived'].includes(status) && !(await ui.confirm(`${STATUS_LABEL[status]} campaign?`, status === 'completed' ? 'Its messages stop sending and it can no longer be edited.' : 'It will be hidden from active work.'))) return;
      try { await api.post(`/campaigns/${campaign.id}:status`, { status }); ui.toast(`Campaign ${ui.label(status).toLowerCase()}`); refresh(); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    }));
    const newMessage = el.querySelector('[data-cx-new-message]');
    if (newMessage) newMessage.addEventListener('click', () => CX.messageForm.open({ campaign }).catch((err) => ui.toast(ui.errorMessage(err), { error: true })));
  }

  /** Makes table rows with data-cx-href clickable and keyboard-accessible. */
  CX.rowLinks = (root) => {
    root.querySelectorAll('[data-cx-href]').forEach((row) => {
      const go = (e) => { if (!e.target.closest('a,button')) window.location.hash = row.dataset.cxHref; };
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
    });
  };

  CX.views = CX.views || {};
  CX.views.campaigns = list;
  CX.views.campaign = detail;
})(window.CX);
