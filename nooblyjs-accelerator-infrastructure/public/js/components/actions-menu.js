// A row's "…" menu (the mockups' .btn-icon), as a native <details>: keyboard and screen readers work without script.
// Items are links (href) or buttons (action → data-action, with data-* from `data`). wireMenus() closes the other
// menus when one opens, and every menu on Escape or a click elsewhere.
import { html } from '/ui/js/html.js';

export const actionsMenu = ({ label, items }) => html`<details class="inf-menu"><summary class="btn btn--secondary btn--small inf-menu__button" aria-label="${label}"><span aria-hidden="true">•••</span></summary><div class="inf-menu__list">${items.map((item) => {
  const cls = `inf-menu__item${item.danger ? ' inf-menu__item--danger' : ''}`;
  if (item.href) return html`<a class="${cls}" href="${item.href}">${item.label}</a>`;
  const data = Object.entries(item.data ?? {}).map(([k, v]) => html` data-${k}="${v}"`);
  return html`<button type="button" class="${cls}" data-action="${item.action}"${data}${item.disabled ? html` disabled` : ''}>${item.label}</button>`;
})}</div></details>`;

export function wireMenus(view, signal) {
  const closeAll = (except = null) => {
    for (const menu of view.querySelectorAll('details.inf-menu[open]')) if (menu !== except) menu.open = false;
  };
  view.addEventListener('click', (event) => {
    const menu = event.target.closest?.('details.inf-menu');
    closeAll(menu);
    if (menu && event.target.closest('.inf-menu__item')) menu.open = false;
  }, { signal });
  view.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = event.target.closest?.('details.inf-menu[open]');
    if (open) {
      open.open = false;
      open.querySelector('summary')?.focus();
    }
  }, { signal });
  view.ownerDocument?.addEventListener('click', (event) => {
    if (!view.contains(event.target)) closeAll();
  }, { signal });
}
