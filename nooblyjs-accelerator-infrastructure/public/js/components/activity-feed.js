// Rows of activity (the Overview's "Recent activity", the Activity page): a verb pill, what happened, who, and when.
import { html } from '/ui/js/html.js';
import { statusPill } from '/ui/js/components/index.js';
import { ago } from '/ui/js/format.js';

export const activityFeed = (items, { now = Date.now(), empty = 'Nothing has happened yet.' } = {}) => (items.length
  ? html`<ul class="inf-feed">${items.map((a) => html`<li class="inf-feed__row">${statusPill({ text: a.verb, tone: a.tone, dot: false })}<span class="inf-feed__text">${a.text}${a.actor ? html`<span class="inf-feed__who"> · by ${a.actor.name}</span>` : ''}</span><time class="inf-feed__when" datetime="${a.at}" title="${new Date(a.at).toLocaleString('en-GB')}">${ago(a.at, now)}</time></li>`)}</ul>`
  : html`<p class="inf-muted">${empty}</p>`);
