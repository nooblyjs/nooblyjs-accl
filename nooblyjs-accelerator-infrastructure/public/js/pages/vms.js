// Virtual machines (infra-virtual-machines/VirtualMachines.dc.html; product.md §6.2): every VM with its cloud and
// zone, size, status, public IP, endpoint and estimated monthly cost; filtered by cloud and searched by name, IP or
// domain, without asking the server again. Each row's menu starts, stops, restarts, copies the SSH command or deletes.
// Data: GET /vms (?role=database for the VMs that run MongoDB databases).
import { pageHead, statusPill, dataTable, chips, card } from '/ui/js/components/index.js';
import { html, button, hrefFor, errorCard, isAbort, reloadable, say, messageRegion, progressBar, REFRESH_MS } from '../lib.js';
import { cloudBadge, actionsMenu, wireMenus, confirmDialog } from '../components/index.js';
import { usd } from '../shared/estimate.js';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

function filtersFor(vms, databaseVms) {
  const count = (cloud) => vms.filter((v) => v.cloud === cloud).length;
  return [
    { value: 'all', label: 'All', count: vms.length },
    ...['gcp', 'aws'].filter((c) => count(c)).map((c) => ({ value: c, label: c.toUpperCase(), count: count(c) })),
    ...(databaseVms ? [{ value: 'database', label: 'Database VMs', count: databaseVms, divider: true }] : []),
  ];
}

function rowMenu(vm, ctx) {
  const items = [{ label: 'Open', href: hrefFor(ctx, `/vms/${vm.name}`) }];
  if (ctx.can('draft')) {
    if (vm.can.stop) items.push({ label: 'Stop', action: 'stop', data: { name: vm.name } });
    if (vm.can.start) items.push({ label: 'Start', action: 'start', data: { name: vm.name } });
    if (vm.can.restart) items.push({ label: 'Restart', action: 'restart', data: { name: vm.name } });
  }
  if (vm.sshCommand) items.push({ label: 'Copy SSH command', action: 'copy-ssh', data: { ssh: vm.sshCommand } });
  if (ctx.can('approve') && vm.can.delete) items.push({ label: 'Delete', action: 'delete', data: { name: vm.name }, danger: true });
  return actionsMenu({ label: `Actions for ${vm.name}`, items });
}

function table(vms, ctx, filter) {
  return dataTable({
    caption: 'Virtual machines',
    empty: filter === 'all' ? 'No VMs yet. Launch one to start.' : 'No VMs match.',
    rows: vms,
    columns: [
      { key: 'name', label: 'Name', render: (v) => html`<a class="inf-strong-link" href="${hrefFor(ctx, `/vms/${v.name}`)}">${v.name}</a><span class="inf-sub">${v.role === 'database' ? `Runs the database ${v.ownedBy}` : v.image}</span>` },
      { key: 'where', label: 'Cloud · zone', render: (v) => html`<span class="inf-inline">${cloudBadge(v.cloud)}${v.zone}</span>` },
      { key: 'size', label: 'Size', render: (v) => html`${v.machineType}<span class="inf-sub">${v.size ?? ''}</span>` },
      { key: 'status', label: 'Status', render: (v) => (v.operation?.status === 'running' ? progressBar(v.statusText, v.operation.progress) : statusPill({ text: v.statusText, tone: v.tone })) },
      { key: 'ip', label: 'Public IP', render: (v) => (v.publicIp ? html`<span class="inf-mono">${v.publicIp}</span>` : html`<span class="inf-muted">${v.publicIpText}</span>`) },
      {
        key: 'endpoint',
        label: 'HTTPS endpoint',
        render: (v) => (v.endpoint
          ? html`${v.endpoint.live ? html`<a class="inf-mono" href="https://${v.endpoint.host}" rel="noopener">${v.endpoint.host}</a>` : html`<span class="inf-mono inf-muted">${v.endpoint.host}</span>`}${v.endpoint.note || v.endpoint.more ? html`<span class="inf-sub">${v.endpoint.note ?? `+${v.endpoint.more} more`}</span>` : ''}`
          : html`<span class="inf-muted">Private only</span>`),
      },
      { key: 'cost', label: 'Est. / month', numeric: true, render: (v) => html`${usd(v.estimate.monthly)}${v.estimate.note ? html`<span class="inf-sub">${v.estimate.note}</span>` : ''}` },
      { key: 'actions', label: html`<span class="visually-hidden">Actions</span>`, render: (v) => rowMenu(v, ctx) },
    ],
  });
}

