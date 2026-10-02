'use strict';

/**
 * Message detail (definition, actions, stats, recipients) and the message
 * form with its audience rule builder.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;
  const DONE = { schedule: 'scheduled', pause: 'paused', resume: 'resumed', cancel: 'cancelled' };
  const OPS = [['eq', 'is'], ['ne', 'is not'], ['in', 'is one of'], ['contains', 'contains'], ['prefix', 'starts with'], ['gte', '≥'], ['lte', '≤'], ['exists', 'exists']];

  const localInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  function ruleRow(ref, f = {}) {
    const value = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '');
    return h`<div class="cx-rule-row" data-cx-rule>
      <select class="form-select form-select-sm" aria-label="Field" data-cx-field>${ref.audienceFields.map((x) => h`<option value="${x}" ${x === f.field ? ui.raw('selected') : ''}>${x}</option>`)}</select>
      <select class="form-select form-select-sm" aria-label="Operator" data-cx-op>${OPS.map(([v, l]) => h`<option value="${v}" ${v === (f.op || 'eq') ? ui.raw('selected') : ''}>${l}</option>`)}</select>
      <input class="form-control form-control-sm" aria-label="Value" data-cx-value value="${value}" placeholder="value">
      <button type="button" class="cx-icon-btn cx-danger" aria-label="Remove condition" data-cx-remove-rule><i class="bi bi-x-lg"></i></button>
    </div>`;
  }

  function readRules(form) {
    return [...form.querySelectorAll('[data-cx-rule]')].map((row) => {
      const field = row.querySelector('[data-cx-field]').value;
      const op = row.querySelector('[data-cx-op]').value;
      const raw = row.querySelector('[data-cx-value]').value.trim();
      let value = raw;
      if (op === 'in') value = raw.split(',').map((s) => s.trim()).filter(Boolean);
      else if (op === 'exists') value = raw !== 'false';
      else if (raw === 'true' || raw === 'false') value = raw === 'true';
      return { field, op, value };
    }).filter((f) => f.op === 'exists' || (Array.isArray(f.value) ? f.value.length : f.value !== ''));
  }

  /**
   * Opens the create/edit message form.
   *
   * @param {Object} opts - `{ campaign, message? }`
   */
  async function open({ campaign, message }) {
    const [ref, templates, topics] = await Promise.all([
      CX.marketingRef(),
      api.get('/templates', { limit: 200, sort: 'name', 'filter[status][in]': 'draft,approved' }).then((p) => p.items),
      api.get('/topics', { limit: 200 }).then((p) => p.items).catch(() => [])
    ]);
    const m = message || { channel: 'email', schedule: { type: 'immediate' }, audience: { rule: { filters: [{ field: 'status', op: 'eq', value: 'active' }] } }, respectQuietHours: true, respectFrequencyCap: true };
    const rules = (m.audience && m.audience.rule && m.audience.rule.filters) || [];
    const ids = (m.audience && m.audience.customerIds) || [];
    const tplOptions = (channel) => templates.filter((t) => t.channel === channel)
      .map((t) => h`<option value="${t.id}" ${t.id === m.templateId ? ui.raw('selected') : ''}>${t.name}${t.status === 'approved' ? '' : ' (draft)'}</option>`);
    const { el, modal } = ui.createModal(h`
      <form novalidate>
        <div class="modal-header"><h5 class="modal-title">${message ? `Edit ${message.name}` : `New message in ${campaign.name}`}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body">
          <div class="alert alert-danger d-none" role="alert" data-cx-error></div>
          <div class="row g-3">
            <div class="col-sm-8"><label class="form-label" for="m-name">Name <span class="text-danger">*</span></label><input class="form-control" id="m-name" name="name" maxlength="200" value="${m.name || ''}" required></div>
            <div class="col-sm-4"><label class="form-label" for="m-channel">Channel</label>
              <select class="form-select" id="m-channel" name="channel">${ref.channels.map((c) => h`<option value="${c}" ${c === m.channel ? ui.raw('selected') : ''}>${ui.label(c)}</option>`)}</select></div>
            <div class="col-sm-8"><label class="form-label" for="m-template">Template <span class="text-danger">*</span></label>
              <select class="form-select" id="m-template" name="templateId" required data-cx-templates>${tplOptions(m.channel)}</select>
              <div class="form-text">Only approved templates can be scheduled. <a href="#/templates/new" data-bs-dismiss="modal">New template</a></div></div>
            <div class="col-sm-4"><label class="form-label" for="m-topic">Topic</label>
              <select class="form-select" id="m-topic" name="topicId"><option value="">Campaign default${campaign.topicId ? ` (${campaign.topicId})` : ''}</option>
              ${topics.map((t) => h`<option value="${t.key}" ${t.key === m.topicId ? ui.raw('selected') : ''}>${t.name}</option>`)}</select></div>

            <div class="col-12"><h6 class="mt-2 mb-2">Audience</h6>
              <p class="small text-muted mb-2">Customers matching all conditions, plus any listed ids. Consent, suppressions, frequency caps and quiet hours are applied at send time.</p>
              <div data-cx-rules>${rules.map((f) => ruleRow(ref, f))}</div>
              <button type="button" class="btn btn-sm btn-secondary" data-cx-add-rule><i class="bi bi-plus-lg"></i> Add condition</button>
              <span class="ms-2 small" data-cx-count aria-live="polite"></span>
            </div>
            <div class="col-12"><label class="form-label" for="m-ids">Customer ids</label>
              <textarea class="form-control cx-code" id="m-ids" name="customerIds" rows="2" placeholder="one per line or comma-separated">${ids.join('\n')}</textarea></div>

            <div class="col-12"><h6 class="mt-2 mb-0">Schedule</h6></div>
            <div class="col-sm-4"><label class="form-label" for="m-stype">When</label>
              <select class="form-select" id="m-stype" name="scheduleType">${[['immediate', 'As soon as scheduled'], ['at', 'At a date and time'], ['recurring', 'Recurring (cron)']]
    .map(([v, l]) => h`<option value="${v}" ${v === (m.schedule && m.schedule.type) ? ui.raw('selected') : ''}>${l}</option>`)}</select></div>
            <div class="col-sm-4" data-cx-at><label class="form-label" for="m-at">Send at</label><input class="form-control" type="datetime-local" id="m-at" name="at" value="${localInput(m.schedule && m.schedule.at)}"></div>
            <div class="col-sm-4" data-cx-cron><label class="form-label" for="m-cron">Cron</label><input class="form-control cx-code" id="m-cron" name="cron" value="${(m.schedule && m.schedule.cron) || ''}" placeholder="0 9 * * 1"></div>
            <div class="col-sm-4"><label class="form-label" for="m-throttle">Max per minute</label><input class="form-control" type="number" min="1" id="m-throttle" name="perMinute" value="${(m.throttle && m.throttle.perMinute) || ''}"></div>
            <div class="col-sm-4"><div class="form-check mt-sm-4"><input class="form-check-input" type="checkbox" id="m-quiet" name="respectQuietHours" ${m.respectQuietHours !== false ? ui.raw('checked') : ''}><label class="form-check-label" for="m-quiet">Respect quiet hours</label></div></div>
            <div class="col-sm-4"><div class="form-check mt-sm-4"><input class="form-check-input" type="checkbox" id="m-cap" name="respectFrequencyCap" ${m.respectFrequencyCap !== false ? ui.raw('checked') : ''}><label class="form-check-label" for="m-cap">Respect frequency cap</label></div></div>
            <div class="col-sm-6" data-cx-email-only><label class="form-label" for="m-from">From address</label><input class="form-control" type="email" id="m-from" name="fromAddress" value="${(m.from && m.from.address) || ''}" placeholder="news@example.com"></div>
            <div class="col-sm-6" data-cx-email-only><label class="form-label" for="m-fromname">From name</label><input class="form-control" id="m-fromname" name="fromName" value="${(m.from && m.from.name) || ''}" maxlength="100"></div>
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button><button type="submit" class="btn btn-primary">${message ? 'Save' : 'Create message'}</button></div>
      </form>`, { size: 'modal-lg' });
    const form = el.querySelector('form');
    const rulesBox = el.querySelector('[data-cx-rules]');
    const countBox = el.querySelector('[data-cx-count]');

    const audience = () => {
      const filters = readRules(form);
      const customerIds = form.elements.customerIds.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const a = {};
      if (filters.length) a.rule = { filters };
      if (customerIds.length) a.customerIds = customerIds;
      return a;
    };
    const recount = ui.debounce(async () => {
      const a = audience();
      if (!a.rule && !a.customerIds) { countBox.textContent = 'No audience yet'; return; }
      try {
        const r = await api.post('/messages:preview-audience', { audience: a });
        countBox.textContent = `${r.count.toLocaleString()} customer${r.count === 1 ? '' : 's'} match`;
      } catch (err) { countBox.textContent = ui.errorMessage(err); }
    }, 400);
    const bindRow = (row) => {
      row.querySelector('[data-cx-remove-rule]').addEventListener('click', () => { row.remove(); recount(); });
      row.querySelectorAll('select,input').forEach((x) => x.addEventListener('input', recount));
    };
    rulesBox.querySelectorAll('[data-cx-rule]').forEach(bindRow);
    el.querySelector('[data-cx-add-rule]').addEventListener('click', () => {
      rulesBox.insertAdjacentHTML('beforeend', ruleRow(ref, { field: 'countryCode', op: 'eq' }).__html);
      bindRow(rulesBox.lastElementChild);
    });
    form.elements.customerIds.addEventListener('input', recount);
    const syncSchedule = () => {
      const type = form.elements.scheduleType.value;
      el.querySelector('[data-cx-at]').classList.toggle('d-none', type !== 'at');
      el.querySelector('[data-cx-cron]').classList.toggle('d-none', type !== 'recurring');
    };
    const syncChannel = () => {
      const channel = form.elements.channel.value;
      mount(el.querySelector('[data-cx-templates]'), h`${tplOptions(channel)}`);
      el.querySelectorAll('[data-cx-email-only]').forEach((x) => x.classList.toggle('d-none', channel !== 'email'));
    };
    form.elements.scheduleType.addEventListener('change', syncSchedule);
    form.elements.channel.addEventListener('change', syncChannel);
    syncSchedule();
    el.querySelectorAll('[data-cx-email-only]').forEach((x) => x.classList.toggle('d-none', m.channel !== 'email'));
    recount();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = form.elements;
      const type = f.scheduleType.value;
      const body = {
        name: f.name.value.trim(),
        channel: f.channel.value,
        templateId: f.templateId.value,
        topicId: f.topicId.value || (message ? null : undefined),
        audience: audience(),
        schedule: { type, ...(type === 'at' && f.at.value ? { at: new Date(f.at.value).toISOString() } : {}), ...(type === 'recurring' ? { cron: f.cron.value.trim() } : {}) },
        throttle: f.perMinute.value ? { perMinute: Number(f.perMinute.value) } : (message ? null : undefined),
        respectQuietHours: f.respectQuietHours.checked,
        respectFrequencyCap: f.respectFrequencyCap.checked
      };
      if (body.channel === 'email' && (f.fromAddress.value.trim() || f.fromName.value.trim())) {
        body.from = { address: f.fromAddress.value.trim() || undefined, name: f.fromName.value.trim() || undefined };
      }
      if (!message) body.campaignId = campaign.id;
      const alertBox = el.querySelector('[data-cx-error]');
      alertBox.classList.add('d-none');
      try {
        const saved = message ? await api.patch(`/messages/${message.id}`, body, message.version) : await api.post('/messages', body);
        modal.hide();
        ui.toast(message ? 'Message saved' : 'Message created');
        if (message) CX.views.message(document.getElementById('cx-main'), new URLSearchParams(), message.id);
        else window.location.hash = `#/messages/${saved.id}`;
      } catch (err) {
        alertBox.textContent = `${ui.errorMessage(err)}${err.details && err.details.length ? `: ${err.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : ''}`;
        alertBox.classList.remove('d-none');
      }
    });
  }

  async function detail(el, params, id) {
    mount(el, ui.loading());
    let message; let campaign; let template; let stats;
    try {
      message = await api.get(`/messages/${encodeURIComponent(id)}`);
      [campaign, template, stats] = await Promise.all([
        api.get(`/campaigns/${message.campaignId}`),
        api.get(`/templates/${message.templateId}`).catch(() => null),
        api.get(`/messages/${message.id}/stats`)
      ]);
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${err.status === 404 ? 'This message does not exist.' : ui.errorMessage(err)}</div><a href="#/campaigns" class="btn btn-secondary">Back</a>`);
      return;
    }
    const refresh = () => detail(el, params, id);
    const s = message.status;
    const actions = [];
    if (['draft', 'paused'].includes(s)) actions.push(['edit', 'Edit', 'pencil', 'btn-secondary']);
    actions.push(['test-send', 'Test send', 'send-check', 'btn-secondary']);
    if (s === 'draft') actions.push(['schedule', message.schedule && message.schedule.type !== 'immediate' ? 'Schedule' : 'Send now', 'send', 'btn-primary']);
    if (['scheduled', 'sending'].includes(s)) actions.push(['pause', 'Pause', 'pause-fill', 'btn-secondary']);
    if (s === 'paused') actions.push(['resume', 'Resume', 'play-fill', 'btn-primary']);
    if (!['sent', 'cancelled'].includes(s)) actions.push(['cancel', 'Cancel', 'x-circle', 'btn-outline-danger']);
    const schedule = message.schedule || { type: 'immediate' };
    const rules = (message.audience.rule && message.audience.rule.filters) || [];
    const pct = (n) => (stats.sent ? Math.round((n / stats.sent) * 100) : 0);

    mount(el, h`
      <nav aria-label="breadcrumb" class="mb-3"><ol class="breadcrumb mb-0">
        <li class="breadcrumb-item"><a href="#/campaigns">Campaigns</a></li>
        <li class="breadcrumb-item"><a href="#/campaigns/${campaign.id}">${campaign.name}</a></li>
        <li class="breadcrumb-item active" aria-current="page">${message.number}</li></ol></nav>
      <div class="card mb-4"><div class="card-body cx-hero">
        <div><h1 class="cx-hero-name">${message.name}</h1>
          <div class="cx-hero-meta"><span class="cx-mono">${message.number}</span>${ui.status(s)}<span><i class="bi bi-${message.channel === 'email' ? 'envelope' : 'chat-text'} me-1"></i>${ui.label(message.channel)}</span>
          ${message.nextRunAt ? h`<span>next run ${ui.fmtDateTime(message.nextRunAt)}</span>` : ''}${message.runCount ? h`<span>${message.runCount} run${message.runCount === 1 ? '' : 's'}</span>` : ''}</div></div>
        <div class="d-flex flex-wrap gap-2">${actions.map(([a, label, icon, cls]) => h`<button class="btn btn-sm ${cls}" data-cx-action="${a}"><i class="bi bi-${icon} me-1"></i>${label}</button>`)}</div>
      </div></div>

      <div class="row g-3 mb-4 cx-funnel">
        ${[['Recipients', stats.total, ''], ['Sent', stats.sent, ''], ['Opened', stats.opened, `${pct(stats.opened)}%`], ['Clicked', stats.clicked, `${pct(stats.clicked)}%`], ['Unsubscribed', stats.unsubscribed, `${pct(stats.unsubscribed)}%`], ['Not sent', (stats.byStatus.skipped || 0) + (stats.byStatus.suppressed || 0) + (stats.byStatus.failed || 0), '']]
    .map(([label, value, extra]) => h`<div class="col-6 col-md-4 col-xl-2"><div class="cx-stat"><div class="cx-stat-label">${label}</div><div class="cx-stat-value">${value.toLocaleString()}${extra ? h`<small>${extra}</small>` : ''}</div></div></div>`)}
      </div>
      ${Object.keys(stats.bySkipReason).length ? h`<div class="cx-skip-list mb-4">${Object.entries(stats.bySkipReason).map(([r, n]) => h`<span class="cx-status cx-status-skipped">${ui.label(r)}: ${n}</span>`)}</div>` : ''}

      <div class="row g-4">
        <div class="col-lg-4"><div class="card"><div class="card-body">
          <h2 class="cx-section-title">Definition</h2>
          <dl class="cx-kv">
            <dt>Template</dt><dd>${template ? h`<a href="#/templates/${template.id}">${template.name}</a> ${ui.status(template.status)}` : '—'}</dd>
            <dt>Purpose</dt><dd>${ui.label(message.purpose)}</dd>
            <dt>Topic</dt><dd>${message.topicId || campaign.topicId || '—'}</dd>
            <dt>Schedule</dt><dd>${schedule.type === 'at' ? `at ${ui.fmtDateTime(schedule.at)}` : schedule.type === 'recurring' ? h`<span class="cx-mono">${schedule.cron}</span>` : 'immediately'}</dd>
            <dt>Throttle</dt><dd>${message.throttle && message.throttle.perMinute ? `${message.throttle.perMinute}/min` : '—'}</dd>
            <dt>Quiet hours</dt><dd>${message.respectQuietHours !== false ? 'respected' : 'ignored'}</dd>
            <dt>Frequency cap</dt><dd>${message.respectFrequencyCap !== false ? 'respected' : 'ignored'}</dd>
            <dt>Audience</dt><dd>${rules.length ? rules.map((f) => h`<div class="cx-mono small">${f.field} ${f.op} ${Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}</div>`) : ''}
              ${message.audience.customerIds && message.audience.customerIds.length ? h`<div class="small">${message.audience.customerIds.length} listed customer(s)</div>` : ''}</dd>
          </dl></div></div></div>
        <div class="col-lg-8"><div class="card cx-table-card" data-cx-comms>${ui.loading()}</div></div>
      </div>`);

    el.querySelectorAll('[data-cx-action]').forEach((btn) => btn.addEventListener('click', async () => {
      const a = btn.dataset.cxAction;
      if (a === 'edit') { open({ campaign, message }).catch((err) => ui.toast(ui.errorMessage(err), { error: true })); return; }
      if (a === 'test-send') { testSend(message); return; }
      if (a === 'cancel' && !(await ui.confirm('Cancel message?', 'Queued and deferred recipients will be skipped. This cannot be undone.', { confirmLabel: 'Cancel message', danger: true }))) return;
      if (a === 'schedule' && !(await ui.confirm(schedule.type === 'immediate' ? 'Send now?' : 'Schedule message?', schedule.type === 'immediate' ? 'The message goes to every eligible customer in the audience.' : 'The message will send at its scheduled time.', { confirmLabel: schedule.type === 'immediate' ? 'Send now' : 'Schedule' }))) return;
      btn.disabled = true;
      try { await api.post(`/messages/${message.id}:${a}`, {}); ui.toast(`Message ${DONE[a]}`); refresh(); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); btn.disabled = false; }
    }));
    CX.views.communicationsTable(el.querySelector('[data-cx-comms]'), { 'filter[origin.messageId]': message.id }, { title: 'Recipients' });
  }

  function testSend(message) {
    ui.formModal({
      title: 'Send a test',
      size: '',
      intro: 'Sends one copy now, without consent checks or tracking. Give a customer id to render with their details, or an address to use sample data.',
      fields: [
        { name: 'to', label: message.channel === 'email' ? 'Email address' : 'Phone (E.164)', type: message.channel === 'email' ? 'email' : 'tel' },
        { name: 'customerId', label: 'Or customer id', maxLength: 64 }
      ],
      submitLabel: 'Send test',
      onSubmit: async (payload) => {
        const comm = await api.post(`/messages/${message.id}:test-send`, payload);
        ui.toast(comm.status === 'sent' ? 'Test sent' : `Test not sent: ${ui.label(comm.skipReason || comm.error || comm.status)}`, { error: comm.status !== 'sent' });
      }
    });
  }

  CX.messageForm = { open };
  CX.views = CX.views || {};
  CX.views.message = detail;
})(window.CX);
