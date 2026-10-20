// Small helpers the Noobly Cloud pages share. Everything that goes into HTML goes through the kit's html``, which
// escapes it.
import { html } from '/ui/js/html.js';
import { pageHead, notice, button } from '/ui/js/components/index.js';

/** A link inside this accelerator: hrefFor(ctx, '/vms/web-01') → '/infrastructure/vms/web-01'. */
export const hrefFor = (ctx, rel) => `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}${rel === '/' ? '' : rel}` || '/';

/** AbortError (the person left the page) is not an error to show. */
export const isAbort = (err) => err?.name === 'AbortError';

/** A card that says what went wrong, with a Try again button (data-action="reload"). */
export const errorCard = (err, what) => notice({
  title: `Couldn't load ${what}`,
  text: err?.message ?? String(err),
  tone: 'error',
  actions: button({ label: 'Try again', kind: 'secondary', small: true, attrs: { 'data-action': 'reload' } }),
});

export { reloadable } from './live.js';

/** A one-line message in the page's aria-live region, so screen readers hear what an action did. */
export function say(view, text, tone = 'info') {
  const el = view.querySelector('[data-message]');
  if (!el) return;
  el.className = `inf-message inf-message--${tone}`;
  el.textContent = text;
}
export const messageRegion = () => html`<p class="inf-message" data-message role="status" aria-live="polite"></p>`;

/** Text with a tone: a class for the colour, never the only signal. */
export const toned = (text, tone) => html`<span class="inf-tone inf-tone--${tone ?? 'neutral'}">${text}</span>`;

/** A labelled native progress bar (no inline styles): "Starting · 1 of 3". */
export const progressBar = (label, percent) => html`<span class="inf-progress"><span class="inf-tone inf-tone--info">${label}</span><progress max="100" value="${percent}" aria-label="${label}"></progress></span>`;

/** The breadcrumb above a sub-page's title: crumbs(ctx, [['Virtual machines', '/vms'], ['Launch']]). */
export const crumbs = (ctx, items) => html`<nav class="inf-crumbs" aria-label="Breadcrumb">${items.map(([label, rel], i) => html`${i ? html`<span aria-hidden="true">/</span>` : ''}${rel ? html`<a href="${hrefFor(ctx, rel)}">${label}</a>` : html`<span aria-current="page">${label}</span>`}`)}</nav>`;

/**
 * A screen that is routed but not built yet (roadmap phase 0): its title and lead from the mockup, its breadcrumb and
 * main action, and a notice saying which roadmap phase builds it. `links` adds a card of links ([label, rel, text]).
 */
export function placeholder(view, ctx, { title, lead, trail, actions, phase, what, links }) {
  view.innerHTML = String(html`${trail ? crumbs(ctx, trail) : ''}${pageHead({ eyebrow: 'Noobly Cloud', title, lead, actions })}
    ${notice({ title: `Coming in roadmap phase ${phase}`, text: what, tone: 'muted', iconName: 'clock' })}
    ${links ? html`<section class="card" aria-labelledby="inf-links-h"><h2 class="card__title" id="inf-links-h">Go to</h2><ul class="inf-links">${links.map(([label, rel, text]) => html`<li><a class="inf-links__item" href="${hrefFor(ctx, rel)}"><span class="inf-links__label">${label}</span>${text ? html`<span class="inf-sub">${text}</span>` : ''}</a></li>`)}</ul></section>` : ''}`);
}

/** Standalone only (no event stream): how often a page with something in progress looks again. */
export const REFRESH_MS = 2000;

export { html, button };
