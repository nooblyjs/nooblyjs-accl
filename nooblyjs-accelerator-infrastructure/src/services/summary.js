// Noobly Cloud at a glance (product.md §6.1): the Overview's totals, public endpoints, recent activity and spend, and
// the sidebar's status card (product.md §5). Everything is counted from the records; with nothing on disk it says
// zero. A MongoDB database's VM belongs to its database and is not counted among the VMs.
import { CLOUD } from './event-words.js';

const join = (parts) => parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`).join(' · ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "182 GB", "1.4 TB", "640 MB". */
export function bytesText(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1e12) return `${(b / 1e12).toFixed(1).replace(/\.0$/, '')} TB`;
  if (b >= 1e9) return `${Math.round(b / 1e9)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  return b ? `${Math.round(b / 1e3)} KB` : '0 GB';
}

/** How a VM's status reads in a count ("3 running · 1 stopped · 1 starting"), in that order. */
const VM_WORDS = [['running', 'running'], ['stopped', 'stopped'], ['starting', 'starting'], ['stopping', 'stopping'], ['failed', 'failed'], ['deleting', 'deleting'], ['missing', 'missing']];
const ENGINE = { mysql: 'MySQL', mongodb: 'MongoDB' };

/** An endpoint's state on the Overview: what a person can do with the address right now. */
function endpointState(endpoint, vm) {
  if (!vm || vm.status === 'stopped') return { state: 'vm-stopped', text: 'VM stopped', tone: 'neutral' };
  if (vm.missing) return { state: 'vm-missing', text: 'VM missing', tone: 'danger' };
  if (endpoint.dns?.status === 'waiting') return { state: 'dns-pending', text: 'DNS not verified', tone: 'warning' };
  if (endpoint.cert?.status === 'pending') return { state: 'cert-pending', text: 'Certificate pending', tone: 'warning' };
  if (endpoint.cert?.status === 'failed') return { state: 'cert-failed', text: 'Certificate failed', tone: 'danger' };
  if (endpoint.cert?.status === 'self-signed') return { state: 'live', text: 'Live · self-signed', tone: 'success' };
  return { state: 'live', text: 'Live', tone: 'success' };
}

export function createSummary({ repos, accounts, activity, cost }) {
  async function summary() {
    const [accountViews, allVms, apps, databases, buckets, endpoints, recent, spend] = await Promise.all([
      accounts.list(), repos.vms.list(), repos.apps.list(), repos.databases.list(), repos.buckets.list(),
      repos.endpoints.list(), activity.list({ limit: 5 }), cost.month(),
    ]);
    const vms = allVms.filter((v) => v.role !== 'database');
    const vmByName = new Map(allVms.map((v) => [v.name, v]));
    const accountById = new Map(accountViews.map((a) => [a.id, a]));
    const cloudOf = (accountId) => accountById.get(accountId)?.cloud ?? null;

    const vmStatus = (v) => (v.missing ? 'missing' : v.status);
    const appsOnHttps = new Set(endpoints.filter((e) => e.app).map((e) => e.app));
    const liveOnHttps = apps.filter((a) => a.status === 'live' && appsOnHttps.has(a.name)).length;
    const engines = Object.entries(ENGINE).map(([engine, label]) => [databases.filter((d) => d.engine === engine).length, label]);
    const bytes = buckets.reduce((sum, b) => sum + (b.observed?.bytes ?? 0), 0);
    const publicBuckets = buckets.filter((b) => b.spec?.access === 'public').length;
    const resources = vms.length + apps.length + databases.length + buckets.length;

    return {
      accounts: accountViews.map((a) => ({ id: a.id, cloud: a.cloud, cloudLabel: a.cloudLabel, name: a.name, label: a.label, state: a.state, stateText: a.stateText, stateTone: a.stateTone })),
      resources,
      totals: {
        vms: { count: vms.length, text: join(VM_WORDS.map(([status, word]) => [vms.filter((v) => vmStatus(v) === status).length, word])) || 'None yet' },
        apps: { count: apps.length, text: join([[liveOnHttps, 'live on HTTPS'], [apps.filter((a) => a.status === 'building').length, 'building'], [apps.filter((a) => a.status === 'failed').length, 'failed']]) || 'None yet' },
        databases: { count: databases.length, text: join(engines) || 'None yet' },
        buckets: { count: buckets.length, bytes, value: bytesText(bytes), text: buckets.length ? `${plural(buckets.length, 'bucket')} · ${publicBuckets} public` : 'None yet' },
      },
      endpoints: endpoints
        .map((e) => {
          const vm = vmByName.get(e.vm);
          const state = endpointState(e, vm);
          const secure = e.cert?.status === 'valid' || e.cert?.status === 'self-signed';
          return {
            id: e.id,
            host: e.host,
            url: state.state === 'live' ? `${secure ? 'https' : 'http'}://${e.host}${e.path && e.path !== '/' ? e.path : ''}` : null,
            app: e.app ?? null,
            vm: e.vm,
            cloud: cloudOf(vm?.account),
            cloudLabel: CLOUD[cloudOf(vm?.account)] ?? null,
            ...state,
          };
        })
        .sort((a, b) => a.host.localeCompare(b.host)),
      activity: recent,
      spend: {
        ...spend,
        accounts: spend.accounts.map((s) => {
          const a = accountById.get(s.id);
          return {
            ...s,
            cloud: a?.cloud ?? null,
            cloudLabel: a?.cloudLabel ?? null,
            name: a?.name ?? s.id,
            text: [plural(s.counts.vm, 'VM'), plural(s.counts.database, 'database'), plural(s.counts.bucket, 'bucket')].join(' · '),
          };
        }),
      },
    };
  }

  /** The sidebar's status card: each account and whether it is connected. */
  async function status() {
    const list = await accounts.list();
    if (!list.length) {
      return { card: { pill: { text: 'No cloud accounts yet', tone: 'neutral' }, lines: ['Connect GCP or AWS to start.'] } };
    }
    const attention = list.filter((a) => a.state === 'needs-attention').length;
    const connecting = list.filter((a) => a.state === 'connecting').length;
    const pill = attention ? { text: `${attention} need${attention === 1 ? 's' : ''} attention`, tone: 'danger' }
      : connecting ? { text: 'Connecting', tone: 'info' }
        : { text: `${plural(list.length, 'account')} connected`, tone: 'success' };
    return { card: { pill, items: list.map((a) => ({ label: `${a.cloudLabel} · ${a.label}`, value: a.stateText })) } };
  }

  return {
    summary,
    status,
    services: {
      /** The Overview's numbers, for another accelerator's dashboard. */
      summary,
    },
  };
}
