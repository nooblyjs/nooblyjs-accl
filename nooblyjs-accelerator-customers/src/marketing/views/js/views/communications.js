'use strict';

/**
 * Communications sent: a filterable log, a reusable recipients table and a
 * detail dialog with the rendered message and its engagement events.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount } = CX.ui;
  const ui = CX.ui;
  const { api } = CX;
  const PAGE = 25;

  /**
   * Renders a paged communications table into a card.
   *
   * @param {HTMLElement} el - Container (a `.card`)
   * @param {Object} filters - Query parameters (`filter[...]`)
   * @param {Object} [opts] - `{ title }`
   */
  async function table(el, filters, { title = 'Communications' } = {}) {
    let offset = 0;
    const load = async () => {
      mount(el, ui.loading());
      try {
        const page = await api.get('/communications', { ...filters, limit: PAGE, offset, sort: '-createdAt' });
        mount(el, h`
          <div class="card-body pb-0"><h2 class="cx-section-title">${title} <span class="text-muted small">${page.total.toLocaleString()}</span></h2></div>
          ${page.items.length ? h`<div class="table-responsive"><table class="table align-middle">
            <thead><tr><th>Recipient</th><th>Status</th><th class="d-none d-md-table-cell">Subject</th><th class="d-none d-lg-table-cell">Engagement</th><th class="d-none d-sm-table-cell">When</th></tr></thead>
            <tbody>${page.items.map((c) => h`<tr class="cx-row-link" tabindex="0" data-cx-comm="${c.id}">
              <td><div class="cx-mono small">${c.to || '—'}</div>${c.customerId ? h`<a class="small" href="../customer/#/customers/${c.customerId}">customer</a>` : h`<span class="small text-muted">${ui.label(c.origin.type)}</span>`}</td>
              <td>${ui.status(c.status)}${c.skipReason ? h`<div class="cx-list-sub">${ui.label(c.skipReason)}</div>` : ''}${c.deferReason ? h`<div class="cx-list-sub">${ui.label(c.deferReason)} until ${ui.fmtDateTime(c.deferUntil)}</div>` : ''}</td>
              <td class="d-none d-md-table-cell small">${(c.rendered && (c.rendered.subject || (c.rendered.bodyText || '').slice(0, 60))) || '—'}</td>
              <td class="d-none d-lg-table-cell small">${[c.firstOpenedAt ? h`<span class="me-2"><i class="bi bi-envelope-open me-1"></i>${c.openCount}</span>` : '', c.firstClickedAt ? h`<span class="me-2"><i class="bi bi-cursor me-1"></i>${c.clickCount}</span>` : '', c.unsubscribedAt ? h`<span class="cx-status cx-status-opt_out">Unsubscribed</span>` : '']}</td>
              <td class="d-none d-sm-table-cell small text-nowrap">${ui.fmtDateTime(c.sentAt || c.queuedAt)}</td></tr>`)}</tbody>
          </table></div>
          <div class="cx-pager"><span>${page.offset + 1}–${page.offset + page.items.length} of ${page.total}</span>
            <div class="btn-group"><button class="btn btn-sm btn-secondary" data-cx-prev ${offset === 0 ? ui.raw('disabled') : ''}><i class="bi bi-chevron-left"></i></button>
            <button class="btn btn-sm btn-secondary" data-cx-next ${page.nextCursor ? '' : ui.raw('disabled')}><i class="bi bi-chevron-right"></i></button></div></div>`
    : ui.empty('send', 'Nothing here yet.')}`);
        el.querySelectorAll('[data-cx-comm]').forEach((row) => {
          const go = (e) => { if (!e.target.closest('a')) show(row.dataset.cxComm); };
          row.addEventListener('click', go);
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
        });
        const prev = el.querySelector('[data-cx-prev]');
        if (prev) prev.addEventListener('click', () => { offset = Math.max(0, offset - PAGE); load(); });
        const next = el.querySelector('[data-cx-next]');
        if (next) next.addEventListener('click', () => { offset += PAGE; load(); });
      } catch (err) {
        mount(el, h`<div class="alert alert-danger m-3">${ui.errorMessage(err)}</div>`);
      }
    };
    load();
  }

  async function show(id) {
    let c; let events;
    try {
      [c, events] = await Promise.all([api.get(`/communications/${id}`), api.get(`/communications/${id}/events`).then((r) => r.items)]);
    } catch (err) {
      ui.toast(ui.errorMessage(err), { error: true });
      return;
    }
    const { el } = ui.createModal(h`
      <div class="modal-header"><h5 class="modal-title">${ui.label(c.channel)} to ${c.to || 'customer (address chosen at send time)'}</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body">
        <dl class="cx-kv mb-3">
          <dt>Status</dt><dd>${ui.status(c.status)} ${c.skipReason ? ui.label(c.skipReason) : ''} ${c.error ? h`<span class="cx-mono small">${c.error}</span>` : ''}</dd>
          <dt>Purpose</dt><dd>${ui.label(c.purpose)} · ${ui.label(c.origin.type)}${c.topicId ? ` · ${c.topicId}` : ''}</dd>
          <dt>Queued / sent</dt><dd>${ui.fmtDateTime(c.queuedAt)} / ${ui.fmtDateTime(c.sentAt)}</dd>
          <dt>Provider</dt><dd class="cx-mono small">${c.provider || '—'} ${c.providerMessageId || ''}</dd>
          <dt>Attempts</dt><dd>${c.attempts || 0}</dd>
        </dl>
        ${c.rendered ? h`<div class="cx-preview-subject">${c.rendered.subject || ui.label(c.channel)}</div>
          ${c.rendered.bodyHtml ? h`<iframe class="cx-preview-frame" title="Message as sent" sandbox="" data-cx-frame></iframe>` : h`<div class="cx-sms-bubble">${c.rendered.bodyText || ''}</div>`}` : h`<p class="text-muted">Not rendered (the message was not sent).</p>`}
        <h6 class="mt-4">Engagement</h6>
        ${events.length ? h`<ul class="cx-list">${events.map((e) => h`<li><div class="cx-list-main"><div>${ui.label(e.type)}${e.isMachineOpen ? ' (machine)' : ''}</div><div class="cx-list-sub">${ui.fmtDateTime(e.occurredAt)}${e.url ? ` · ${e.url}` : ''}</div></div></li>`)}</ul>` : h`<p class="text-muted small mb-0">No events yet.</p>`}
      </div>`, { size: 'modal-lg' });
    const frame = el.querySelector('[data-cx-frame]');
    if (frame) frame.srcdoc = withoutTracking(c.rendered.bodyHtml);
  }

  /**
   * Viewing a sent message must not count as the customer's engagement:
   * drop the open pixel and disarm tracked links (click, unsubscribe).
   */
  function withoutTracking(html) {
    return String(html || '')
      .replace(/<img\b[^>]*\/p\/o\/[^>]*>/gi, '')
      .replace(/(href\s*=\s*)(["'])[^"']*\/p\/[cu]\/[^"']*\2/gi, '$1$2#$2');
  }

  async function page(el, params) {
    const ref = await CX.marketingRef();
    const state = { status: params.get('status') || '', channel: params.get('channel') || '', purpose: params.get('purpose') || '', customerId: params.get('customerId') || '' };
    mount(el, h`
      <div class="cx-page-header"><div><h1 class="cx-page-title">Communications sent</h1>
        <p class="cx-page-subtitle">Every message to every recipient, including those skipped by consent, suppression or caps.</p></div></div>
      <div class="cx-toolbar">
        <select class="form-select" aria-label="Status" data-cx-filter="status"><option value="">All statuses</option>${ref.communicationStatuses.map((s) => h`<option value="${s}" ${s === state.status ? ui.raw('selected') : ''}>${ui.label(s)}</option>`)}</select>
        <select class="form-select" aria-label="Channel" data-cx-filter="channel"><option value="">All channels</option>${ref.channels.map((s) => h`<option value="${s}" ${s === state.channel ? ui.raw('selected') : ''}>${ui.label(s)}</option>`)}</select>
        <select class="form-select" aria-label="Purpose" data-cx-filter="purpose"><option value="">All purposes</option>${['marketing', 'transactional', 'service'].map((s) => h`<option value="${s}" ${s === state.purpose ? ui.raw('selected') : ''}>${ui.label(s)}</option>`)}</select>
        <input class="form-control cx-search" placeholder="Customer id" aria-label="Customer id" value="${state.customerId}" data-cx-filter="customerId">
      </div>
      <div class="card cx-table-card" data-cx-table></div>`);
    el.querySelectorAll('[data-cx-filter]').forEach((x) => x.addEventListener('change', () => {
      const next = { ...state, [x.dataset.cxFilter]: x.value.trim() };
      const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
      window.location.hash = `#/communications${qs.toString() ? `?${qs}` : ''}`;
    }));
    const filters = {};
    for (const [k, v] of Object.entries(state)) if (v) filters[`filter[${k}]`] = v;
    table(el.querySelector('[data-cx-table]'), filters, { title: 'Results' });
  }

  CX.views = CX.views || {};
  CX.views.communications = page;
  CX.views.communicationsTable = table;
  CX.views.withoutTracking = withoutTracking;
})(window.CX);
