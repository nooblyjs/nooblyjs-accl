// Text to copy (the mockups' .codebox): an SSH command, a public URL. Never a secret: the value is in the page.
// wireCopy() handles every copy button in a view.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';

export const copyField = (text, { label = 'Copy' } = {}) => html`<span class="inf-copy"><code class="inf-mono inf-copy__text">${text}</code><button type="button" class="btn btn--secondary btn--small inf-copy__button" data-copy="${text}" aria-label="${label}">${icon('copy', { size: 16 })}</button></span>`;

/** Copies on click; `say(text, tone)` tells the person what happened. */
export function wireCopy(view, signal, say) {
  view.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-copy]');
    if (!button) return;
    try {
      await globalThis.navigator.clipboard.writeText(button.dataset.copy);
      say?.('Copied.', 'success');
    } catch {
      say?.('Could not copy: select the text and copy it yourself.', 'error');
    }
  }, { signal });
}
