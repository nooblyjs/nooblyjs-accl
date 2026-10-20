// Overview (infra-overview/Main.dc.html; product.md §6.1): totals, create tiles, public endpoints, recent activity and
// the estimated spend this month per cloud account. Data: GET /summary. Every number is counted by the server.
import { pageHead, statCard, card, notice, statusPill, meter } from '/ui/js/components/index.js';
import { icon } from '/ui/js/icons.js';
import { html, button, hrefFor, errorCard, isAbort, reloadable } from '../lib.js';
import { activityFeed, cloudBadge } from '../components/index.js';
import { usd } from '../shared/estimate.js';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The "Create something" tiles: [label, path, what it is, kit icon, teal?]. */
const CREATE = [
  ['Launch a Linux VM', '/vms/new', 'Ubuntu or Debian on GCP or AWS, with a public endpoint', 'screen', false],
  ['Deploy from Git', '/apps/new', 'Build a repo’s Dockerfile and run it on one of your VMs', 'repo', true],
  ['Create a database', '/databases/new', 'Managed MySQL, or MongoDB on its own VM, with daily backups', 'layers', false],
  ['Create a bucket', '/buckets/new', 'Object storage for files, uploads and backups', 'inbox', true],
];

const endpointsList = (endpoints) => (endpoints.length
  ? html`<ul class="inf-rows">${endpoints.map((e) => html`<li class="inf-rows__row"><span class="inf-rows__icon${e.state === 'live' ? ' inf-rows__icon--live' : ''}" aria-hidden="true">${icon('globe', { size: 18 })}</span><span class="inf-rows__main">${e.url ? html`<a class="inf-mono" href="${e.url}" rel="noopener">${e.host}</a>` : html`<span class="inf-mono">${e.host}</span>`}<span class="inf-sub">${[e.app, e.vm, e.cloudLabel].filter(Boolean).join(' · ')}</span></span>${statusPill({ text: e.text, tone: e.tone })}</li>`)}</ul>`
  : html`<p class="inf-muted">No public endpoints yet. Launch a VM with one, or deploy an app.</p>`);

const spendList = (spend) => (spend.accounts.length
  ? html`<div class="inf-spend">${spend.accounts.map((a) => html`<div class="inf-spend__item"><div class="inf-spend__head">${cloudBadge(a.cloud)}<span class="inf-spend__name">${a.name}</span><span class="inf-spend__usd">${usd(a.usd)}</span></div>${meter({ label: `Share of this month’s estimate`, value: `${Math.round(a.share * 100)}%`, ratio: a.share })}<span class="inf-sub">${a.text}</span></div>`)}</div>`
  : html`<p class="inf-muted">Nothing costs anything yet.</p>`);

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let s;
    try {
      s = await ctx.api.get('summary');
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the overview'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const lead = `${plural(s.accounts.length, 'cloud account')} · ${plural(s.resources, 'resource')} · est. ${usd(s.spend.total)} this month`;
    const t = s.totals;
    view.innerHTML = String(html`${pageHead({ title: 'Infrastructure', lead, actions: button({ label: 'Launch VM', icon: 'plus', href: hrefFor(ctx, '/vms/new') }) })}
      ${s.accounts.length ? '' : notice({
        title: 'Connect a cloud account to start',
        text: 'Noobly Cloud works in your own GCP projects and AWS accounts. Connect one, then launch VMs, databases and buckets in it.',
        actions: button({ label: 'Connect an account', href: hrefFor(ctx, '/accounts') }),
      })}
      <section class="inf-stats" aria-label="Totals">
        ${statCard({ label: 'Virtual machines', value: t.vms.count, note: t.vms.text, href: hrefFor(ctx, '/vms') })}
        ${statCard({ label: 'Apps', value: t.apps.count, note: t.apps.text, href: hrefFor(ctx, '/apps') })}
        ${statCard({ label: 'Databases', value: t.databases.count, note: t.databases.text, href: hrefFor(ctx, '/databases') })}
        ${statCard({ label: 'Bucket storage', value: t.buckets.value, note: t.buckets.text, href: hrefFor(ctx, '/buckets') })}
      </section>
      <section class="inf-stack" aria-labelledby="inf-create-h">
        <h2 class="inf-h2" id="inf-create-h">Create something</h2>
        <ul class="inf-links">${CREATE.map(([label, rel, text, iconName, teal]) => html`<li><a class="inf-links__item inf-links__item--icon" href="${hrefFor(ctx, rel)}"><span class="inf-icirc${teal ? ' inf-icirc--teal' : ''}" aria-hidden="true">${icon(iconName, { size: 18 })}</span><span><span class="inf-links__label">${label}</span><span class="inf-sub">${text}</span></span></a></li>`)}</ul>
      </section>
      <div class="inf-pair">
        ${card({ title: 'Public HTTPS endpoints', meta: html`<a href="${hrefFor(ctx, '/apps')}">All apps</a>`, body: endpointsList(s.endpoints) })}
        ${card({ title: 'Recent activity', meta: html`<a href="${hrefFor(ctx, '/activity')}">All activity</a>`, body: activityFeed(s.activity) })}
      </div>
      ${card({ title: 'Spend this month', meta: `Estimate · resets ${s.spend.resetsOn}`, body: spendList(s.spend) })}`);
    return 0;
  });
}
