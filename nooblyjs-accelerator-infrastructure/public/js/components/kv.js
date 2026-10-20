// Facts as a description list (the mockups' .kv): kv([['Public IP', '203.0.113.24'], ['SSH', copyField(...)]]).
// A row whose value is null or undefined is left out.
import { html } from '/ui/js/html.js';

export const kv = (pairs) => html`<dl class="inf-kv">${pairs.filter(([, v]) => v !== null && v !== undefined).map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>`;
