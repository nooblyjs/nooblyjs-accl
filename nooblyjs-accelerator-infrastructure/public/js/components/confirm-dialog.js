// "Are you sure?" as a native modal <dialog> (focus trapped, Escape closes). With `typeToConfirm`, the confirm button
// stays disabled until the person types that name (product.md §3: nothing is destroyed by surprise). Resolves true
// when confirmed, false otherwise; the dialog removes itself.
import { html } from '/ui/js/html.js';

let count = 0;

export function confirmDialog(view, { title, text, confirmLabel = 'Confirm', typeToConfirm = null, danger = true }) {
  return new Promise((resolve) => {
    const id = `inf-dialog-${++count}`;
    const dialog = view.ownerDocument.createElement('dialog');
    dialog.className = 'inf-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = String(html`<form method="dialog" class="inf-dialog__form">
      <h2 class="card__title" id="${id}-title">${title}</h2>
      ${text ? html`<p class="inf-dialog__text">${text}</p>` : ''}
      ${typeToConfirm ? html`<label class="inf-field" for="${id}-input">Type <strong class="inf-mono">${typeToConfirm}</strong> to confirm</label><input class="inf-input inf-mono" id="${id}-input" name="typed" autocomplete="off" spellcheck="false">` : ''}
      <div class="actions"><button type="button" class="btn btn--secondary" data-dialog-cancel>Cancel</button><button type="submit" class="btn btn--${danger ? 'danger' : 'primary'}" value="confirm"${typeToConfirm ? html` disabled` : ''}>${confirmLabel}</button></div>
    </form>`);
    const input = dialog.querySelector('input[name="typed"]');
    const confirm = dialog.querySelector('button[value="confirm"]');
    input?.addEventListener('input', () => {
      confirm.disabled = input.value.trim() !== typeToConfirm;
    });
    // Cancel is a plain button, so Enter in the name field can only ever confirm (and only once the name matches).
    dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    }, { once: true });
    view.append(dialog);
    dialog.showModal();
    (input ?? dialog.querySelector('[data-dialog-cancel]')).focus();
  });
}
