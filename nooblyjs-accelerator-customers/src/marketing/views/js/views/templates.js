'use strict';

/**
 * Templates: list, and an editor with locale variants, declared variables,
 * approval and a live preview (rendered by the API into a sandboxed iframe).
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;

  async function list(el, params) {
    const state = { q: params.get('q') || '', channel: params.get('channel') || '', status: params.get('status') || '' };
    const ref = await CX.marketingRef();
    mount(el, h`
      <div class="cx-page-header">
        <div><h1 class="cx-page-title">Templates</h1><p class="cx-page-subtitle">Email and SMS content. Templates must be approved before they can be sent.</p></div>
        <a class="btn btn-primary" href="#/templates/new"><i class="bi bi-plus-lg me-1"></i> New template</a>
      </div>
      <div class="cx-toolbar">
        <div class="input-group cx-search"><span class="input-group-text"><i class="bi bi-search"></i></span>
          <input type="search" class="form-control" placeholder="Name or key" aria-label="Search templates" value="${state.q}" data-cx-q></div>
        <select class="form-select" aria-label="Channel" data-cx-filter="channel"><option value="">All channels</option>${ref.channels.map((c) => h`<option value="${c}" ${c === state.channel ? ui.raw('selected') : ''}>${ui.label(c)}</option>`)}</select>
        <select class="form-select" aria-label="Status" data-cx-filter="status"><option value="">All statuses</option>${ref.templateStatuses.map((c) => h`<option value="${c}" ${c === state.status ? ui.raw('selected') : ''}>${ui.label(c)}</option>`)}</select>
      </div>
      <div class="card cx-table-card" data-cx-results>${ui.loading()}</div>`);
    const navigate = (changes) => {
      const qs = new URLSearchParams(Object.entries({ ...state, ...changes }).filter(([, v]) => v));
      window.location.hash = `#/templates${qs.toString() ? `?${qs}` : ''}`;
    };
    const qInput = el.querySelector('[data-cx-q]');
    qInput.addEventListener('input', ui.debounce(() => navigate({ q: qInput.value.trim() }), 300));
    if (state.q) { qInput.focus(); qInput.setSelectionRange(qInput.value.length, qInput.value.length); }
    el.querySelectorAll('[data-cx-filter]').forEach((s) => s.addEventListener('change', () => navigate({ [s.dataset.cxFilter]: s.value })));

    const results = el.querySelector('[data-cx-results]');
    try {
      const query = { limit: 200, sort: 'name', q: state.q || undefined };
      if (state.channel) query['filter[channel]'] = state.channel;
      if (state.status) query['filter[status]'] = state.status;
      const page = await api.get('/templates', query);
      if (!page.items.length) { mount(results, ui.empty('file-earmark-richtext', 'No templates found.')); return; }
      mount(results, h`<div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>Template</th><th>Channel</th><th>Category</th><th>Status</th><th class="d-none d-md-table-cell">Locales</th><th class="d-none d-lg-table-cell">Updated</th></tr></thead>
        <tbody>${page.items.map((t) => h`<tr class="cx-row-link" data-cx-href="#/templates/${t.id}" tabindex="0">
          <td><a href="#/templates/${t.id}" class="fw-semibold text-decoration-none">${t.name}</a><div class="cx-list-sub cx-mono">${t.key} · rev ${t.revision}</div></td>
          <td><i class="bi bi-${t.channel === 'email' ? 'envelope' : 'chat-text'} me-1"></i>${ui.label(t.channel)}</td><td>${ui.label(t.category)}</td>
          <td>${ui.status(t.status)}</td><td class="d-none d-md-table-cell">${(t.locales || []).map((l) => l.locale).join(', ')}</td><td class="d-none d-lg-table-cell">${ui.fmtDate(t.updatedAt)}</td></tr>`)}</tbody>
      </table></div>`);
      CX.rowLinks(results);
    } catch (err) {
      mount(results, h`<div class="alert alert-danger m-3">${ui.errorMessage(err)}</div>`);
    }
  }

  async function editor(el, params, id) {
    mount(el, ui.loading());
    const ref = await CX.marketingRef();
    const isNew = id === 'new';
    let t;
    try {
      t = isNew ? { channel: 'email', category: 'marketing', defaultLocale: 'en', locales: [{ locale: 'en', subject: '', bodyHtml: '', bodyText: '' }], variables: [], status: 'draft' }
        : await api.get(`/templates/${encodeURIComponent(id)}`);
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${err.status === 404 ? 'This template does not exist.' : ui.errorMessage(err)}</div><a href="#/templates" class="btn btn-secondary">Back</a>`);
      return;
    }
    let active = 0;
    const locales = (t.locales || []).map((l) => ({ ...l }));
    const readOnly = t.status === 'retired';

    mount(el, h`
      <nav aria-label="breadcrumb" class="mb-3"><ol class="breadcrumb mb-0">
        <li class="breadcrumb-item"><a href="#/templates">Templates</a></li><li class="breadcrumb-item active" aria-current="page">${isNew ? 'New' : t.key}</li></ol></nav>
      <form novalidate data-cx-form>
      <div class="cx-page-header">
        <div><h1 class="cx-page-title">${isNew ? 'New template' : t.name}</h1>
          <div class="cx-hero-meta">${isNew ? '' : h`<span class="cx-mono">${t.key} · revision ${t.revision}</span>${ui.status(t.status)}${t.approvedAt ? h`<span>approved ${ui.fmtDateTime(t.approvedAt)} by ${t.approvedBy}</span>` : ''}`}</div></div>
        <div class="d-flex flex-wrap gap-2">
          ${!isNew && t.status === 'draft' ? h`<button type="button" class="btn btn-secondary" data-cx-approve><i class="bi bi-check2-circle me-1"></i>Approve</button>` : ''}
          ${!isNew && t.status !== 'retired' ? h`<button type="button" class="btn btn-outline-danger" data-cx-retire>Retire</button>` : ''}
          ${readOnly ? '' : h`<button type="submit" class="btn btn-primary"><i class="bi bi-floppy me-1"></i>Save</button>`}
        </div>
      </div>
      <div class="alert alert-danger d-none" role="alert" data-cx-error></div>
      ${t.status === 'approved' ? h`<div class="alert alert-warning small">Editing the content creates a new revision and returns the template to draft until it is approved again.</div>` : ''}
      <div class="row g-4">
        <div class="col-xl-6">
          <div class="card mb-4"><div class="card-body"><div class="row g-3">
            <div class="col-sm-6"><label class="form-label" for="t-name">Name <span class="text-danger">*</span></label><input class="form-control" id="t-name" name="name" maxlength="200" value="${t.name || ''}" required></div>
            <div class="col-sm-6"><label class="form-label" for="t-key">Key <span class="text-danger">*</span></label><input class="form-control cx-code" id="t-key" name="key" maxlength="64" value="${t.key || ''}" ${isNew ? '' : ui.raw('readonly')} placeholder="order-confirmation"></div>
            <div class="col-sm-4"><label class="form-label" for="t-channel">Channel</label><select class="form-select" id="t-channel" name="channel" ${isNew ? '' : ui.raw('disabled')}>${ref.channels.map((c) => h`<option value="${c}" ${c === t.channel ? ui.raw('selected') : ''}>${ui.label(c)}</option>`)}</select></div>
            <div class="col-sm-4"><label class="form-label" for="t-category">Category</label><select class="form-select" id="t-category" name="category">${ref.templateCategories.map((c) => h`<option value="${c}" ${c === t.category ? ui.raw('selected') : ''}>${ui.label(c)}</option>`)}</select></div>
            <div class="col-sm-4"><label class="form-label" for="t-default">Default locale</label><input class="form-control" id="t-default" name="defaultLocale" maxlength="35" value="${t.defaultLocale || 'en'}"></div>
          </div></div></div>

          <div class="card mb-4"><div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-2"><ul class="nav nav-tabs" data-cx-locale-tabs></ul>
              <button type="button" class="btn btn-sm btn-secondary" data-cx-add-locale><i class="bi bi-plus-lg"></i> Locale</button></div>
            <div data-cx-locale></div>
            <p class="small text-muted mt-2 mb-0">Use <span class="cx-mono">{{customer.preferredName}}</span>, <span class="cx-mono">{{customer.givenName}}</span>, <span class="cx-mono">{{unsubscribeUrl}}</span>, <span class="cx-mono">{{campaign.name}}</span>, declared variables, and sections <span class="cx-mono">{{#items}}…{{/items}}</span>. Links are tracked automatically.</p>
          </div></div>

          <div class="card"><div class="card-body">
            <label class="form-label" for="t-vars">Declared variables (JSON)</label>
            <textarea class="form-control cx-code" id="t-vars" name="variables" rows="6" spellcheck="false">${JSON.stringify(t.variables || [], null, 2)}</textarea>
            <div class="form-text">For transactional data, e.g. <span class="cx-mono">[{ "name": "order.number", "required": true, "sample": "ORD-1001" }]</span>.</div>
          </div></div>
        </div>
        <div class="col-xl-6"><div class="card"><div class="card-body">
          <h2 class="cx-section-title"><span>Preview</span><button type="button" class="btn btn-sm btn-secondary" data-cx-preview><i class="bi bi-arrow-clockwise"></i> Refresh</button></h2>
          <div data-cx-preview-box>${isNew ? h`<p class="text-muted small">Save the template to preview it.</p>` : ui.loading()}</div>
        </div></div></div>
      </div></form>`);

    const form = el.querySelector('[data-cx-form]');
    const channel = () => form.elements.channel.value;
    const saveActive = () => {
      const box = el.querySelector('[data-cx-locale]');
      if (!box.firstElementChild) return;
      const l = locales[active];
      l.locale = box.querySelector('[name=locale]').value.trim();
      for (const f of ['subject', 'preheader', 'bodyHtml', 'bodyText', 'smsText']) {
        const input = box.querySelector(`[name=${f}]`);
        if (input) l[f] = input.value;
      }
    };
    const drawLocale = () => {
      mount(el.querySelector('[data-cx-locale-tabs]'), h`${locales.map((l, i) => h`<li class="nav-item"><a href="#" class="nav-link ${i === active ? 'active' : ''}" data-cx-tab="${i}">${l.locale || '?'}</a></li>`)}`);
      const l = locales[active] || {};
      mount(el.querySelector('[data-cx-locale]'), h`<div class="row g-3 mt-1">
        <div class="col-sm-4"><label class="form-label" for="l-locale">Locale</label><input class="form-control" id="l-locale" name="locale" maxlength="35" value="${l.locale || ''}"></div>
        ${channel() === 'email' ? h`
        <div class="col-sm-8"><label class="form-label" for="l-subject">Subject</label><input class="form-control" id="l-subject" name="subject" maxlength="300" value="${l.subject || ''}"></div>
        <div class="col-12"><label class="form-label" for="l-pre">Preheader</label><input class="form-control" id="l-pre" name="preheader" maxlength="300" value="${l.preheader || ''}"></div>
        <div class="col-12"><label class="form-label" for="l-html">HTML body</label><textarea class="form-control cx-code" id="l-html" name="bodyHtml" rows="12" spellcheck="false">${l.bodyHtml || ''}</textarea></div>
        <div class="col-12"><label class="form-label" for="l-text">Plain-text body</label><textarea class="form-control cx-code" id="l-text" name="bodyText" rows="4">${l.bodyText || ''}</textarea></div>`
    : h`<div class="col-12"><label class="form-label" for="l-sms">SMS text</label><textarea class="form-control" id="l-sms" name="smsText" rows="4" maxlength="1600">${l.smsText || ''}</textarea>
          <div class="form-text" data-cx-sms-count></div></div>`}
        ${locales.length > 1 ? h`<div class="col-12"><button type="button" class="btn btn-sm btn-outline-danger" data-cx-remove-locale>Remove this locale</button></div>` : ''}
      </div>`);
      el.querySelectorAll('[data-cx-tab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); saveActive(); active = Number(a.dataset.cxTab); drawLocale(); preview(); }));
      const rm = el.querySelector('[data-cx-remove-locale]');
      if (rm) rm.addEventListener('click', () => { locales.splice(active, 1); active = 0; drawLocale(); });
      const sms = el.querySelector('[name=smsText]');
      if (sms) {
        const count = () => { const n = sms.value.length; el.querySelector('[data-cx-sms-count]').textContent = `${n} characters · about ${Math.max(1, Math.ceil(n / 153))} SMS segment(s) before variables`; };
        sms.addEventListener('input', count);
        count();
      }
      if (readOnly) el.querySelectorAll('[data-cx-locale] input, [data-cx-locale] textarea').forEach((x) => { x.readOnly = true; });
    };
    drawLocale();
    if (isNew) form.elements.channel.addEventListener('change', () => { saveActive(); drawLocale(); });
    el.querySelector('[data-cx-add-locale]').addEventListener('click', () => {
      saveActive();
      locales.push({ locale: '', subject: locales[0] ? locales[0].subject : '' });
      active = locales.length - 1;
      drawLocale();
      el.querySelector('[name=locale]').focus();
    });

    async function preview() {
      if (isNew) return;
      const box = el.querySelector('[data-cx-preview-box]');
      try {
        const r = await api.post(`/templates/${t.id}:preview`, { locale: (locales[active] || {}).locale });
        if (t.channel === 'sms') {
          mount(box, h`<div class="cx-sms-bubble">${r.bodyText}</div>`);
          return;
        }
        mount(box, h`<div class="cx-preview-subject">${r.subject || '(no subject)'}</div>
          ${r.bodyHtml ? h`<iframe class="cx-preview-frame" title="Email preview" sandbox="" data-cx-frame></iframe>` : h`<pre class="cx-code mb-0">${r.bodyText}</pre>`}`);
        const frame = box.querySelector('[data-cx-frame]');
        if (frame) frame.srcdoc = r.bodyHtml;
      } catch (err) {
        mount(box, h`<div class="alert alert-warning mb-0">${ui.errorMessage(err)}</div>`);
      }
    }
    el.querySelector('[data-cx-preview]').addEventListener('click', preview);
    preview();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      saveActive();
      const alertBox = el.querySelector('[data-cx-error]');
      alertBox.classList.add('d-none');
      let variables;
      try {
        variables = JSON.parse(form.elements.variables.value || '[]');
      } catch {
        alertBox.textContent = 'Declared variables must be valid JSON.';
        alertBox.classList.remove('d-none');
        return;
      }
      const clean = (l) => {
        const out = { locale: l.locale };
        for (const f of channel() === 'email' ? ['subject', 'preheader', 'bodyHtml', 'bodyText'] : ['smsText']) if (l[f]) out[f] = l[f];
        return out;
      };
      const body = {
        name: form.elements.name.value.trim(),
        category: form.elements.category.value,
        defaultLocale: form.elements.defaultLocale.value.trim() || 'en',
        locales: locales.map(clean),
        variables
      };
      try {
        if (isNew) {
          const created = await api.post('/templates', { ...body, key: form.elements.key.value.trim(), channel: channel() });
          ui.toast('Template created');
          window.location.hash = `#/templates/${created.id}`;
        } else {
          await api.patch(`/templates/${t.id}`, body, t.version);
          ui.toast('Template saved');
          editor(el, params, id);
        }
      } catch (err) {
        alertBox.textContent = `${ui.errorMessage(err)}${err.details && err.details.length ? ` — ${err.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : ''}`;
        alertBox.classList.remove('d-none');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    const approve = el.querySelector('[data-cx-approve]');
    if (approve) approve.addEventListener('click', async () => {
      try { await api.post(`/templates/${t.id}:approve`, {}); ui.toast('Template approved'); editor(el, params, id); } catch (err) { ui.toast(`${ui.errorMessage(err)}${err.details && err.details.length ? `: ${err.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : ''}`, { error: true }); }
    });
    const retire = el.querySelector('[data-cx-retire]');
    if (retire) retire.addEventListener('click', async () => {
      if (!(await ui.confirm('Retire template?', 'Retired templates cannot be sent or edited. Past communications keep their content.', { confirmLabel: 'Retire', danger: true }))) return;
      try { await api.post(`/templates/${t.id}:retire`, {}); ui.toast('Template retired'); editor(el, params, id); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    });
  }

  CX.views = CX.views || {};
  CX.views.templates = list;
  CX.views.template = editor;
})(window.CX);
