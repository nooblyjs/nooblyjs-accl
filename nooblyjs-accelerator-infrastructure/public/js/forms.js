// Reading a form and showing what the server said about it (architecture.md §11.5). The server decides; these only
// carry its words to the right fields.

/** Whether a radio or checkbox is checked: the property in a browser, the attribute where there is no property. */
const isChecked = (el) => (typeof el.checked === 'boolean' ? el.checked : el.hasAttribute('checked'));

/** A form's values by name: text as typed, a radio's checked value, a checkbox as true/false. Disabled controls are left out. */
export function formValues(form) {
  const out = {};
  for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (el.disabled) continue;
    const type = el.getAttribute('type');
    if (type === 'radio') {
      if (isChecked(el)) out[el.name] = el.value;
    } else if (type === 'checkbox') out[el.name] = isChecked(el);
    else out[el.name] = el.value ?? '';
  }
  return out;
}

/** Puts each field's problem under it (data-error="<name>"), marks the control, and focuses the first. */
export function showFieldErrors(root, fields = {}) {
  for (const el of root.querySelectorAll('[data-error]')) el.textContent = '';
  for (const el of root.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  let first = null;
  for (const [name, text] of Object.entries(fields)) {
    const slot = root.querySelector(`[data-error="${name}"]`);
    if (slot) slot.textContent = text;
    const control = root.querySelector(`[name="${name}"]:not([disabled])`);
    control?.setAttribute('aria-invalid', 'true');
    first ??= control;
  }
  first?.focus();
  return Boolean(first) || Object.keys(fields).length > 0;
}
