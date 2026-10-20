// account.connect (architecture.md §7): checks a new account's credentials, finds or makes the network Noobly Cloud
// uses in its default region, and reads what the region offers. Each step is safe to run again: the network is found
// by its labels before anything is made, and its id is kept before waiting on the cloud.
import { CloudError } from '../../providers/errors.js';

/**
 * @param {object} o
 * @param {(extra?: object) => Promise<object>} o.labels   the install's labels
 */
export function accountConnect({ labels }) {
  return {
    label: (op) => `Connect ${op.resource.name}`,
    verb: 'Connecting',
    steps: [
      {
        key: 'verify',
        label: 'Check the credentials',
        async run(ctx) {
          const result = await ctx.provider.account.verify();
          if (!result.ok) throw new CloudError('permission', result.message);
          await ctx.log(`Signed in as ${result.identity}`);
          return { state: { identity: result.identity } };
        },
      },
      {
        key: 'network',
        label: 'Prepare the network',
        async run(ctx) {
          const region = ctx.account.defaultRegion;
          const netLabels = await labels({ 'noobly-name': 'noobly-cloud' });
          if (ctx.state.networkOperation) {
            // Made before a restart: wait for it rather than making another.
            await ctx.wait(ctx.state.networkOperation);
            return { state: { networkOperation: null } };
          }
          const { ref, operation, created } = await ctx.provider.account.ensureNetwork(region, { labels: netLabels });
          await ctx.save({ networkRef: ref, networkOperation: operation ?? null });
          await ctx.log(created ? `Creating network noobly-cloud in ${region}` : `Using network noobly-cloud in ${region}`);
          if (operation) await ctx.wait(operation);
          return { state: { networkRef: ref, networkOperation: null } };
        },
      },
      {
        key: 'catalog',
        label: 'Read regions and machine types',
        async run(ctx) {
          const zones = await ctx.provider.account.zones(ctx.account.defaultRegion);
          const machineTypes = await ctx.provider.catalog.machineTypes(zones[0]);
          await ctx.log(`${zones.length} zones and ${machineTypes.length} machine types in ${ctx.account.defaultRegion}`);
          return { state: { zones: zones.length, machineTypes: machineTypes.length } };
        },
      },
    ],
  };
}
