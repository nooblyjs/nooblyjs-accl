'use strict';

/**
 * Suppressions (addresses that must not be contacted) and subscription topics.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;

  async function page(el, params) {
    const ref = await CX.marketingRef();
    const q = params.get('q') || '';
    mount(el, h`
      <div class="cx-page-header"><div><h1 class="cx-page-title">Suppressions and topics</h1>
        <p class="cx-page-subtitle">Unsubscribes only stop marketing. Bounces, complaints and manual or legal suppressions stop every message.</p></div>
        <button class="btn btn-primary" data-cx-add><i class="bi bi-plus-lg me-1"></i> Add suppression</button></div>
      <div class="row g-4">
        <div class="col-xl-8">
          <div class="cx-toolbar"><div class="input-group cx-search"><span class="input-group-text"><i class="bi bi-search"></i></span>
            <input type="search" class="form-control" placeholder="Email or phone" aria-label="Search suppressions" value="${q}" data-cx-q></div></div>
          <div class="card cx-table-card" data-cx-list>${ui.loading()}</div>
        </div>
        <div class="col-xl-4"><div class="card"><div class="card-body" data-cx-topics>${ui.loading()}</div></div></div>
      </div>`);
    const qInput = el.querySelector('[data-cx-q]');
    qInput.addEventListener('input', ui.debounce(() => { window.location.hash = `#/suppressions${qInput.value.trim() ? `?q=${encodeURIComponent(qInput.value.trim())}` : ''}`; }, 300));
    if (q) { qInput.focus(); qInput.setSelectionRange(q.length, q.length); }
    el.querySelector('[data-cx-add]').addEventListener('click', async () => {
      const topics = (await api.get('/topics', { limit: 200 })).items;
      ui.formModal({
        title: 'Add suppression',
        fields: [
          { name: 'value', label: 'Email address or phone number', required: true, maxLength: 254 },
          { name: 'scope', label: 'Scope', type: 'select', options: ref.suppressionScopes, required: true, col: 'col-sm-4', default: 'global' },
          { name: 'channel', label: 'Channel', type: 'select', options: ref.channels, col: 'col-sm-4' },
          { name: 'topicId', label: 'Topic', type: 'select', options: topics.map((t) => ({ value: t.key, label: t.name })), col: 'col-sm-4' },
          { name: 'reason', label: 'Reason', type: 'select', options: ref.suppressionReasons, required: true, col: 'col-sm-6', default: 'manual' },
          { name: 'expiresAt', label: 'Expires', type: 'date', col: 'col-sm-6' },
          { name: 'note', label: 'Note', type: 'textarea', rows: 2, maxLength: 500 }
        ],
        submitLabel: 'Add',
        onSubmit: async (payload) => {
          const body = { ...payload, source: 'admin-ui' };
          if (body.expiresAt) body.expiresAt = new Date(`${body.expiresAt}T23:59:59`).toISOString();
          await api.post('/suppressions', body);
          ui.toast('Suppression added');
          page(el, params);
        }
      });
    });

    const listBox = el.querySelector('[data-cx-list]');
    try {
      const result = await api.get('/suppressions', { limit: 200, sort: '-createdAt', q: q || undefined });
      mount(listBox, result.items.length ? h`<div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Address</th><th>Scope</th><th>Reason</th><th class="d-none d-md-table-cell">Added</th><th></th></tr></thead>
        <tbody>${result.items.map((s) => h`<tr><td class="cx-mono small">${s.value}</td>
          <td>${ui.label(s.scope)}${s.channel ? ` · ${s.channel}` : ''}${s.topicId ? ` · ${s.topicId}` : ''}</td>
          <td>${ui.label(s.reason)}${s.expiresAt ? h`<div class="cx-list-sub">until ${ui.fmtDate(s.expiresAt)}</div>` : ''}</td>
          <td class="d-none d-md-table-cell small">${ui.fmtDate(s.createdAt)}<div class="cx-list-sub">${s.source || ''}</div></td>
          <td class="text-end"><button class="cx-icon-btn cx-danger" title="Remove" aria-label="Remove" data-cx-remove="${s.id}"><i class="bi bi-trash"></i></button></td></tr>`)}</tbody>
      </table></div>` : ui.empty('slash-circle', q ? 'No suppressions match.' : 'No suppressions.'));
      listBox.querySelectorAll('[data-cx-remove]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await ui.confirm('Remove suppression?', 'This address may be contacted again (consent still applies to marketing).', { confirmLabel: 'Remove', danger: true }))) return;
        try { await api.del(`/suppressions/${btn.dataset.cxRemove}`); ui.toast('Suppression removed'); page(el, params); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
      }));
    } catch (err) {
      mount(listBox, h`<div class="alert alert-danger m-3">${ui.errorMessage(err)}</div>`);
    }

    const topicsBox = el.querySelector('[data-cx-topics]');
    const drawTopics = async () => {
      const topics = (await api.get('/topics', { limit: 200, sort: 'name' })).items;
      mount(topicsBox, h`<h2 class="cx-section-title"><span>Topics</span><button class="btn btn-sm btn-outline-primary" data-cx-add-topic><i class="bi bi-plus-lg"></i> Add</button></h2>
        ${topics.length ? h`<ul class="cx-list">${topics.map((t) => h`<li><div class="cx-list-main"><div>${t.name}</div><div class="cx-list-sub cx-mono">${t.key}${t.channel ? ` · ${t.channel}` : ''}</div>${t.description ? h`<div class="cx-list-sub">${t.description}</div>` : ''}</div></li>`)}</ul>`
    : h`<p class="text-muted small mb-0">No topics. Topics let customers opt out of one kind of message only.</p>`}`);
      topicsBox.querySelector('[data-cx-add-topic]').addEventListener('click', () => ui.formModal({
        title: 'Add topic',
        size: '',
        fields: [
          { name: 'key', label: 'Key', required: true, col: 'col-sm-5', maxLength: 64, placeholder: 'newsletter' },
          { name: 'name', label: 'Name', required: true, col: 'col-sm-7', maxLength: 100 },
          { name: 'channel', label: 'Channel', type: 'select', options: ref.channels, col: 'col-sm-6' },
          { name: 'description', label: 'Description', type: 'textarea', rows: 2, maxLength: 500 }
        ],
        submitLabel: 'Add topic',
        onSubmit: async (payload) => { await api.post('/topics', payload); ui.toast('Topic added'); drawTopics(); }
      }));
    };
    drawTopics().catch((err) => mount(topicsBox, h`<div class="alert alert-danger mb-0">${ui.errorMessage(err)}</div>`));
  }

  CX.views = CX.views || {};
  CX.views.suppressions = page;
})(window.CX);
