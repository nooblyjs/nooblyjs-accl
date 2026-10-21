// The install's own settings (architecture.md §5): config.yaml, written on the first start. Its `installId` labels
// every cloud resource this install creates (noobly-install=<id>), so it only ever sees and touches its own.
import crypto from 'node:crypto';

const FILE = ['config.yaml'];

export function createConfig({ store }) {
  let cached = null;
  async function get() {
    if (cached) return cached;
    cached = await store.withLock(FILE, async () => {
      const config = (await store.readYaml(FILE)) ?? {};
      if (config.installId) return config;
      const next = { ...config, installId: `nc-${crypto.randomBytes(4).toString('hex')}`, createdAt: new Date().toISOString() };
      await store.writeYaml(FILE, next);
      return next;
    });
    return cached;
  }
  const installId = async () => (await get()).installId;
  return {
    get,
    installId,
    /** The labels every resource this install creates carries, plus `extra` ({ 'noobly-name': 'web-01' }). */
    labels: async (extra = {}) => ({ 'managed-by': 'noobly-cloud', 'noobly-install': await installId(), ...extra }),
    /** Merges `patch` into config.yaml. */
    set: (patch) => store.withLock(FILE, async () => {
      cached = { ...((await store.readYaml(FILE)) ?? {}), ...patch };
      await store.writeYaml(FILE, cached);
      return cached;
    }),
    /** Forgets what was read (after the seed rewrote config.yaml). */
    forget() {
      cached = null;
    },
  };
}