export async function render(view, { query, ctx }) {
  let filter = ['gcp', 'aws', 'database'].includes(query.get('cloud')) ? query.get('cloud') : query.get('role') === 'database' ? 'database' : 'all';
  let search = query.get('q') ?? '';
  let vms = [];
  let databaseVms = [];

  const canLaunch = ctx.can('draft');
  view.innerHTML = String(html`${pageHead({ title: 'Virtual machines', lead: ' ', actions: canLaunch ? button({ label: 'Launch VM', icon: 'plus', href: hrefFor(ctx, '/vms/new') }) : '' })}
    ${messageRegion()}
    <div class="inf-toolbar"><div data-region="chips"></div><div class="inf-toolbar__search"><label class="visually-hidden" for="inf-vm-search">Search VMs</label><input class="inf-input" id="inf-vm-search" type="search" placeholder="Search by name, IP or domain" autocomplete="off"></div></div>
    <div data-region="table"></div>
    <div class="inf-band"><strong>Every VM is ready for apps.</strong> Docker is installed on its first boot unless you switch it off. Public HTTPS endpoints, with certificates that renew themselves, arrive in roadmap phase 3.</div>`);
  const lead = view.querySelector('.page-head .lead');
  const chipsRegion = view.querySelector('[data-region="chips"]');
  const tableRegion = view.querySelector('[data-region="table"]');
  const searchBox = view.querySelector('#inf-vm-search');
  searchBox.value = search;

  const drawTable = () => {
    const needle = search.trim().toLowerCase();
    const shown = (filter === 'database' ? databaseVms : vms)
      .filter((v) => filter === 'all' || filter === 'database' || v.cloud === filter)
      .filter((v) => !needle || [v.name, v.publicIp, v.endpoint?.host].filter(Boolean).some((s) => s.toLowerCase().includes(needle)));
    const pressed = view.ownerDocument?.activeElement?.closest?.('[data-cloud]')?.dataset.cloud;
    chipsRegion.innerHTML = String(chips({ label: 'Filter by cloud', name: 'cloud', items: filtersFor(vms, databaseVms.length), current: filter, small: true }));
    if (pressed) chipsRegion.querySelector(`[data-cloud="${pressed}"]`)?.focus();
    tableRegion.innerHTML = String(card({ label: 'Virtual machine list', body: table(shown, ctx, filter) }));
  };

  const redraw = await reloadable(tableRegion, ctx, async () => {
    try {
      const [apps, dbs] = await Promise.all([ctx.api.get('vms'), ctx.api.get('vms', { query: { role: 'database' } })]);
      vms = apps.vms;
      databaseVms = dbs.vms;
    } catch (err) {
      if (!isAbort(err)) tableRegion.innerHTML = String(errorCard(err, 'the virtual machines'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const clouds = ['GCP', 'AWS'].filter((c) => vms.some((v) => v.cloudLabel === c));
    lead.textContent = vms.length
      ? `${plural(vms.length, 'Linux VM')} across ${clouds.join(' and ')} · ${vms.filter((v) => v.status === 'running').length} running`
      : 'No VMs yet.';
    drawTable();
    return vms.some((v) => v.operation) ? REFRESH_MS : 0;
  });

  wireMenus(view, ctx.signal);
  searchBox.addEventListener('input', () => {
    search = searchBox.value;
    drawTable();
  }, { signal: ctx.signal });

  view.addEventListener('click', async (event) => {
    const chip = event.target.closest?.('[data-cloud]');
    if (chip) {
      filter = chip.dataset.cloud;
      drawTable();
      return;
    }
    const target = event.target.closest?.('[data-action]');
    if (!target || target.dataset.action === 'reload') return;
    const { action, name, ssh } = target.dataset;
    try {
      if (action === 'copy-ssh') {
        await globalThis.navigator.clipboard.writeText(ssh);
        say(view, `Copied: ${ssh}`, 'success');
        return;
      }
      if (action === 'delete') {
        const ok = await confirmDialog(view, {
          title: `Delete ${name}?`,
          text: 'The machine, its disk and its address are deleted in the cloud. This can’t be undone.',
          confirmLabel: 'Delete VM',
          typeToConfirm: name,
        });
        if (!ok) return;
        await ctx.api.del(`vms/${encodeURIComponent(name)}`, { body: { confirm: name } });
        say(view, `Deleting ${name}.`, 'success');
      } else if (['start', 'stop', 'restart'].includes(action)) {
        await ctx.api.post(`vms/${encodeURIComponent(name)}/${action}`);
        say(view, `${action === 'stop' ? 'Stopping' : action === 'start' ? 'Starting' : 'Restarting'} ${name}.`, 'success');
      }
      await redraw();
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });

}
