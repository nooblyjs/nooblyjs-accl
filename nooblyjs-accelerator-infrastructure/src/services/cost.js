// What things cost (architecture.md §12). Each resource's monthly estimate comes from its spec and its cloud's
// catalogue, through the same estimate() the create forms use. "Spend this month" is an estimate for the whole month:
// each resource at its current rate, from the start of the month or from when it was created if later. A stopped VM
// counts its disk only. Real billed spend is a later phase (roadmap 7.4).
import { estimate, HOURS_PER_MONTH } from '../../public/js/shared/estimate.js';

const HOUR = 3_600_000;

export function createCost({ repos, catalog, now }) {
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

  /** Every resource that costs money, with its account and estimate. A MongoDB database's VM counts in the database. */
  async function priced() {
    const [accounts, vms, databases, buckets] = await Promise.all([repos.accounts.list(), repos.vms.list(), repos.databases.list(), repos.buckets.list()]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const out = [];
    const add = (type, record) => {
      const account = byId.get(record.account);
      if (account) out.push({ type, name: record.name, account: account.id, createdAt: record.createdAt, estimate: estimateFor(type, record, account) });
    };
    vms.filter((v) => v.role !== 'database').forEach((v) => add('vm', v));
    databases.forEach((d) => add('database', d));
    buckets.forEach((b) => add('bucket', b));
    return { accounts, out };
  }

  return {
    estimateFor,
    /**
     * This month, per account and in total: each resource at its current rate for the hours of this month it exists.
     * { month, resetsOn, total, accounts: [{ id, usd, share, counts }] }
     */
    async month(at = now()) {
      const d = new Date(at);
      const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      const { accounts, out } = await priced();
      const per = new Map(accounts.map((a) => [a.id, { id: a.id, usd: 0, counts: { vm: 0, database: 0, bucket: 0 } }]));
      for (const r of out) {
        const from = Math.max(start, new Date(r.createdAt ?? start).getTime() || start);
        const hours = Math.max(0, (end - from) / HOUR);
        const row = per.get(r.account);
        row.usd += (r.estimate.monthly ?? 0) / HOURS_PER_MONTH * hours;
        row.counts[r.type] += 1;
      }
      const rows = [...per.values()].map((r) => ({ ...r, usd: Math.round(r.usd * 100) / 100 }));
      const total = Math.round(rows.reduce((sum, r) => sum + r.usd, 0) * 100) / 100;
      return {
        month: new Date(start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        resetsOn: new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        total,
        accounts: rows.map((r) => ({ ...r, share: total ? r.usd / total : 0 })),
      };
    },
  };
}
