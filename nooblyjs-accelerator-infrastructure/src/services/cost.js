// What things cost (architecture.md §12). Each resource's monthly estimate comes from its spec and its cloud's
// catalogue, through the same estimate() the create forms use.
//
// "Spend this month" is an estimate for the whole month: what has accrued so far, plus each resource at its current
// rate until the month ends. What has accrued is kept in cost/<YYYY-MM>.yaml: accrue() adds the time since it last ran
// at each resource's rate then; it runs every hour (the cost snapshot job) and whenever a VM starts or stops, so a VM
// stopped mid-month counts its running hours and then its disk only, and a deleted one keeps what it had cost. Before
// the first snapshot of a month, a resource counts at its current rate from the 1st (or its creation). Real billed
// spend is a later phase (roadmap 7.4).
import { estimate, HOURS_PER_MONTH } from '../../public/js/shared/estimate.js';

const HOUR = 3_600_000;
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

function monthOf(at) {
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { key: new Date(start).toISOString().slice(0, 7), start, end };
}

export function createCost({ repos, catalog, store, now }) {
  /** One resource's estimate: { monthly, hourly, parts } (monthly is null when the catalogue lacks something). */
  function estimateFor(type, record, account) {
    const cat = account ? catalog.forCloud(account.cloud) : null;
    const spec = record.spec ?? {};
    if (type === 'vm') return estimate('vm', { region: spec.region, machineType: spec.machineType, diskGb: spec.diskGb, status: record.status }, cat);
    if (type === 'database') {
      return estimate('database', { engine: record.engine, region: spec.region, tier: spec.tier, storageGb: spec.storageGb, ha: spec.ha, keepDays: spec.keepDays }, cat);
    }
    if (type === 'bucket') return estimate('bucket', { region: spec.region, storageClass: spec.storageClass, bytes: record.observed?.bytes ?? 0 }, cat);
    throw new Error(`No estimate for ${type}`);
  }

  /** Every resource that costs money, at its current rate. A MongoDB database's VM counts in the database. */
  async function priced() {
    const [accounts, vms, databases, buckets] = await Promise.all([repos.accounts.list(), repos.vms.list(), repos.databases.list(), repos.buckets.list()]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const out = [];
    const add = (type, record) => {
      const account = byId.get(record.account);
      if (!account) return;
      const e = estimateFor(type, record, account);
      out.push({ key: `${type}:${record.name}`, type, name: record.name, account: account.id, createdAt: record.createdAt, hourly: (e.monthly ?? 0) / HOURS_PER_MONTH });
    };
    vms.filter((v) => v.role !== 'database').forEach((v) => add('vm', v));
    databases.forEach((d) => add('database', d));
    buckets.forEach((b) => add('bucket', b));
    return { accounts, out };
  }

  const tallyFile = (key) => ['cost', `${key}.yaml`];
  /** When a resource starts counting in a month: the later of the 1st, its creation and the last snapshot. */
  const from = (month, r, tally) => Math.max(month.start, new Date(r.createdAt ?? month.start).getTime() || month.start, tally?.at ? new Date(tally.at).getTime() : month.start);

  /** Adds the time since the last snapshot, at each resource's rate now, to this month's tally. */
  async function accrue(at = now()) {
    const month = monthOf(at);
    const file = tallyFile(month.key);
    await store.withLock(file, async () => {
      const tally = (await store.readYaml(file)) ?? { month: month.key, at: null, resources: {} };
      const { out } = await priced();
      for (const r of out) {
        const hours = Math.max(0, (at - from(month, r, tally)) / HOUR);
        const entry = tally.resources[r.key] ?? { account: r.account, usd: 0 };
        tally.resources[r.key] = { account: r.account, usd: round(entry.usd + r.hourly * hours, 4) };
      }
      tally.at = new Date(at).toISOString();
      await store.writeYaml(file, tally);
    });
  }

  return {
    estimateFor,
    accrue,
    /**
     * This month, per account and in total: accrued so far, plus each resource at its current rate to the month's end.
     * { month, resetsOn, total, accounts: [{ id, usd, share, counts }] }
     */
    async month(at = now()) {
      const month = monthOf(at);
      const tally = await store.readYaml(tallyFile(month.key));
      const { accounts, out } = await priced();
      const per = new Map(accounts.map((a) => [a.id, { id: a.id, usd: 0, counts: { vm: 0, database: 0, bucket: 0 } }]));
      // What was accrued, including resources deleted since.
      for (const [, entry] of Object.entries(tally?.resources ?? {})) {
        if (per.has(entry.account)) per.get(entry.account).usd += entry.usd;
      }
      for (const r of out) {
        const row = per.get(r.account);
        row.usd += r.hourly * Math.max(0, (month.end - from(month, r, tally)) / HOUR);
        row.counts[r.type] += 1;
      }
      const rows = [...per.values()].map((r) => ({ ...r, usd: round(r.usd) }));
      const total = round(rows.reduce((sum, r) => sum + r.usd, 0));
      return {
        month: new Date(month.start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        resetsOn: new Date(month.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        total,
        accounts: rows.map((r) => ({ ...r, share: total ? r.usd / total : 0 })),
      };
    },
  };
}
