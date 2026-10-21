// Virtual machines (product.md §6.2–6.4): launching, listing, starting, stopping, restarting and deleting Linux VMs,
// and their health. Long work is an operation (steps/vm.js); this file checks what a person asks for, keeps the
// record's status in step with the operation, and says what happened. Who may: launch, start, stop and restart need
// `draft`; delete and SSH from anywhere need `approve` and a person (product.md §7).
import { HttpError, notFound, unprocessable } from '../util/errors.js';
import { needs, peopleOnly } from '../util/http.js';
import { isResourceName } from '../util/ids.js';
import { resourceNameProblem } from '../../public/js/shared/names.js';
import { CloudError, isCloudError } from '../providers/errors.js';
import { CLOUD } from './event-words.js';
import { who, inProgress } from './operations.js';
import { STATUS as CLOUD_STATUS } from './sync.js';
import { vmOperations } from './steps/vm.js';

const SIZES = ['small', 'medium', 'large'];
const MAX_DISK_GB = 2000;
const HEALTH_TTL_MS = 60_000;
const GB = 1e9;
const IPV4_CIDR = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([0-9]|[12]\d|3[0-2])$/;
const IPV6_CIDR = /^[0-9a-f:]{2,39}\/(\d|[1-9]\d|1[01]\d|12[0-8])$/i;

const STATUS = {
  starting: { text: 'Starting', tone: 'warning' },
  running: { text: 'Running', tone: 'success' },
  stopping: { text: 'Stopping', tone: 'warning' },
  stopped: { text: 'Stopped', tone: 'neutral' },
  restarting: { text: 'Restarting', tone: 'warning' },
  deleting: { text: 'Deleting', tone: 'warning' },
  failed: { text: 'Failed', tone: 'danger' },
  missing: { text: 'Missing in cloud', tone: 'danger' },
};

/** A person's address as a CIDR for "My IP only" (IPv4-mapped IPv6 is written as IPv4). */
export function ipCidr(ip) {
  const plain = String(ip ?? '').replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(plain)) return `${plain}/32`;
  if (/^[0-9a-f:]+$/i.test(plain) && plain.includes(':')) return `${plain}/128`;
  return null;
}

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const daysSince = (iso, at) => Math.floor((at - new Date(iso).getTime()) / 86_400_000);

