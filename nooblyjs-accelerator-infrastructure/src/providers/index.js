// The provider registry (architecture.md §6): one provider instance per cloud account, built with that account's
// credentials (from secrets) and kept until the account or its credentials change. An adapter's module, and with it
// its cloud SDKs, is only loaded when an account needs it, so a mock-only install needs no SDK at all.
import { CloudError } from './errors.js';
import { checkProvider } from './contract.js';
import { MockCloud } from './mock/cloud.js';

export const PROVIDER_LABEL = { mock: 'mock cloud', gcp: 'Google Cloud', aws: 'AWS' };

/**
 * @param {object} o
 * @param {string[]} o.enabled     INFRA_PROVIDERS
 * @param {object} o.store         the accelerator's FsStore (the mock cloud lives in it)
 * @param {object} o.secrets
 * @param {object} o.catalog
 * @param {number} [o.mockStepMs]  how long one unit of mock cloud work takes
 * @param {() => number} [o.now]
 */
export function createProviders({ enabled, store, secrets, catalog, mockStepMs = 1200, now = () => Date.now() }) {
  const instances = new Map();
  const mockClouds = new Map();

  function mockCloud(account) {
    if (!mockClouds.has(account.id)) {
      mockClouds.set(account.id, new MockCloud({ store, accountId: account.id, cloud: account.cloud, stepMs: mockStepMs, now }));
    }
    return mockClouds.get(account.id);
  }

  async function build(account, credentials) {
    if (account.provider === 'mock') {
      const { createMockProvider } = await import('./mock/index.js');
      return createMockProvider({ account, credentials, cloud: mockCloud(account), catalog: catalog.forCloud(account.cloud) });
    }
    throw new CloudError('unavailable', `The ${PROVIDER_LABEL[account.provider] ?? account.provider} provider arrives in roadmap phase 2. Until then accounts run on the mock cloud.`);
  }

  return {
    enabled,
    /** Which provider a new account on `cloud` uses: the cloud's own when enabled, else the mock. */
    defaultFor(cloud) {
      if (enabled.includes(cloud)) return cloud;
      if (enabled.includes('mock')) return 'mock';
      return null;
    },
    /** The provider for an account (cached). Throws a CloudError when this install can't serve it. */
    async forAccount(account) {
      if (!enabled.includes(account.provider)) {
        throw new CloudError('unavailable', `This install doesn't use the ${PROVIDER_LABEL[account.provider] ?? account.provider} provider (INFRA_PROVIDERS).`);
      }
      const key = `${account.id}|${account.provider}|${account.credentialRef ?? ''}`;
      if (!instances.has(key)) {
        const credentials = account.credentialRef ? await secrets.get(account.credentialRef) : null;
        instances.set(key, checkProvider(await build(account, credentials)));
      }
      return instances.get(key);
    },
    /** Drops an account's provider (its credentials changed, or it was removed). */
    forget(accountId) {
      for (const key of instances.keys()) if (key.startsWith(`${accountId}|`)) instances.delete(key);
      mockClouds.delete(accountId);
    },
    /** Drops every provider and mock cloud held in memory (after the seed rewrote the folder). */
    reset() {
      instances.clear();
      mockClouds.clear();
    },
    /** The mock cloud of an account, for tests and demos (failAt, outOfBand). */
    mockCloud: (account) => mockCloud(account),
  };
}
