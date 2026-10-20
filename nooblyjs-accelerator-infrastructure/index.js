// Noobly Cloud as an accelerator (architecture.md §3). A launcher (the accelerators ../app.js, the NooblyJS AI host,
// or server.js when this repo runs on its own) imports this file and calls register() with its Express app, its
// nooblyjs-core serverManager and what it shares (`host`); the tests do the same with test/fixtures/host.js.
// Nothing here listens on a port.
//
// The accelerator owns its screens: the UI is a module (public/js/module.js) that the launcher's frame loads into its
// content area, and the launcher draws the rail and the sidebar from the description register() returns.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes/index.js';
import { createRepos } from './src/repos/index.js';
import { createCatalog } from './src/catalog/index.js';
import { createProviders } from './src/providers/index.js';
import { createConfig } from './src/services/config.js';
import { createSecrets } from './src/services/secrets.js';
import { createActivity } from './src/services/activity.js';
import { createOperations } from './src/services/operations.js';
import { createAccounts } from './src/services/accounts.js';
import { createSync } from './src/services/sync.js';
import { createJobs } from './src/services/jobs.js';
import { createCost } from './src/services/cost.js';
import { createSummary } from './src/services/summary.js';
import { withWords } from './src/services/event-words.js';
import { seed as seedStory } from './src/seed/index.js';

const NAME = 'infrastructure';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'can', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PROVIDERS = ['mock', 'gcp', 'aws'];

/** Sidebar rows (product.md §5): `path` is relative to the mount path, `icon` names a UI kit icon. */
export const NAV = [
  { key: 'overview', label: 'Overview', path: '/', icon: 'grid' },
  { key: 'vms', label: 'Virtual machines', path: '/vms', icon: 'screen' },
  { key: 'apps', label: 'Apps', path: '/apps', icon: 'box' },
  { key: 'databases', label: 'Databases', path: '/databases', icon: 'layers' },
  { key: 'buckets', label: 'Buckets', path: '/buckets', icon: 'inbox' },
];

/** The cloud providers this install may use (INFRA_PROVIDERS, comma-separated; architecture.md §15). */
export function enabledProviders(value = process.env.INFRA_PROVIDERS) {
  const names = String(value || 'mock').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !PROVIDERS.includes(n));
  if (unknown.length) throw new Error(`INFRA_PROVIDERS may list ${PROVIDERS.join(', ')}; not ${unknown.join(', ')}.`);
  return [...new Set(names)];
}

const envNumber = (name, fallback) => (process.env[name] === undefined || process.env[name] === '' ? fallback : Number(process.env[name]));

/**
 * @param {import('express').Express} app   the launcher's app (Express 4 or 5)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the launcher
 * @param {object} options
 * @param {string} [options.mountPath]
 * @param {string} options.dataDir
 * @param {object} options.host
 * @param {number} [options.mockStepMs]   how long one unit of mock cloud work takes (INFRA_MOCK_STEP_MS; tests pass 0)
 * @param {number} [options.jobCheckMs]   how often to check which jobs are due (INFRA_SYNC_CHECK_MS; 0: no timer)
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, {
  mountPath = '/infrastructure', dataDir, host,
  mockStepMs = envNumber('INFRA_MOCK_STEP_MS', 1200),
  jobCheckMs = envNumber('INFRA_SYNC_CHECK_MS', 60_000),
} = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted (architecture.md §3.1).
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-accelerator-infrastructure needs the launcher's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-accelerator-infrastructure needs an initialised serverManager (the launcher initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /infrastructure, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-accelerator-infrastructure needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-accelerator-infrastructure needs host.${missing.join(', host.')} from the launcher.`);
  const enabled = enabledProviders();

  // The launcher's logging and queueing providers, as instances named after this accelerator (never ones of our own).
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const queue = serverManager.queue(serverManager.getDefaultProviderType('queueing'), { instanceName: NAME });
  // Business time comes from the launcher's clock, which a dev clock can move.
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).getTime();

  const repos = createRepos(host.store, { log });
  const config = createConfig({ store: host.store });
  const secrets = await createSecrets({ store: host.store, log, audit: host.audit });
  const catalog = await createCatalog();
  const activity = createActivity({ repos, host, now });
  // Every event from here on carries `system: 'infrastructure'` and its sentence, and is kept in the activity log.
  host = { ...host, events: withWords(host.events, { record: activity.record, log }) };
  const providers = createProviders({ enabled, store: host.store, secrets, catalog, mockStepMs, now });
  const operations = createOperations({ repos, host, log, queue, providers, secrets, now, perAccount: envNumber('INFRA_OPS_PER_ACCOUNT', 4) });
  const accounts = createAccounts({ repos, host, operations, providers, secrets, catalog, config, now, log });
  const sync = createSync({ repos, operations, providers, config, host, log, now });
  const cost = createCost({ repos, catalog, now });
  const summary = createSummary({ repos, accounts, activity, cost });
  const jobs = createJobs({
    now,
    log,
    checkEveryMs: jobCheckMs,
    jobs: [
      { name: 'account-check', every: 15 * 60_000, run: () => accounts.checkAll() },
      { name: 'inventory', every: () => sync.every(), run: () => sync.inventory() },
    ],
  });

  /** Writes the seed story; mock accounts get mock credentials, and nothing read before the rewrite is kept. */
  const seed = async (options) => {
    const result = await seedStory(host.store, { ...options, now });
    if (result.seeded) {
      config.forget();
      providers.reset();
      await accounts.seedCredentials();
      await operations.recover();
    }
    return result;
  };

  const router = host.express.Router();
  router.use('/api/v1', createApi({
    host, log, seed, summary, accounts, operations, activity, catalog, cost,
    about: { name: NAME, version: VERSION, mountPath, providers: enabled },
  }));
  // The browser files (module, pages, CSS). redirect: false, or /infrastructure would 301 to /infrastructure/.
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the launcher's frame answers it, so deep links and refresh
  // land on the right screen. A missing .js or .css is still a 404. Middleware rather than a wildcard route, because
  // Express 4 and 5 disagree on wildcard syntax (architecture.md §3.4).
  router.use((req, res, next) => (req.method === 'GET' && !path.extname(req.path) && !req.path.startsWith('/api/') ? host.frame(req, res, next) : next()));
  app.use(mountPath, router);

  // Operations that were queued or under way when the server last stopped carry on; the jobs start ticking.
  await operations.recover();
  jobs.start();

  return {
    name: NAME,
    label: 'Cloud',
    title: 'Noobly Cloud',
    icon: 'globe',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/infrastructure.css'] },
    nav: NAV,
    /** The sidebar's status card: the cloud accounts and their state (product.md §5). */
    status: () => summary.status(),
    /** What other accelerators may call. */
    services: summary.services,
    /** Writes the seed story into dataDir; `reset` removes what is there first. */
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seed({ reset, content });
    },
    /** Stops the jobs; running operations stop at their next safe point and carry on at the next start. */
    close: async () => {
      await jobs.close();
      await operations.close();
    },
    /** For the tests: resolves when no operation is queued or running. */
    idle: () => operations.idle(),
    /** For the tests and a person in a hurry: run a job now ('account-check', 'inventory'). */
    runJob: (name) => jobs.run(name),
    /** For the tests and demos: the mock cloud of an account (failAt, outOfBand, resources). */
    mockCloud: async (accountId) => {
      const account = await repos.accounts.get(accountId);
      return account ? providers.mockCloud(account) : null;
    },
  };
}