export function createVms({ repos, host, operations, providers, remote, sshKeys, catalog, config, cost, now, log }) {
  const iso = () => new Date(now()).toISOString();
  const health = new Map();
  const setVm = (name, fn) => repos.vms.update(name, (r) => r && fn(r));
  const emit = (type, vm, account, extra = {}, actor = null) => host.events.emit(type, {
    resource: { type: 'vm', name: vm.name }, account: account?.id ?? vm.account, cloud: account?.cloud, name: vm.name, region: vm.spec?.region, ...extra,
  }, { actor });

  /** After a VM operation fails: the record says what the cloud says now (or Failed when the launch never finished). */
  async function settleFromCloud(ctx) {
    const name = ctx.op.resource.name;
    try {
      const vm = await repos.vms.get(name);
      const ref = vm?.ref?.instance ?? ctx.state?.instanceRef;
      const cloudVm = ref && ctx.provider ? await ctx.provider.compute.get(ref) : null;
      await setVm(name, (r) => ({ ...r, status: cloudVm && ctx.op.type !== 'vm.launch' ? CLOUD_STATUS.vm[cloudVm.status] ?? cloudVm.status : 'failed', failure: ctx.op.error?.message ?? null }));
    } catch (err) {
      log.warn(`after ${ctx.op.type} of ${name} failed: ${err.message}`);
      await setVm(name, (r) => ({ ...r, status: 'failed' }));
    }
  }

  const ops = vmOperations({ repos, config, remote, sshKeys, catalog, setVm });
  operations.define('vm.launch', {
    ...ops['vm.launch'],
    async succeeded(ctx) {
      const vm = await setVm(ctx.op.resource.name, (r) => ({ ...r, status: 'running', startedAt: iso(), runtime: { docker: ctx.state.docker || null }, failure: null }));
      await emit('infrastructure.vm.ready', vm, ctx.account, { ip: vm.observed?.publicIp ?? null }, ctx.op.requestedBy?.id);
    },
    failed: settleFromCloud,
    /** A cancelled launch never was: what it made is undone, and the record goes. */
    async cancelled(ctx) {
      await repos.vms.remove(ctx.op.resource.name);
    },
  });
  for (const [type, status, event, startedAt] of [
    ['vm.stop', 'stopped', 'infrastructure.vm.stopped', false],
    ['vm.start', 'running', 'infrastructure.vm.started', true],
    ['vm.restart', 'running', 'infrastructure.vm.restarted', true],
  ]) {
    operations.define(type, {
      ...ops[type],
      async succeeded(ctx) {
        await cost.accrue();
        const vm = await setVm(ctx.op.resource.name, (r) => ({
          ...r, status, failure: null, ...(startedAt ? { startedAt: iso() } : { stoppedAt: iso() }),
          observed: { ...(r.observed ?? {}), ...(ctx.state.cloud ?? {}), seenAt: iso() },
        }));
        health.delete(vm.name);
        await emit(event, vm, ctx.account, {}, ctx.op.requestedBy?.id);
      },
      failed: settleFromCloud,
      cancelled: settleFromCloud,
    });
  }
  operations.define('vm.delete', {
    ...ops['vm.delete'],
    async succeeded(ctx) {
      const vm = await repos.vms.get(ctx.op.resource.name);
      await cost.accrue();
      for (const endpoint of (await repos.endpoints.list()).filter((e) => e.vm === vm.name)) await repos.endpoints.remove(endpoint.id);
      await repos.vms.remove(vm.name);
      health.delete(vm.name);
      await emit('infrastructure.vm.deleted', vm, ctx.account, {}, ctx.op.requestedBy?.id);
    },
    failed: settleFromCloud,
    cancelled: settleFromCloud,
  });

  // ---------------------------------------------------------------- views

  async function context() {
    const [accounts, endpoints, apps, active, keys] = await Promise.all([
      repos.accounts.list(), repos.endpoints.list(), repos.apps.list(), operations.list({ status: 'active' }), repos.sshKeys.list(),
    ]);
    return { accounts: new Map(accounts.map((a) => [a.id, a])), endpoints, apps, active, keys: new Map(keys.map((k) => [k.id, k])) };
  }

  function sshText(spec) {
    if (spec?.sshFrom === 'my-ip') return 'my IP only';
    if (spec?.sshFrom === 'anywhere') return 'anywhere';
    return spec?.sshCidr ?? '—';
  }

  function view(vm, c) {
    const account = c.accounts.get(vm.account);
    const cat = account ? catalog.forCloud(account.cloud) : null;
    const type = cat?.machineTypes?.[vm.spec?.machineType];
    const image = cat?.images?.find((i) => i.id === vm.spec?.image);
    const op = c.active.find((o) => o.resource?.type === 'vm' && o.resource.name === vm.name) ?? null;
    const key = vm.missing ? 'missing' : vm.status;
    const status = STATUS[key] ?? { text: key, tone: 'neutral' };
    const endpoints = c.endpoints.filter((e) => e.vm === vm.name).sort((a, b) => a.host.localeCompare(b.host));
    const first = endpoints[0];
    const estimate = cost.estimateFor('vm', vm, account);
    const ip = vm.observed?.publicIp ?? null;
    const region = cat?.regions?.find((r) => r.id === vm.spec?.region);
    return {
      name: vm.name,
      role: vm.role ?? 'app',
      ownedBy: vm.ownedBy ?? null,
      account: vm.account,
      accountLabel: account ? (account.cloud === 'aws' && account.accountId ? `${account.name} · ${account.accountId.slice(-4)}` : account.name) : vm.account,
      cloud: account?.cloud ?? null,
      cloudLabel: CLOUD[account?.cloud] ?? null,
      zone: vm.spec?.zone ?? null,
      region: vm.spec?.region ?? null,
      regionLabel: region ? `${region.id} · ${region.label}` : vm.spec?.region ?? null,
      machineType: vm.spec?.machineType ?? null,
      size: type ? `${type.vcpu} vCPU · ${type.memoryGb} GB` : null,
      image: image?.label ?? vm.spec?.image ?? null,
      diskGb: vm.spec?.diskGb ?? null,
      status: key,
      statusText: op?.status === 'running' || op?.status === 'queued' ? (op.status === 'queued' ? `${status.text} · queued` : op.statusText) : status.text,
      tone: op ? 'warning' : status.tone,
      failure: vm.failure ?? null,
      publicIp: ip,
      publicIpText: ip ?? (key === 'starting' ? 'Assigning…' : '—'),
      sshCommand: ip ? `ssh ${image?.user ?? 'ubuntu'}@${ip}` : null,
      endpoint: first ? {
        host: first.host,
        more: endpoints.length - 1,
        note: key === 'stopped' ? 'Paused while stopped' : first.cert?.status === 'pending' ? 'Certificate pending' : null,
        live: key === 'running' && first.cert?.status !== 'pending',
      } : null,
      estimate: { monthly: estimate.monthly, note: key === 'stopped' ? 'disk only' : null },
      operation: op,
      can: {
        start: !op && key === 'stopped' && vm.role !== 'database',
        stop: !op && key === 'running' && vm.role !== 'database',
        restart: !op && key === 'running' && vm.role !== 'database',
        delete: !op && vm.role !== 'database' && key !== 'deleting',
      },
      createdAt: vm.createdAt,
      startedAt: vm.startedAt ?? null,
    };
  }

  async function mustGet(name) {
    const vm = isResourceName(name) ? await repos.vms.get(name) : null;
    if (!vm) throw notFound(`No VM ${name}.`);
    return vm;
  }

  async function detail(name) {
    const vm = await mustGet(name);
    const c = await context();
    const base = view(vm, c);
    const account = c.accounts.get(vm.account);
    const key = c.keys.get(vm.spec?.sshKeyId);
    const endpoints = c.endpoints.filter((e) => e.vm === name).sort((a, b) => a.host.localeCompare(b.host));
    const ports = [`22 (${sshText(vm.spec)})`, ...(endpoints.length ? ['80', '443'] : [])];
    const recent = (await operations.list({ resource: `vm:${name}` })).slice(0, 5);
    return {
      ...base,
      uptimeText: base.status === 'running' && vm.startedAt ? `up ${plural(Math.max(0, daysSince(vm.startedAt, now())), 'day')}` : null,
      privateIp: vm.observed?.privateIp ?? null,
      staticIp: Boolean(vm.ref?.address),
      sshKey: key ? `${key.name} · ${key.type}` : null,
      ports: ports.join(' · '),
      runtime: [vm.runtime?.docker ? `Docker ${vm.runtime.docker.split('.')[0]}` : (vm.spec?.docker === false ? 'No Docker' : null), endpoints.length ? 'HTTPS proxy' : null].filter(Boolean).join(' · ') || null,
      createdBy: vm.createdBy ?? null,
      endpoints: endpoints.map((e) => ({
        id: e.id,
        host: e.host,
        url: base.status === 'running' && e.cert?.status === 'valid' ? `https://${e.host}` : null,
        app: e.app ?? null,
        port: e.port ?? null,
        cert: e.cert?.status === 'valid' ? { text: 'Valid', tone: 'success', expiresAt: e.cert.expiresAt ?? null }
          : e.cert?.status === 'pending' ? { text: 'Pending', tone: 'warning' }
            : e.cert?.status === 'self-signed' ? { text: 'Self-signed', tone: 'neutral' } : { text: e.cert?.status ?? '—', tone: 'neutral' },
        dns: e.dns?.status === 'verified' ? { text: 'Verified', tone: 'success' } : e.dns?.status ? { text: 'Waiting for DNS record', tone: 'warning' } : { text: 'Not needed', tone: 'neutral' },
      })),
      apps: c.apps.filter((a) => a.vm === name).sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({
        name: a.name,
        repo: String(a.source?.repo ?? '').replace(/^https:\/\//, '').replace(/\.git$/, ''),
        branch: a.source?.branch ?? null,
        dockerfile: a.source?.dockerfile ?? null,
        commit: a.current?.commit ?? null,
        deployedAt: a.current?.deployedAt ?? null,
        status: a.status,
        autoDeploy: a.autoDeploy ? `On push to ${a.source?.branch ?? 'main'}` : 'Off',
      })),
      operations: recent,
      accountState: account?.state ?? null,
    };
  }

  // ---------------------------------------------------------------- checking what is asked

  async function validateLaunch(body, person, { ip }) {
    const fields = {};
    const account = typeof body.account === 'string' && isResourceName(body.account) ? await repos.accounts.get(body.account) : null;
    if (!account) fields.account = 'Pick a connected cloud account.';
    else if (account.state !== 'connected') fields.account = `${account.name} is not connected (${account.state === 'connecting' ? 'still connecting' : 'it needs attention'}).`;
    const cat = account ? catalog.forCloud(account.cloud) : null;

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const nameProblem = resourceNameProblem(name);
    if (nameProblem) fields.name = nameProblem;
    else if (await repos.vms.get(name)) fields.name = `There is already a VM called ${name}.`;

    const region = cat?.regions.find((r) => r.id === body.region);
    if (cat && !region) fields.region = 'Pick a region.';
    if (region && !region.zones.includes(body.zone)) fields.zone = 'Pick a zone in that region.';

    let machineType = null;
    if (SIZES.includes(body.size)) machineType = cat?.sizes?.[body.size] ?? null;
    else if (body.size === 'custom') {
      machineType = body.machineType;
      if (cat && !cat.machineTypes[machineType]) fields.machineType = `Pick one of ${Object.keys(cat.machineTypes).join(', ')}.`;
    } else fields.size = 'Pick a size.';

    if (cat && !cat.images.some((i) => i.id === body.image)) fields.image = 'Pick a Linux image.';
    const diskGb = Number(body.diskGb);
    const minGb = cat?.disk?.minGb ?? 10;
    if (!Number.isInteger(diskGb) || diskGb < minGb || diskGb > MAX_DISK_GB) fields.diskGb = `Between ${minGb} and ${MAX_DISK_GB} GB, in whole GB.`;

    let sshKeyId = typeof body.sshKeyId === 'string' && body.sshKeyId ? body.sshKeyId : null;
    if (sshKeyId && !(await repos.sshKeys.get(sshKeyId))) fields.sshKeyId = 'Pick a saved key, or paste a new one.';
    if (!sshKeyId && !body.publicKey) fields.sshKeyId = 'Pick a saved key, or paste a new one.';

    let sshCidr = null;
    if (body.sshFrom === 'my-ip') {
      sshCidr = ipCidr(ip);
      if (!sshCidr) fields.sshFrom = 'Your address could not be told: pick a custom range.';
    } else if (body.sshFrom === 'anywhere') sshCidr = '0.0.0.0/0';
    else if (body.sshFrom === 'custom') {
      sshCidr = String(body.sshCidr ?? '').trim();
      if (!IPV4_CIDR.test(sshCidr) && !IPV6_CIDR.test(sshCidr)) fields.sshCidr = 'An address range such as 196.25.1.0/24.';
    } else fields.sshFrom = 'Say where SSH may come from.';

    if (Object.keys(fields).length) throw unprocessable('Check the highlighted fields.', { fields });
    // Opening SSH to the whole internet is a deliberate choice, by a person who may approve.
    if (body.sshFrom === 'anywhere') {
      await peopleOnly(host, person, 'open SSH to anywhere');
      await needs(host, person, 'approve', 'open SSH to anywhere');
    }
    if (!sshKeyId) {
      try {
        sshKeyId = (await sshKeys.add({ name: body.keyName || `${name} key`, publicKey: body.publicKey }, person)).id;
      } catch (err) {
        if (err.details?.fields?.publicKey) throw unprocessable('Check the highlighted fields.', { fields: { publicKey: err.details.fields.publicKey } });
        throw err;
      }
    }
    return {
      account,
      name,
      spec: {
        region: region.id, zone: body.zone, size: body.size, machineType, image: body.image, diskGb,
        docker: body.docker !== false && body.docker !== 'false', sshKeyId, sshFrom: body.sshFrom, sshCidr,
      },
    };
  }

  async function busy(name) {
    const op = (await operations.list({ resource: `vm:${name}`, status: 'active' }))[0];
    if (op) throw new HttpError(409, 'conflict', `${name} is busy: ${op.label} (${op.statusText}). Wait for it, or cancel it.`, { operation: op.id });
  }

  /** start / stop / restart: the VM must be in `from`, and becomes `during` until the operation ends. */
  async function act(name, person, { type, from, during, action }) {
    await needs(host, person, 'draft', `${action} ${name}`);
    const vm = await mustGet(name);
    if (vm.role === 'database') throw new HttpError(409, 'conflict', `${name} runs the database ${vm.ownedBy}: start, stop and resize it from Databases.`);
    await busy(name);
    if (vm.missing) throw new HttpError(409, 'conflict', `${name} is no longer in the cloud.`);
    if (!from.includes(vm.status)) throw new HttpError(409, 'conflict', `${name} is ${STATUS[vm.status]?.text.toLowerCase() ?? vm.status}; it can't be ${action === 'stop' ? 'stopped' : `${action}ed`} now.`);
    await cost.accrue();
    await setVm(name, (r) => ({ ...r, status: during }));
    const operation = await operations.start(type, { resource: { type: 'vm', name }, account: vm.account, person });
    return { operation };
  }

  return {
    view,
    async list({ cloud, q, role = 'app' } = {}) {
      const c = await context();
      const needle = String(q ?? '').trim().toLowerCase();
      return (await repos.vms.list())
        .filter((vm) => (role === 'all' ? true : (vm.role ?? 'app') === role))
        .map((vm) => view(vm, c))
        .filter((v) => !cloud || v.cloud === cloud)
        .filter((v) => !needle || [v.name, v.publicIp, v.endpoint?.host, ...c.endpoints.filter((e) => e.vm === v.name).map((e) => e.host)]
          .filter(Boolean).some((s) => s.toLowerCase().includes(needle)))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    get: detail,

    /** Launches a VM: checks the spec, writes the record (Starting), and queues vm.launch. */
    async launch(body, person, { ip } = {}) {
      await needs(host, person, 'draft', 'launch a VM');
      const { account, name, spec } = await validateLaunch(body ?? {}, person, { ip });
      const vm = { name, role: 'app', account: account.id, status: 'starting', spec, ref: {}, createdAt: iso(), createdBy: who(person) };
      await repos.vms.write(vm);
      await emit('infrastructure.vm.created', vm, account, {}, person?.id);
      const operation = await operations.start('vm.launch', { resource: { type: 'vm', name }, account: account.id, person });
      return { vm: view(vm, await context()), operation };
    },
    start: (name, person) => act(name, person, { type: 'vm.start', from: ['stopped'], during: 'starting', action: 'start' }),
    stop: (name, person) => act(name, person, { type: 'vm.stop', from: ['running'], during: 'stopping', action: 'stop' }),
    restart: (name, person) => act(name, person, { type: 'vm.restart', from: ['running'], during: 'restarting', action: 'restart' }),

    /** Deletes a VM that has no apps. The person types its name to confirm. */
    async remove(name, body, person) {
      await peopleOnly(host, person, `delete ${name}`);
      await needs(host, person, 'approve', `delete ${name}`);
      const vm = await mustGet(name);
      if (body?.confirm !== name) throw unprocessable(`Type the VM's name (${name}) to delete it.`, { fields: { confirm: `Type ${name}.` } });
      if (vm.role === 'database') throw new HttpError(409, 'conflict', `${name} runs the database ${vm.ownedBy}: delete the database instead.`);
      const apps = (await repos.apps.list()).filter((a) => a.vm === name).map((a) => a.name);
      if (apps.length) throw new HttpError(409, 'conflict', `${name} runs ${apps.join(', ')}. Delete or move ${apps.length === 1 ? 'that app' : 'those apps'} first.`, { apps });
      await busy(name);
      await setVm(name, (r) => ({ ...r, status: 'deleting' }));
      const operation = await operations.start('vm.delete', { resource: { type: 'vm', name }, account: vm.account, person });
      return { operation };
    },

    /** CPU from the cloud, memory, disk and uptime from inside the VM; kept a minute. */
    async health(name) {
      const vm = await mustGet(name);
      const cached = health.get(name);
      if (cached && now() - cached.at < HEALTH_TTL_MS) return cached.value;
      const account = await repos.accounts.get(vm.account);
      const value = { name, at: iso(), cpuPercent: null, memory: null, disk: null, uptimeSeconds: null, requests: null, problem: null };
      if (vm.status !== 'running' || vm.missing) {
        value.problem = `${name} is ${STATUS[vm.missing ? 'missing' : vm.status]?.text.toLowerCase() ?? vm.status}.`;
      } else {
        try {
          const provider = await providers.forAccount(account);
          value.cpuPercent = (await provider.metrics.vm(vm.ref?.instance, '1h')).cpuPercent;
          const runner = await remote.forVm(vm, account);
          try {
            const result = await runner.run('health', []);
            if (result.code !== 0) throw new CloudError('unavailable', `${name} did not answer on SSH.`);
            const h = JSON.parse(result.stdout.trim().split('\n').pop());
            value.memory = { usedGb: h.memory.usedBytes / GB, totalGb: h.memory.totalBytes / GB };
            value.disk = { usedGb: h.disk.usedBytes / GB, totalGb: h.disk.totalBytes / GB };
            value.uptimeSeconds = h.uptimeSeconds;
          } finally {
            runner.close();
          }
        } catch (err) {
          if (!isCloudError(err)) log.warn(`health of ${name}: ${err.stack ?? err.message}`);
          value.problem = isCloudError(err) ? err.message : `${name}'s health could not be read.`;
        }
      }
      health.set(name, { at: now(), value });
      return value;
    },
    inProgress,
  };
}
