// The mock provider (architecture.md §6.3): the provider contract over a MockCloud, pretending to be the account's
// cloud (GCP or AWS: its regions, machine types and address style come from that cloud's catalogue). The default,
// and the only provider until roadmap phase 2. Deterministic and offline.
import { CloudError } from '../errors.js';
import { hasLabels } from '../contract.js';
import { mockId } from './cloud.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});

/** A documentation address (RFC 5737), unused in this cloud. */
function freeAddress(state) {
  const used = new Set(state.resources.map((r) => r.address).filter(Boolean));
  for (let i = 0; i < 2000; i++) {
    const ip = `${['203.0.113', '198.51.100', '192.0.2'][i % 3]}.${10 + Math.floor(Math.random() * 240)}`;
    if (!used.has(ip)) return ip;
  }
  throw new CloudError('quota', 'The mock cloud has run out of addresses.');
}

/**
 * @param {object} o
 * @param {object} o.account       the account record (cloud, projectId/accountId)
 * @param {*} o.credentials        what the person connected it with (from secrets)
 * @param {import('./cloud.js').MockCloud} o.cloud
 * @param {object} o.catalog       the account's cloud's catalogue
 */
export function createMockProvider({ account, credentials, cloud, catalog }) {
  const guard = (method, fn) => async (...args) => {
    cloud.check(method);
    return fn(...args);
  };
  const region = (id) => {
    const found = catalog.regions.find((r) => r.id === id);
    if (!found) throw new CloudError('invalid', `${catalog.short} has no region ${id}.`);
    return found;
  };
  const regionOfZone = (zone) => catalog.regions.find((r) => r.zones.includes(zone)) ?? null;
  const find = (state, ref, kind) => {
    const r = state.resources.find((x) => x.id === ref && (!kind || x.kind === kind));
    if (!r) throw new CloudError('not_found', `The mock cloud has no ${kind ?? 'resource'} ${ref}.`);
    return r;
  };
  const copy = (r) => (r ? structuredClone(r) : null);

  /** Moves a VM through `during` to `after` (its status), as one cloud operation. */
  const transition = (method, during, after, units) => guard(method, (ref) => cloud.mutate((state) => {
    const vm = find(state, ref, 'vm');
    vm.status = during;
    return { ref, operation: cloud.begin(state, ref, method, after, units) };
  }));

  const account_ = {
    verify: guard('account.verify', async () => {
      const text = typeof credentials === 'string' ? credentials : JSON.stringify(credentials ?? '');
      if (!credentials || text === '""') return { ok: false, message: 'No credentials were given.' };
      if (/invalid/i.test(text)) return { ok: false, message: 'The mock cloud refused these credentials.' };
      const who = account.cloud === 'gcp' ? `project ${account.projectId ?? account.id}` : `account ${account.accountId ?? account.id}`;
      return { ok: true, identity: `mock ${catalog.short} ${who}` };
    }),
    regions: guard('account.regions', async () => catalog.regions.map((r) => ({ id: r.id, label: r.label, zones: [...r.zones] }))),
    zones: guard('account.zones', async (id) => [...region(id).zones]),
    detectNetwork: guard('account.detectNetwork', async (id, { labels = {} } = {}) => {
      const [net] = await cloud.resources((r) => r.kind === 'network' && r.region === id && hasLabels(r, labels));
      return net?.id ?? null;
    }),
    /** The network VMs and databases in a region join. Finds the one carrying `labels`, or makes it. */
    ensureNetwork: guard('account.ensureNetwork', async (id, { labels = {} } = {}) => {
      region(id);
      return cloud.mutate((state) => {
        const net = state.resources.find((r) => r.kind === 'network' && r.region === id && hasLabels(r, labels));
        if (net) {
          const pending = state.operations.find((o) => o.resource === net.id && !o.applied);
          return { ref: net.id, operation: pending ? { kind: 'mock', id: pending.id } : null, created: false };
        }
        const ref = mockId('net');
        state.resources.push({ id: ref, kind: 'network', name: 'noobly-cloud', region: id, status: 'creating', labels, createdAt: new Date(cloud.now()).toISOString() });
        return { ref, operation: cloud.begin(state, ref, 'account.ensureNetwork', { status: 'ready' }, 2), created: true };
      });
    }),
  };

  const compute = {
    /** spec: { name, zone, machineType, image, diskGb, labels, userData, address?, network? } */
    create: guard('compute.create', async (spec) => {
      if (!catalog.machineTypes[spec.machineType]) throw new CloudError('invalid', `${catalog.short} has no machine type ${spec.machineType}.`);
      const where = regionOfZone(spec.zone);
      if (!where) throw new CloudError('invalid', `${catalog.short} has no zone ${spec.zone}.`);
      return cloud.mutate((state) => {
        if (state.resources.some((r) => r.kind === 'vm' && r.name === spec.name)) throw new CloudError('conflict', `There is already a VM called ${spec.name} in this account.`);
        const ref = mockId('vm');
        const address = spec.address ? state.resources.find((r) => r.id === spec.address)?.address ?? null : null;
        state.resources.push({
          id: ref, kind: 'vm', name: spec.name, zone: spec.zone, region: where.id, machineType: spec.machineType, image: spec.image,
          diskGb: spec.diskGb, status: 'provisioning', publicIp: address, privateIp: `10.10.0.${10 + state.resources.length}`,
          firewall: [], userData: spec.userData ?? '', labels: spec.labels ?? {}, createdAt: new Date(cloud.now()).toISOString(),
        });
        return { ref, operation: cloud.begin(state, ref, 'compute.create', { status: 'running' }, 3) };
      });
    }),
    get: guard('compute.get', async (ref) => copy((await cloud.resources((r) => r.id === ref && r.kind === 'vm'))[0])),
    list: guard('compute.list', async ({ labels = {} } = {}) => cloud.resources((r) => r.kind === 'vm' && hasLabels(r, labels))),
    start: transition('compute.start', 'provisioning', { status: 'running' }, 2),
    stop: transition('compute.stop', 'stopping', { status: 'stopped' }, 1),
    restart: transition('compute.restart', 'stopping', { status: 'running' }, 2),
    remove: guard('compute.remove', (ref) => cloud.mutate((state) => {
      const vm = find(state, ref, 'vm');
      vm.status = 'deleting';
      return { ref, operation: cloud.begin(state, ref, 'compute.remove', null, 1) };
    })),
    reserveAddress: guard('compute.reserveAddress', async (id, { labels = {} } = {}) => {
      region(id);
      return cloud.mutate((state) => {
        const ref = mockId('ip');
        const address = freeAddress(state);
        state.resources.push({ id: ref, kind: 'address', region: id, address, status: 'reserved', labels, createdAt: new Date(cloud.now()).toISOString() });
        return { ref, address, operation: null };
      });
    }),
    releaseAddress: guard('compute.releaseAddress', (ref) => cloud.mutate((state) => {
      const i = state.resources.findIndex((r) => r.id === ref && r.kind === 'address');
      if (i >= 0) state.resources.splice(i, 1);
      return { ref, operation: null };
    })),
    /** rules: [{ port, from }] — replaces the VM's inbound rules. */
    setFirewall: guard('compute.setFirewall', (ref, rules) => cloud.mutate((state) => {
      find(state, ref, 'vm').firewall = structuredClone(rules ?? []);
      return { ref, operation: null };
    })),
    /** The VM's public address as its cloud names it: AWS's public DNS name, or GCP's IP (GCP gives no hostname). */
    defaultAddress: guard('compute.defaultAddress', async (ref) => {
      const vm = (await cloud.resources((r) => r.id === ref && r.kind === 'vm'))[0];
      if (!vm?.publicIp) return null;
      return account.cloud === 'aws' ? `ec2-${vm.publicIp.replaceAll('.', '-')}.${vm.region}.compute.amazonaws.com` : vm.publicIp;
    }),
  };

  return {
    name: 'mock',
    cloud: account.cloud,
    account: account_,
    catalog: {
      machineTypes: guard('catalog.machineTypes', async (zone) => {
        if (!regionOfZone(zone)) throw new CloudError('invalid', `${catalog.short} has no zone ${zone}.`);
        return Object.entries(catalog.machineTypes).map(([id, m]) => ({ id, vcpu: m.vcpu, memoryGb: m.memoryGb }));
      }),
      images: guard('catalog.images', async () => catalog.images.map((i) => ({ id: i.id, label: i.label }))),
    },
    compute,
    metrics: {
      /** CPU over the window (the cloud's monitoring); the seed story sets `sim` from the mockups. */
      vm: guard('metrics.vm', async (ref, window = '1h') => {
        const vm = (await cloud.resources((r) => r.id === ref && r.kind === 'vm'))[0];
        if (!vm) throw new CloudError('not_found', `The mock cloud has no VM ${ref}.`);
        if (vm.status !== 'running') return { window, cpuPercent: null };
        return { window, cpuPercent: vm.sim?.cpuPercent ?? 12 };
      }),
    },
    /** Everything carrying `labels`, by kind: what the inventory sync compares with the records. */
    inventory: guard('inventory', async ({ labels = {} } = {}) => {
      const all = await cloud.resources((r) => hasLabels(r, labels));
      const of = (kind) => all.filter((r) => r.kind === kind);
      return { vms: of('vm'), databases: of('database'), buckets: of('bucket'), networks: of('network'), addresses: of('address') };
    }),
    /** Waits for a cloud operation; onProgress(fraction) as it goes. Rejects when `signal` aborts. */
    async waitFor(handle, { signal, onProgress } = {}) {
      if (!handle) return;
      for (;;) {
        const { done, fraction } = await cloud.progress(handle);
        if (done) return;
        onProgress?.(fraction);
        await sleep(Math.max(10, Math.min(250, cloud.stepMs / 4)), signal);
      }
    },
    /** The mock's controls (failAt, outOfBand, resources), for tests and demos. Not part of the contract. */
    mock: cloud,
  };
}
