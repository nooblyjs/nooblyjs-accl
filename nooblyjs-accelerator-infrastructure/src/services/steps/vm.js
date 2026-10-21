// The VM operations (architecture.md §7): vm.launch ("Starting · 1 of 3"), vm.start, vm.stop, vm.restart, vm.delete.
// Every step finds its work by the VM's labels before doing anything, and keeps the cloud's ids before waiting, so
// running it again after a crash or a restart never makes a second machine or address.
import { CloudError } from '../../providers/errors.js';
import { cloudInit } from '../../remote/cloud-init.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason ?? new Error('aborted'));
  }, { once: true });
});

/** The inbound rules a VM gets: SSH from where the person said (and from Noobly Cloud's own address). */
export function firewallRules(spec, controlCidr = process.env.INFRA_CONTROL_CIDR) {
  const rules = [{ port: 22, from: spec.sshCidr, why: 'ssh' }];
  for (const cidr of String(controlCidr ?? '').split(',').map((c) => c.trim()).filter(Boolean)) {
    if (cidr !== spec.sshCidr) rules.push({ port: 22, from: cidr, why: 'noobly-cloud' });
  }
  return rules;
}

/**
 * Runs wait-ready until the VM says its first boot is done. A VM not answering yet (SSH not up) is tried again for
 * up to `patienceMs`; a first boot that ran but didn't finish fails at once.
 */
async function waitReady(ctx, remote, vm, patienceMs = 10 * 60_000) {
  const runner = await remote.forVm(vm, ctx.account);
  const until = ctx.now() + patienceMs;
  try {
    for (let attempt = 1; ; attempt++) {
      let result;
      try {
        result = await runner.run('wait-ready', [], { signal: ctx.signal });
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        result = { code: 255, stderr: err.message };
      }
      if (result.code === 0) return JSON.parse(result.stdout.trim().split('\n').pop());
      if (result.code === 3) throw new CloudError('unavailable', `${vm.name} did not finish its first boot. Its serial console in the cloud says why.`);
      if (ctx.now() > until) throw new CloudError('unavailable', `${vm.name} did not answer on SSH for ${Math.round(patienceMs / 60_000)} minutes.`);
      if (attempt === 1) await ctx.log(`Waiting for ${vm.name} to answer on SSH`);
      await sleep(Math.min(10_000, 500 * attempt), ctx.signal);
    }
  } finally {
    runner.close();
  }
}

/**
 * @param {object} o
 * @param {object} o.repos
 * @param {object} o.config       labels()
 * @param {object} o.remote       forVm(), controlKey()
 * @param {object} o.sshKeys      publicKey()
 * @param {object} o.catalog
 * @param {(name: string, patch: object|((r) => object)) => Promise<object>} o.setVm   updates the VM's record
 */
