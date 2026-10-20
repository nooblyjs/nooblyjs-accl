// The inventory sync (architecture.md §8): the cloud is the source of truth for what exists. For each connected
// account, list what carries this install's label and compare it with the records: what the cloud says goes into
// `observed`; a status changed in the cloud console becomes the record's status; a resource the cloud no longer has is
// marked `missing` (and said once), never deleted. A resource with an operation under way is left to its operation.

/** A cloud status → the record's status, per kind. Anything else is kept as the cloud says it. */
const STATUS = {
  vm: { provisioning: 'starting', running: 'running', stopping: 'stopping', stopped: 'stopped', terminated: 'stopped', deleting: 'deleting' },
  database: { creating: 'creating', available: 'available', 'backing-up': 'backing-up', stopped: 'stopped', deleting: 'deleting' },
  bucket: { ready: 'ready' },
};
/** A MongoDB database runs on its own VM (architecture.md §9): the database is as available as that VM. */
const DATABASE_ON_VM = { provisioning: 'creating', running: 'available', stopping: 'stopping', stopped: 'stopped', terminated: 'stopped', deleting: 'deleting' };

/** Record statuses that are on their way somewhere: while any record has one, the sync runs every minute. */
export const TRANSITIONAL = new Set(['starting', 'stopping', 'deleting', 'creating', 'backing-up', 'restoring', 'resizing', 'building']);

const OBSERVED = {
  vm: (r) => ({ status: r.status, publicIp: r.publicIp ?? null, privateIp: r.privateIp ?? null, machineType: r.machineType ?? null }),
  database: (r) => ({ status: r.status, storageUsedGb: r.storageUsedGb ?? null, host: r.host ?? null }),
  bucket: (r) => ({ status: r.status, bytes: r.bytes ?? 0, objects: r.objects ?? 0 }),
};

export function createSync({ repos, operations, providers, config, host, log, now }) {
  const iso = () => new Date(now()).toISOString();

  async function reconcile(type, repo, account, found, busy) {
    const byName = new Map(found.map((r) => [r.labels?.['noobly-name'], r]));
    for (const record of (await repo.list()).filter((r) => r.account === account.id)) {
      if (busy.has(`${type}:${record.name}`)) continue;
      const resource = { type, name: record.name };
      const inCloud = byName.get(record.name);
      if (!inCloud) {
        if (!record.missing) {
          await repo.update(record.name, (r) => r && { ...r, missing: true, missingSince: iso() });
          await host.events.emit('infrastructure.resource.missing', { resource, account: account.id, cloud: account.cloud }, { actor: null });
        }
        continue;
      }
      const status = STATUS[type][inCloud.status] ?? inCloud.status;
      const changed = !record.missing && record.status && status !== record.status;
      await repo.update(record.name, (r) => r && { ...r, status, observed: { ...OBSERVED[type](inCloud), seenAt: iso() }, missing: false, missingSince: null });
      if (changed) {
        await host.events.emit('infrastructure.resource.changed', { resource, account: account.id, cloud: account.cloud, status, was: record.status }, { actor: null });
      }
    }
  }

  return {
    /** Compares every connected account's cloud with the records. */
    async inventory() {
      const busy = await operations.busy();
      const labels = { 'noobly-install': await config.installId() };
      for (const account of await repos.accounts.list()) {
        if (account.state !== 'connected') continue;
        let found;
        try {
          found = await (await providers.forAccount(account)).inventory({ labels });
        } catch (err) {
          log.warn(`inventory of ${account.id}: ${err.message}`);
          continue;
        }
        await reconcile('vm', repos.vms, account, found.vms ?? [], busy);
        // The cloud lists a MongoDB database's VM, not a database: describe it as one, from its VM.
        const vms = new Map((found.vms ?? []).map((v) => [v.labels?.['noobly-name'], v]));
        const onVms = (await repos.databases.list())
          .filter((d) => d.account === account.id && d.hosting === 'vm' && vms.has(d.vm))
          .map((d) => ({ labels: { 'noobly-name': d.name }, status: DATABASE_ON_VM[vms.get(d.vm).status] ?? vms.get(d.vm).status }));
        await reconcile('database', repos.databases, account, [...(found.databases ?? []), ...onVms], busy);
        await reconcile('bucket', repos.buckets, account, found.buckets ?? [], busy);
      }
    },
    /** Every minute while anything is changing, else every five. */
    async every() {
      if ((await operations.busy()).size) return 60_000;
      const records = [...await repos.vms.list(), ...await repos.databases.list(), ...await repos.buckets.list()];
      return records.some((r) => TRANSITIONAL.has(r.status)) ? 60_000 : 300_000;
    },
  };
}
