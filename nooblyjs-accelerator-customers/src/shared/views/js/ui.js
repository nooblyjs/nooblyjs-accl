'use strict';

/**
 * UI helpers: auto-escaping templates, formatting, badges, toasts, confirm
 * dialogs and a schema-driven form modal (Bootstrap 5).
 */
window.CX = window.CX || {};

(function (CX) {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  /** Marks a string as trusted HTML. */
  const raw = (s) => ({ __html: String(s) });

  function render(v) {
    if (v === undefined || v === null || v === false) return '';
    if (Array.isArray(v)) return v.map(render).join('');
    if (typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__html')) return v.__html;
    return esc(v);
  }

  /**
   * Tagged template: interpolated values are escaped unless produced by
   * `h` or `raw`. Arrays are joined.
   */
  function h(strings, ...values) {
    let out = strings[0];
    values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
    return raw(out);
  }

  /** Replaces an element's content with a template. */
  function mount(el, tpl) {
    el.innerHTML = render(tpl);
    return el;
  }

  // ---- formatting ---------------------------------------------------------
  const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
    return Number.isNaN(d.getTime()) ? String(iso) : dateFmt.format(d);
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : dateTimeFmt.format(d);
  }

  function relTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    const abs = Math.abs(sec);
    const units = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [2592000, 'day', 86400], [31536000, 'month', 2592000], [Infinity, 'year', 31536000]];
    const [, unit, div] = units.find(([limit]) => abs < limit);
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(sec / div), unit);
  }

  const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  const displayName = (c) => (c && c.name && (c.name.preferred || c.name.full)) || (c && c.number) || 'Unnamed';

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function avatar(name, seed, small) {
    let hash = 0;
    for (const ch of String(seed || name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return h`<span class="cx-avatar ${small ? 'cx-avatar-sm' : ''} cx-avatar-${hash % 8}" aria-hidden="true">${initials(name)}</span>`;
  }

  const status = (value) => (value ? h`<span class="cx-status cx-status-${value}">${label(value)}</span>` : '');
  const stage = (value) => (value ? h`<span class="cx-stage">${label(value)}</span>` : '');

  function empty(icon, text) {
    return h`<div class="cx-empty"><i class="bi bi-${icon}"></i>${text}</div>`;
  }

  const loading = () => h`<div class="cx-loading"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Loading…</div>`;

  // ---- feedback -----------------------------------------------------------
  function toast(message, { error = false } = {}) {
    let box = document.querySelector('.cx-toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'cx-toasts';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `cx-toast${error ? ' cx-toast-error' : ''}`;
    el.setAttribute('role', error ? 'alert' : 'status');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), error ? 6000 : 3000);
  }

  function errorMessage(err) {
    if (err && err.status === 403) return 'You do not have permission to do that.';
    if (err && err.status === 401) return 'Please sign in again.';
    if (err && err.status === 412) return 'Someone else changed this record. Reload and try again.';
    return (err && err.message) || 'Something went wrong';
  }

  function createModal(inner, { size = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'modal fade';
    wrap.tabIndex = -1;
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('role', 'dialog');
    mount(wrap, h`<div class="modal-dialog modal-dialog-scrollable ${size}"><div class="modal-content">${inner}</div></div>`);
    document.body.appendChild(wrap);
    const modal = new window.bootstrap.Modal(wrap);
    wrap.addEventListener('hidden.bs.modal', () => { modal.dispose(); wrap.remove(); });
    modal.show();
    return { el: wrap, modal };
  }

  /**
   * Asks for confirmation.
   *
   * @param {string} title - Dialog title
   * @param {string} text - Explanation
   * @param {Object} [opts] - `{ confirmLabel, danger }`
   * @return {Promise<boolean>} True when confirmed
   */
  function confirm(title, text, { confirmLabel = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const { el, modal } = createModal(h`
        <div class="modal-header"><h5 class="modal-title">${title}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body"><p class="mb-0">${text}</p></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-cx-ok>${confirmLabel}</button>
        </div>`);
      el.querySelector('[data-cx-ok]').addEventListener('click', () => { answered = true; resolve(true); modal.hide(); });
      el.addEventListener('hidden.bs.modal', () => { if (!answered) resolve(false); });
    });
  }

  // ---- forms --------------------------------------------------------------
  const getPath = (obj, path) => path.split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    parts.slice(0, -1).forEach((p) => { cur[p] = cur[p] && typeof cur[p] === 'object' ? cur[p] : {}; cur = cur[p]; });
    cur[parts[parts.length - 1]] = value;
  }

  const options = (list) => (list || []).map((o) => (typeof o === 'object' ? o : { value: o, label: label(o) }));

  function fieldHtml(f, value, idPrefix) {
    const id = `${idPrefix}-${f.name.replace(/\W/g, '-')}`;
    const col = f.col || 'col-12';
    const req = f.required ? h`<span class="text-danger" aria-hidden="true"> *</span>` : '';
    const help = f.help ? h`<div class="form-text">${f.help}</div>` : '';
    const common = { id, name: f.name };
    if (f.type === 'checkbox') {
      return h`<div class="${col}"><div class="form-check mt-2">
        <input class="form-check-input" type="checkbox" id="${common.id}" name="${common.name}" ${value ? raw('checked') : ''} ${f.disabled ? raw('disabled') : ''}>
        <label class="form-check-label" for="${id}">${f.label}</label>${help}
        <div class="invalid-feedback"></div></div></div>`;
    }
    let control;
    if (f.type === 'select') {
      const opts = options(f.options);
      control = h`<select class="form-select" id="${id}" name="${f.name}" ${f.required ? raw('required') : ''}>
        ${f.required && value ? '' : h`<option value="">${f.placeholder || '—'}</option>`}
        ${opts.map((o) => h`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
      </select>`;
    } else if (f.type === 'textarea') {
      control = h`<textarea class="form-control" id="${id}" name="${f.name}" rows="${f.rows || 4}" ${f.required ? raw('required') : ''} maxlength="${f.maxLength || 10000}">${value ?? ''}</textarea>`;
    } else {
      const type = f.type === 'tags' ? 'text' : (f.type || 'text');
      const v = f.type === 'tags' && Array.isArray(value) ? value.join(', ') : (value ?? '');
      control = h`<input class="form-control" type="${type}" id="${id}" name="${f.name}" value="${v}"
        ${f.required ? raw('required') : ''} ${f.placeholder ? raw(`placeholder="${esc(f.placeholder)}"`) : ''}
        ${f.maxLength ? raw(`maxlength="${Number(f.maxLength)}"`) : ''} ${f.autocomplete ? raw(`autocomplete="${esc(f.autocomplete)}"`) : raw('autocomplete="off"')}>`;
    }
    return h`<div class="${col}"><label class="form-label" for="${id}">${f.label}${req}</label>${control}${help}<div class="invalid-feedback"></div></div>`;
  }

  function readField(form, f) {
    const input = form.elements.namedItem(f.name);
    if (!input) return undefined;
    if (f.type === 'checkbox') return input.checked;
    const v = input.value.trim();
    if (v === '') return '';
    if (f.type === 'number') return Number(v);
    if (f.type === 'tags') return v.split(',').map((t) => t.trim()).filter(Boolean);
    return v;
  }

  /**
   * Opens a form in a modal. In edit mode (`values` given) only changed fields
   * are submitted, and a cleared field is sent as null.
   *
   * @param {Object} spec
   * @param {string} spec.title - Modal title
   * @param {Object[]} spec.fields - `{ name, label, type, options, required, col, help }`
   * @param {Object} [spec.values] - Current values (edit mode)
   * @param {string} [spec.submitLabel='Save'] - Submit button label
   * @param {function(Object): Promise<*>} spec.onSubmit - Receives the payload; reject to show errors
   * @param {string} [spec.size] - Bootstrap modal size class
   * @return {void}
   */
  function formModal({ title, fields, values, submitLabel = 'Save', onSubmit, size = 'modal-lg', intro }) {
    const editing = Boolean(values);
    const idPrefix = `f${Math.random().toString(36).slice(2, 8)}`;
    const { el, modal } = createModal(h`
      <form novalidate>
        <div class="modal-header"><h5 class="modal-title">${title}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body">
          ${intro ? h`<p class="text-muted small">${intro}</p>` : ''}
          <div class="alert alert-danger d-none" role="alert" data-cx-error></div>
          <div class="row g-3">${fields.map((f) => fieldHtml(f, getPath(values || {}, f.name) ?? f.default, idPrefix))}</div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn btn-primary">${submitLabel}</button>
        </div>
      </form>`, { size });
    const form = el.querySelector('form');
    const alertBox = el.querySelector('[data-cx-error]');
    el.addEventListener('shown.bs.modal', () => {
      const first = form.querySelector('input:not([type=checkbox]),select,textarea');
      if (first) first.focus();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      form.querySelectorAll('.is-invalid').forEach((x) => x.classList.remove('is-invalid'));
      alertBox.classList.add('d-none');
      const payload = {};
      for (const f of fields) {
        if (f.readOnly) continue;
        const v = readField(form, f);
        if (editing) {
          const blank = f.type === 'checkbox' ? false : (f.type === 'tags' ? [] : '');
          const before = getPath(values, f.name) ?? blank;
          const now = f.type === 'tags' && v === '' ? [] : v;
          if (JSON.stringify(before) === JSON.stringify(now)) continue;
          setPath(payload, f.name, now === '' ? null : now);
        } else if (v !== '' && !(f.type === 'checkbox' && v === false && !f.sendFalse) && !(f.type === 'tags' && !v.length)) {
          setPath(payload, f.name, v);
        }
      }
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        await onSubmit(payload);
        modal.hide();
      } catch (err) {
        for (const d of (err && err.details) || []) {
          const path = String(d.path || '').replace(/\[\d+\]/g, '');
          // exact field, else every field below it (e.g. `name` → name.given, name.family, …)
          const exact = form.elements.namedItem(path);
          const inputs = exact && exact.classList ? [exact]
            : [...form.querySelectorAll('input,select,textarea')].filter((x) => x.name && x.name.startsWith(`${path}.`));
          inputs.forEach((input, i) => {
            input.classList.add('is-invalid');
            const fb = input.closest('[class*="col"]').querySelector('.invalid-feedback');
            if (fb && i === 0) fb.textContent = `${label(path.split('.').pop())} ${d.message}`;
          });
        }
        alertBox.textContent = errorMessage(err);
        alertBox.classList.remove('d-none');
      } finally {
        button.disabled = false;
      }
    });
  }

  /** Closes every open dialog (on navigation, so a dialog never outlives its page). */
  function closeModals() {
    document.querySelectorAll('.modal.show').forEach((el) => {
      const instance = window.bootstrap && window.bootstrap.Modal.getInstance(el);
      if (instance) instance.hide();
    });
  }

  /** Debounces a function. */
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  CX.ui = {
    esc, raw, h, mount, fmtDate, fmtDateTime, relTime, label, displayName, initials, avatar, status, stage, empty, loading,
    toast, errorMessage, confirm, formModal, createModal, closeModals, debounce, getPath, setPath
  };
})(window.CX);
