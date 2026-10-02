'use strict';

/**
 * Components shared by customer and organization pages: contact points
 * (emails, phones, addresses) and notes.
 */
window.CX = window.CX || {};

(function (CX) {
  const { h, mount, ui } = { h: CX.ui.h, mount: CX.ui.mount, ui: CX.ui };
  const { api } = CX;

  const KINDS = [
    { key: 'emails', title: 'Emails', icon: 'envelope', singular: 'email' },
    { key: 'phones', title: 'Phones', icon: 'telephone', singular: 'phone' },
    { key: 'addresses', title: 'Addresses', icon: 'geo-alt', singular: 'address' }
  ];

  function fieldsFor(kind, ref, current) {
    const primary = { name: 'isPrimary', label: 'Primary', type: 'checkbox', col: 'col-sm-6', disabled: Boolean(current && current.isPrimary), help: current && current.isPrimary ? 'Make another one primary to change this.' : '' };
    if (kind === 'emails') {
      return [
        { name: 'address', label: 'Email address', type: 'email', required: true, col: 'col-sm-8', maxLength: 254 },
        { name: 'type', label: 'Type', type: 'select', options: ref.emailTypes, required: true, col: 'col-sm-4', default: 'personal' },
        { name: 'verified', label: 'Verified', type: 'checkbox', col: 'col-sm-6' },
        primary
      ];
    }
    if (kind === 'phones') {
      return [
        { name: 'raw', label: 'Phone number', type: 'tel', required: true, col: 'col-sm-8', maxLength: 40, help: 'International (+27 82 …) or national format with a country.' },
        { name: 'type', label: 'Type', type: 'select', options: ref.phoneTypes, required: true, col: 'col-sm-4', default: 'mobile' },
        { name: 'countryCode', label: 'Country', type: 'select', options: ref.countries.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })), col: 'col-sm-8' },
        { name: 'extension', label: 'Extension', col: 'col-sm-4', maxLength: 10 },
        { name: 'capabilities.sms', label: 'SMS', type: 'checkbox', col: 'col-4 col-sm-2' },
        { name: 'capabilities.voice', label: 'Voice', type: 'checkbox', col: 'col-4 col-sm-2' },
        { name: 'capabilities.whatsapp', label: 'WhatsApp', type: 'checkbox', col: 'col-4 col-sm-3' },
        { name: 'verified', label: 'Verified', type: 'checkbox', col: 'col-sm-2' },
        { ...primary, col: 'col-sm-3' }
      ];
    }
    return [
      { name: 'type', label: 'Type', type: 'select', options: ref.addressTypes, required: true, col: 'col-sm-4', default: 'home' },
      { name: 'label', label: 'Label', col: 'col-sm-8', maxLength: 100, placeholder: 'e.g. Head office' },
      { name: 'line1', label: 'Address line 1', required: true, maxLength: 200, autocomplete: 'address-line1' },
      { name: 'line2', label: 'Address line 2', col: 'col-sm-6', maxLength: 200 },
      { name: 'line3', label: 'Address line 3', col: 'col-sm-6', maxLength: 200 },
      { name: 'locality', label: 'City / town', col: 'col-sm-6', maxLength: 100 },
      { name: 'region', label: 'Province / state', col: 'col-sm-6', maxLength: 100 },
      { name: 'postalCode', label: 'Postal code', col: 'col-sm-4', maxLength: 20 },
      { name: 'countryCode', label: 'Country', type: 'select', required: true, col: 'col-sm-8', options: ref.countries.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })) },
      { name: 'validFrom', label: 'Valid from', type: 'date', col: 'col-sm-4' },
      { name: 'validTo', label: 'Valid to', type: 'date', col: 'col-sm-4' },
      { ...primary, col: 'col-sm-4' }
    ];
  }

  function describe(kind, item) {
    if (kind === 'emails') {
      return {
        main: item.address,
        sub: [ui.label(item.type), item.verified ? 'verified' : null, item.deliverability && item.deliverability !== 'ok' ? ui.label(item.deliverability) : null].filter(Boolean).join(' · ')
      };
    }
    if (kind === 'phones') {
      const caps = Object.entries(item.capabilities || {}).filter(([, v]) => v).map(([k]) => (k === 'sms' ? 'SMS' : ui.label(k)));
      return {
        main: `${item.e164 || item.raw}${item.extension ? ` ext ${item.extension}` : ''}`,
        sub: [ui.label(item.type), item.countryCode, caps.join(', '), item.verified ? 'verified' : null].filter(Boolean).join(' · ')
      };
    }
    const lines = [item.line1, item.line2, item.line3, [item.postalCode, item.locality].filter(Boolean).join(' '), item.region, item.countryCode].filter(Boolean);
    return { main: lines.join(', '), sub: [ui.label(item.type), item.label].filter(Boolean).join(' · ') };
  }

  /**
   * Renders the contact-point card for a party.
   *
   * @param {HTMLElement} el - Container
   * @param {string} base - Party path, e.g. `/customers/{id}`
   * @param {function(): void} [onChange] - Called after a change
   */
  async function contactPoints(el, base, onChange) {
    mount(el, ui.loading());
    let ref;
    let data;
    try {
      ref = await api.reference();
      const results = await Promise.all(KINDS.map((k) => api.get(`${base}/${k.key}`)));
      data = Object.fromEntries(KINDS.map((k, i) => [k.key, results[i].items]));
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${ui.errorMessage(err)}</div>`);
      return;
    }
    const reload = () => { contactPoints(el, base, onChange); if (onChange) onChange(); };

    mount(el, h`${KINDS.map((k) => h`
      <section class="mb-4">
        <h3 class="cx-section-title"><span><i class="bi bi-${k.icon} me-2"></i>${k.title}</span>
          <button class="btn btn-sm btn-outline-primary" data-cx-add="${k.key}"><i class="bi bi-plus-lg"></i> Add</button></h3>
        ${data[k.key].length ? h`<ul class="cx-list">${data[k.key].map((item) => {
          const d = describe(k.key, item);
          return h`<li>
            <div class="cx-list-main"><div>${d.main} ${item.isPrimary ? h`<span class="cx-primary ms-1"><i class="bi bi-star-fill"></i> Primary</span>` : ''}</div>
              <div class="cx-list-sub">${d.sub}</div></div>
            <div class="cx-actions">
              ${item.isPrimary ? '' : h`<button class="cx-icon-btn" title="Make primary" aria-label="Make primary" data-cx-primary="${k.key}:${item.id}"><i class="bi bi-star"></i></button>`}
              <button class="cx-icon-btn" title="Edit" aria-label="Edit" data-cx-edit="${k.key}:${item.id}"><i class="bi bi-pencil"></i></button>
              <button class="cx-icon-btn cx-danger" title="Remove" aria-label="Remove" data-cx-remove="${k.key}:${item.id}"><i class="bi bi-trash"></i></button>
            </div></li>`;
        })}</ul>` : h`<p class="text-muted small mb-0">No ${k.title.toLowerCase()} yet.</p>`}
      </section>`)}`);

    const find = (spec) => {
      const [key, id] = spec.split(':');
      return { kind: KINDS.find((k) => k.key === key), item: data[key].find((x) => x.id === id) };
    };

    el.querySelectorAll('[data-cx-add]').forEach((btn) => btn.addEventListener('click', () => {
      const kind = KINDS.find((k) => k.key === btn.dataset.cxAdd);
      ui.formModal({
        title: `Add ${kind.singular}`,
        fields: fieldsFor(kind.key, ref),
        submitLabel: 'Add',
        onSubmit: async (payload) => { await api.post(`${base}/${kind.key}`, payload); ui.toast(`${ui.label(kind.singular)} added`); reload(); }
      });
    }));
    el.querySelectorAll('[data-cx-edit]').forEach((btn) => btn.addEventListener('click', () => {
      const { kind, item } = find(btn.dataset.cxEdit);
      ui.formModal({
        title: `Edit ${kind.singular}`,
        fields: fieldsFor(kind.key, ref, item),
        values: item,
        onSubmit: async (payload) => {
          if (!Object.keys(payload).length) return;
          await api.patch(`${base}/${kind.key}/${item.id}`, payload, item.version);
          ui.toast(`${ui.label(kind.singular)} saved`);
          reload();
        }
      });
    }));
    el.querySelectorAll('[data-cx-primary]').forEach((btn) => btn.addEventListener('click', async () => {
      const { kind, item } = find(btn.dataset.cxPrimary);
      try {
        await api.patch(`${base}/${kind.key}/${item.id}`, { isPrimary: true }, item.version);
        ui.toast(`Primary ${kind.singular} changed`);
        reload();
      } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    }));
    el.querySelectorAll('[data-cx-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      const { kind, item } = find(btn.dataset.cxRemove);
      const ok = await ui.confirm(`Remove ${kind.singular}?`, `${describe(kind.key, item).main} will be removed.`, { confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      try {
        await api.del(`${base}/${kind.key}/${item.id}`);
        ui.toast(`${ui.label(kind.singular)} removed`);
        reload();
      } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    }));
  }

  /**
   * Renders the notes panel for a party.
   *
   * @param {HTMLElement} el - Container
   * @param {string} base - Party path
   * @param {function(): void} [onChange] - Called after a change
   */
  async function notes(el, base, onChange) {
    mount(el, ui.loading());
    let items;
    try {
      items = (await api.get(`${base}/notes`)).items;
    } catch (err) {
      mount(el, h`<div class="alert alert-danger">${ui.errorMessage(err)}</div>`);
      return;
    }
    const reload = () => { notes(el, base, onChange); if (onChange) onChange(); };
    mount(el, h`
      <form class="mb-4" data-cx-note-form novalidate>
        <label class="form-label" for="cx-note-body">Add a note</label>
        <textarea class="form-control mb-2" id="cx-note-body" name="body" rows="3" maxlength="10000" required></textarea>
        <div class="d-flex justify-content-between align-items-center gap-2">
          <div class="form-check"><input class="form-check-input" type="checkbox" id="cx-note-pin" name="pinned">
            <label class="form-check-label" for="cx-note-pin">Pin to top</label></div>
          <button class="btn btn-primary btn-sm" type="submit"><i class="bi bi-plus-lg"></i> Add note</button>
        </div>
      </form>
      ${items.length ? h`<ul class="cx-list">${items.map((n) => h`<li>
        <div class="cx-list-main">
          <div class="cx-note-body">${n.body}</div>
          <div class="cx-list-sub">${n.pinned ? h`<i class="bi bi-pin-angle-fill text-accent me-1"></i>` : ''}${ui.fmtDateTime(n.createdAt)} · ${n.createdBy} · ${ui.label(n.visibility)}</div>
        </div>
        <div class="cx-actions">
          <button class="cx-icon-btn" title="${n.pinned ? 'Unpin' : 'Pin'}" aria-label="${n.pinned ? 'Unpin' : 'Pin'}" data-cx-pin="${n.id}"><i class="bi bi-pin${n.pinned ? '-fill' : ''}"></i></button>
          <button class="cx-icon-btn" title="Edit" aria-label="Edit" data-cx-edit-note="${n.id}"><i class="bi bi-pencil"></i></button>
          <button class="cx-icon-btn cx-danger" title="Delete" aria-label="Delete" data-cx-del-note="${n.id}"><i class="bi bi-trash"></i></button>
        </div></li>`)}</ul>` : ui.empty('journal-text', 'No notes yet.')}`);

    const form = el.querySelector('[data-cx-note-form]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = form.elements.namedItem('body');
      if (!body.value.trim()) { body.classList.add('is-invalid'); return; }
      try {
        await api.post(`${base}/notes`, { body: body.value, pinned: form.elements.namedItem('pinned').checked });
        ui.toast('Note added');
        reload();
      } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    });
    const byId = (id) => items.find((n) => n.id === id);
    el.querySelectorAll('[data-cx-pin]').forEach((btn) => btn.addEventListener('click', async () => {
      const n = byId(btn.dataset.cxPin);
      try { await api.patch(`${base}/notes/${n.id}`, { pinned: !n.pinned }, n.version); reload(); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    }));
    el.querySelectorAll('[data-cx-edit-note]').forEach((btn) => btn.addEventListener('click', () => {
      const n = byId(btn.dataset.cxEditNote);
      ui.formModal({
        title: 'Edit note',
        size: '',
        fields: [{ name: 'body', label: 'Note', type: 'textarea', required: true, rows: 6 }, { name: 'visibility', label: 'Visibility', type: 'select', options: ['internal', 'team'], required: true }],
        values: n,
        onSubmit: async (payload) => { if (Object.keys(payload).length) { await api.patch(`${base}/notes/${n.id}`, payload, n.version); reload(); } }
      });
    }));
    el.querySelectorAll('[data-cx-del-note]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await ui.confirm('Delete note?', 'The note will be removed.', { confirmLabel: 'Delete', danger: true }))) return;
      try { await api.del(`${base}/notes/${btn.dataset.cxDelNote}`); ui.toast('Note deleted'); reload(); } catch (err) { ui.toast(ui.errorMessage(err), { error: true }); }
    }));
  }

  /** Primary value of a contact-point list (or the first one). */
  const primaryOf = (list) => (list && (list.find((x) => x.isPrimary) || list[0])) || null;

  CX.party = { contactPoints, notes, describe, primaryOf };
})(window.CX);