export function vmOperations({ repos, config, remote, sshKeys, catalog, setVm }) {
  const labelsOf = (name) => config.labels({ 'noobly-name': name });
  const recordOf = async (ctx) => repos.vms.get(ctx.op.resource.name);
  /** The VM's instance id: kept in the operation, then the record, else found by its labels. */
  const instanceOf = async (ctx) => ctx.state.instanceRef ?? (await recordOf(ctx))?.ref?.instance
    ?? (await ctx.provider.compute.list({ labels: await labelsOf(ctx.op.resource.name) }))[0]?.id ?? null;

  /** Moves the machine with `action` unless it is already `target`; waits for it. Returns the cloud's VM. */
  async function move(ctx, action, target) {
    const ref = await instanceOf(ctx);
    if (!ref) throw new CloudError('not_found', `${ctx.op.resource.name} is no longer in the cloud.`);
    if (ctx.state.moveOperation) {
      await ctx.wait(ctx.state.moveOperation);
    } else {
      const now = await ctx.provider.compute.get(ref);
      if (!now) throw new CloudError('not_found', `${ctx.op.resource.name} is no longer in the cloud.`);
      if (now.status !== target) {
        const { operation } = await ctx.provider.compute[action](ref);
        await ctx.save({ moveOperation: operation });
        await ctx.wait(operation);
      }
    }
    await ctx.save({ moveOperation: null });
    return ctx.provider.compute.get(ref);
  }

  const observe = (cloudVm) => ({ status: cloudVm.status, publicIp: cloudVm.publicIp ?? null, privateIp: cloudVm.privateIp ?? null, machineType: cloudVm.machineType });
  const ready = {
    key: 'ready',
    label: 'Wait until it is ready',
    async run(ctx) {
      const result = await waitReady(ctx, remote, await recordOf(ctx));
      return { state: { docker: result.docker ?? '' } };
    },
  };

  return {
    'vm.launch': {
      label: (op) => `Launch ${op.resource.name}`,
      verb: 'Starting',
      steps: [
        {
          key: 'create',
          label: 'Create the machine',
          async run(ctx) {
            const name = ctx.op.resource.name;
            const vm = await recordOf(ctx);
            const spec = vm.spec;
            const labels = await labelsOf(name);
            const compute = ctx.provider.compute;

            // The network of the region (made when the account was connected, or now for another region).
            let network = ctx.account.network?.[spec.region] ?? ctx.state.networkRef ?? null;
            if (!network) {
              const made = await ctx.provider.account.ensureNetwork(spec.region, { labels: await config.labels({ 'noobly-name': 'noobly-cloud' }) });
              network = made.ref;
              await ctx.save({ networkRef: network });
              if (made.operation) await ctx.wait(made.operation);
            }

            // A static public address, kept while the VM is stopped.
            let address = ctx.state.addressRef ?? (await ctx.provider.inventory({ labels })).addresses?.[0]?.id ?? null;
            if (!address) {
              address = (await compute.reserveAddress(spec.region, { labels })).ref;
              await ctx.save({ addressRef: address });
            }

            // The machine, with its first boot.
            let instance = await instanceOf(ctx);
            if (!instance) {
              const image = catalog.forCloud(ctx.account.cloud).images.find((i) => i.id === spec.image);
              const personKey = await sshKeys.publicKey(spec.sshKeyId);
              if (!personKey) throw new CloudError('invalid', 'The VM\'s SSH key has been removed. Launch it again with another.');
              const userData = cloudInit({ personKey, controlKey: (await remote.controlKey()).publicKey, docker: spec.docker, packages: image?.packages });
              const made = await compute.create({ name, zone: spec.zone, machineType: spec.machineType, image: spec.image, diskGb: spec.diskGb, labels, userData, address, network });
              instance = made.ref;
              await ctx.save({ instanceRef: instance, createOperation: made.operation });
              await ctx.log(`Creating ${spec.machineType} in ${spec.zone}`);
              await ctx.wait(made.operation);
            } else if (ctx.state.createOperation) {
              await ctx.wait(ctx.state.createOperation);
            }
            await compute.setFirewall(instance, firewallRules(spec));
            const cloudVm = await compute.get(instance);
            await setVm(name, (r) => ({ ...r, ref: { instance, address, network }, observed: { ...observe(cloudVm), seenAt: new Date(ctx.now()).toISOString() } }));
            await ctx.log(`${name} is up at ${cloudVm.publicIp ?? 'a private address'}`);
            return { state: { instanceRef: instance, addressRef: address, networkRef: network, createOperation: null } };
          },
          /** Cancelled: delete what was made, as far as it got. */
          async undo(ctx) {
            const labels = await labelsOf(ctx.op.resource.name);
            const instance = ctx.state.instanceRef ?? (await ctx.provider.compute.list({ labels }))[0]?.id;
            if (instance && await ctx.provider.compute.get(instance)) await ctx.provider.waitFor((await ctx.provider.compute.remove(instance)).operation);
            const address = ctx.state.addressRef ?? (await ctx.provider.inventory({ labels })).addresses?.[0]?.id;
            if (address) await ctx.provider.compute.releaseAddress(address);
          },
        },
        { ...ready, key: 'prepare', label: 'Prepare it' },
        {
          key: 'endpoint',
          label: 'Public endpoint',
          // Public endpoints arrive in roadmap phase 3.
          run: async () => ({ skipped: true, reason: 'no public endpoint' }),
        },
      ],
    },

    'vm.stop': {
      label: (op) => `Stop ${op.resource.name}`,
      verb: 'Stopping',
      steps: [{ key: 'stop', label: 'Stop the machine', run: async (ctx) => ({ state: { cloud: observe(await move(ctx, 'stop', 'stopped')) } }) }],
    },

    'vm.start': {
      label: (op) => `Start ${op.resource.name}`,
      verb: 'Starting',
      steps: [
        { key: 'start', label: 'Start the machine', run: async (ctx) => ({ state: { cloud: observe(await move(ctx, 'start', 'running')) } }) },
        ready,
      ],
    },

    'vm.restart': {
      label: (op) => `Restart ${op.resource.name}`,
      verb: 'Restarting',
      steps: [
        {
          key: 'restart',
          label: 'Restart the machine',
          async run(ctx) {
            // A restart always restarts: `move` would skip a VM that is already running.
            const ref = await instanceOf(ctx);
            if (!ctx.state.moveOperation) await ctx.save({ moveOperation: (await ctx.provider.compute.restart(ref)).operation });
            return { state: { cloud: observe(await move(ctx, 'restart', 'running')) } };
          },
        },
        ready,
      ],
    },

    'vm.delete': {
      label: (op) => `Delete ${op.resource.name}`,
      verb: 'Deleting',
      steps: [
        {
          key: 'machine',
          label: 'Delete the machine',
          async run(ctx) {
            const ref = await instanceOf(ctx);
            if (ctx.state.removeOperation) await ctx.wait(ctx.state.removeOperation);
            else if (ref && await ctx.provider.compute.get(ref)) {
              const { operation } = await ctx.provider.compute.remove(ref);
              await ctx.save({ removeOperation: operation });
              await ctx.wait(operation);
            } else return { skipped: true, reason: 'already gone from the cloud' };
            return { state: { removeOperation: null } };
          },
        },
        {
          key: 'address',
          label: 'Release the address',
          async run(ctx) {
            const vm = await recordOf(ctx);
            const ref = vm?.ref?.address ?? (await ctx.provider.inventory({ labels: await labelsOf(ctx.op.resource.name) })).addresses?.[0]?.id;
            if (!ref) return { skipped: true, reason: 'it had none' };
            await ctx.provider.compute.releaseAddress(ref);
            return {};
          },
        },
      ],
    },
  };
}
