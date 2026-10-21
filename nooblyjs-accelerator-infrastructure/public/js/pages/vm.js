// VM detail (infra-vm-detail/VMDetail.dc.html; product.md §6.4): status and what the VM is, its operation under way
// (with its steps and Cancel), health, HTTPS endpoints, the apps on it, its details and the work done on it, and a
// danger zone. Data: GET /vms/:name; health (GET /vms/:name/health) is drawn when it arrives, so a slow SSH never
// holds the page.
import { pageHead, statusPill, dataTable, card, notice, statCard } from '/ui/js/components/index.js';
import { ago } from '/ui/js/format.js';
import { html, button, hrefFor, crumbs, errorCard, isAbort, reloadable, say, messageRegion, progressBar, REFRESH_MS } from '../lib.js';
import { cloudBadge, kv, copyField, wireCopy, confirmDialog } from '../components/index.js';
import { usd } from '../shared/estimate.js';

const gb = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const STEP = { done: 'Done', skipped: 'Skipped', running: 'Under way', pending: 'To do', failed: 'Failed' };

function operationCard(op, ctx) {
  return card({
    title: op.label,
    meta: op.statusText,
    body: html`${progressBar(op.statusText, op.progress)}
      <ol class="inf-steps">${op.steps.map((s) => html`<li class="inf-steps__step inf-steps__step--${s.status}"><span class="inf-steps__label">${s.label}</span><span class="inf-sub">${STEP[s.status] ?? s.status}</span></li>`)}</ol>
      ${op.cancellable && ctx.can('draft') ? html`<div class="actions">${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-action': 'cancel', 'data-id': op.id } })}</div>` : ''}`,
  });
}

function healthTiles(h) {
  if (!h) return html`<p class="inf-muted">Reading health…</p>`;
  if (h.problem) return html`<p class="inf-muted">${h.problem}</p>`;
  const pct = (used, total) => `${Math.round((used / total) * 100)}% used`;
  return html`${statCard({ label: 'CPU · last hour', value: h.cpuPercent === null ? '—' : `${h.cpuPercent}%` })}
    ${statCard({ label: 'Memory', value: h.memory ? `${gb(h.memory.usedGb)} / ${gb(h.memory.totalGb)} GB` : '—', note: h.memory ? pct(h.memory.usedGb, h.memory.totalGb) : null })}
    ${statCard({ label: 'Disk', value: h.disk ? `${gb(h.disk.usedGb)} / ${gb(h.disk.totalGb)} GB` : '—', note: h.disk ? pct(h.disk.usedGb, h.disk.totalGb) : null })}
    ${statCard({ label: 'Requests · 24 h', value: '—', note: 'Counted once apps run behind its HTTPS proxy (roadmap phase 6).' })}`;
}

function page(vm, ctx) {
  const actions = [
    vm.sshCommand ? button({ label: 'Open SSH', kind: 'secondary', icon: 'out', attrs: { 'data-action': 'ssh' } }) : '',
    ctx.can('draft') && vm.can.stop ? button({ label: 'Stop', kind: 'secondary', attrs: { 'data-action': 'stop' } }) : '',
    ctx.can('draft') && vm.can.start ? button({ label: 'Start', kind: 'secondary', attrs: { 'data-action': 'start' } }) : '',
    vm.role !== 'database' ? button({ label: 'Deploy an app', icon: 'repo', href: hrefFor(ctx, `/apps/new?vm=${encodeURIComponent(vm.name)}`) }) : '',
  ];
  const facts = [vm.zone, vm.machineType, vm.image, vm.uptimeText].filter(Boolean).join(' · ');
  return html`${crumbs(ctx, [['Virtual machines', '/vms'], [vm.name]])}
    ${pageHead({ title: vm.name, actions: html`${actions}` })}
    <p class="inf-meta">${statusPill({ text: vm.statusText, tone: vm.tone })}${cloudBadge(vm.cloud)}<span>${facts}</span></p>
    ${messageRegion()}
    <div data-region="ssh" hidden>${card({ title: 'Connect over SSH', body: html`<p class="inf-muted">From a terminal on a computer that holds the VM’s key (${vm.sshKey ?? 'its SSH key'}), and from an address SSH is open to (${vm.ports.split(' · ')[0]}):</p>${copyField(vm.sshCommand ?? '', { label: 'Copy the SSH command' })}` })}</div>
    ${vm.failure ? notice({ title: 'The last operation failed', text: vm.failure, tone: 'error' }) : ''}
    ${vm.operation ? operationCard(vm.operation, ctx) : ''}
    ${vm.role === 'database' ? notice({ title: `This VM runs the database ${vm.ownedBy}`, text: 'Start, stop, resize and delete it from Databases.', tone: 'muted', iconName: 'info' }) : ''}
    <section class="inf-stats" aria-label="Health" data-region="health">${healthTiles(null)}</section>
    ${card({
      title: 'HTTPS endpoints',
      meta: 'Public addresses that route to containers on this VM',
      body: vm.endpoints.length ? dataTable({
        caption: 'HTTPS endpoints',
        rows: vm.endpoints,
        columns: [
          { key: 'host', label: 'Address', render: (e) => (e.url ? html`<a class="inf-mono" href="${e.url}" rel="noopener">${e.url}</a>` : html`<span class="inf-mono">${e.host}</span>`) },
          { key: 'app', label: 'Routes to', render: (e) => html`${e.app ?? '—'}${e.port ? html`<span class="inf-sub inf-mono">container port ${e.port}</span>` : ''}` },
          { key: 'cert', label: 'Certificate', render: (e) => html`${statusPill({ text: e.cert.text, tone: e.cert.tone })}${e.cert.expiresAt ? html`<span class="inf-sub">Renews ${new Date(e.cert.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>` : ''}` },
          { key: 'dns', label: 'DNS', render: (e) => statusPill({ text: e.dns.text, tone: e.dns.tone, dot: false }) },
        ],
      }) : html`<p class="inf-muted">No public endpoints. Adding one arrives in roadmap phase 3.</p>`,
    })}
    ${card({
      title: 'Apps on this VM',
      meta: 'Built from a Dockerfile in Git and run as containers',
      body: vm.apps.length ? dataTable({
        caption: 'Apps on this VM',
        rows: vm.apps,
        columns: [
          { key: 'name', label: 'App', render: (a) => html`<strong>${a.name}</strong>${a.deployedAt ? html`<span class="inf-sub">Deployed ${ago(a.deployedAt)}</span>` : ''}` },
          { key: 'repo', label: 'Repository', render: (a) => html`<span class="inf-mono">${a.repo}</span><span class="inf-sub">${a.branch} · ${a.dockerfile}</span>` },
          { key: 'commit', label: 'Commit', render: (a) => html`<span class="inf-mono">${a.commit ?? '—'}</span>` },
          { key: 'status', label: 'Status', render: (a) => statusPill({ text: a.status === 'live' ? 'Live' : a.status === 'building' ? 'Building' : a.status === 'stopped' ? 'Stopped' : a.status, tone: a.status === 'live' ? 'success' : a.status === 'building' ? 'warning' : 'neutral' }) },
          { key: 'auto', label: 'Auto-deploy', render: (a) => a.autoDeploy },
        ],
      }) : html`<p class="inf-muted">No apps yet. Deploying from Git arrives in roadmap phase 6.</p>`,
    })}
    <div class="inf-pair">
      ${card({
        title: 'Details',
        body: kv([
          ['Public IP', vm.publicIp ? html`<span class="inf-mono">${vm.publicIp}${vm.staticIp ? ' · static' : ''}</span>` : vm.publicIpText],
          ['Private IP', vm.privateIp ? html`<span class="inf-mono">${vm.privateIp}</span>` : '—'],
          ['SSH', vm.sshCommand ? copyField(vm.sshCommand, { label: 'Copy the SSH command' }) : '—'],
          ['SSH key', vm.sshKey ?? '—'],
          ['Open ports', vm.ports],
          ['Runtime', vm.runtime ?? '—'],
          ['Account', html`${vm.cloudLabel} · ${vm.accountLabel}`],
          ['Created', `${new Date(vm.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${vm.createdBy ? ` by ${vm.createdBy.name}` : ''}`],
          ['Est. cost', `${usd(vm.estimate.monthly)} / month${vm.estimate.note ? ` (${vm.estimate.note})` : ''}`],
        ]),
      })}
      ${card({
        title: 'Recent work',
        body: vm.operations.length ? html`<ul class="inf-feed">${vm.operations.map((op) => html`<li class="inf-feed__row">${statusPill({ text: op.statusText, tone: op.tone, dot: false })}<span class="inf-feed__text">${op.label}${op.error ? html`<span class="inf-sub">${op.error.message}</span>` : ''}</span><time class="inf-feed__when" datetime="${op.createdAt}">${ago(op.createdAt)}</time></li>`)}</ul>`
          : html`<p class="inf-muted">Nothing done here through Noobly Cloud yet.</p>`,
      })}
    </div>
    ${vm.role !== 'database' && (ctx.can('draft') || ctx.can('approve')) ? card({
      title: 'Danger zone',
      body: html`<div class="actions">${ctx.can('draft') && vm.can.restart ? button({ label: 'Restart', kind: 'secondary', attrs: { 'data-action': 'restart' } }) : ''}${ctx.can('approve') && vm.can.delete ? button({ label: 'Delete VM', kind: 'danger', attrs: { 'data-action': 'delete' } }) : ''}</div>
        <p class="inf-muted">Deleting removes the machine, its disk and its address in the cloud. A VM with apps can’t be deleted until they are.</p>`,
    }) : ''}`;
}

export async function render(view, { params, ctx }) {
  const name = params.name;
  const api = (path) => `vms/${encodeURIComponent(name)}${path}`;
  let vm = null;
  let health = null;

  const drawHealth = () => {
    const region = view.querySelector('[data-region="health"]');
    if (region) region.innerHTML = String(healthTiles(health));
  };
  const loadHealth = async () => {
    if (!vm || vm.role === 'database' && vm.status !== 'running') return;
    try {
      health = await ctx.api.get(api('/health'));
      if (ctx.isCurrent()) drawHealth();
    } catch (err) {
      if (!isAbort(err)) health = { problem: `Health could not be read: ${err.message}` };
      drawHealth();
    }
  };

  const redraw = await reloadable(view, ctx, async () => {
    try {
      vm = await ctx.api.get(api(''));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(err.status === 404 ? notice({ title: `No VM called ${name}`, text: 'It may have been deleted.', tone: 'muted', actions: button({ label: 'All VMs', href: hrefFor(ctx, '/vms') }), headingLevel: 1 }) : errorCard(err, name));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const sshOpen = !view.querySelector('[data-region="ssh"]')?.hidden;
    view.innerHTML = String(page(vm, ctx));
    if (sshOpen && vm.sshCommand) view.querySelector('[data-region="ssh"]').hidden = false;
    drawHealth();
    return vm.operation ? REFRESH_MS : 0;
  });
  loadHealth();

  wireCopy(view, ctx.signal, (text, tone) => say(view, text, tone));
  view.addEventListener('click', async (event) => {
    const target = event.target.closest?.('[data-action]');
    if (!target || target.dataset.action === 'reload') return;
    const { action } = target.dataset;
    if (action === 'ssh') {
      const panel = view.querySelector('[data-region="ssh"]');
      panel.hidden = !panel.hidden;
      return;
    }
    try {
      target.disabled = true;
      if (action === 'cancel') {
        await ctx.api.post(`operations/${encodeURIComponent(target.dataset.id)}/cancel`);
        say(view, 'Cancelled.', 'success');
      } else if (['start', 'stop', 'restart'].includes(action)) {
        await ctx.api.post(api(`/${action}`));
        say(view, `${action === 'stop' ? 'Stopping' : action === 'start' ? 'Starting' : 'Restarting'} ${name}.`, 'success');
      } else if (action === 'delete') {
        const ok = await confirmDialog(view, { title: `Delete ${name}?`, text: 'The machine, its disk and its address are deleted in the cloud. This can’t be undone.', confirmLabel: 'Delete VM', typeToConfirm: name });
        if (!ok) return;
        await ctx.api.del(api(''), { body: { confirm: name } });
        say(view, `Deleting ${name}.`, 'success');
      }
      health = null;
      await redraw();
      loadHealth();
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    } finally {
      target.disabled = false;
    }
  }, { signal: ctx.signal });
}
