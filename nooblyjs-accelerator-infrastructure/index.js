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

/**
 * @param {import('express').Express} app   the launcher's app (Express 4 or 5)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the launcher
 * @param {{ mountPath?: string, dataDir: string, host: object }} options
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/infrastructure', dataDir, host } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted (architecture.md §3.1).
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-accelerator-infrastructure needs the launcher's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-accelerator-infrastructure needs an initialised serverManager (the launcher initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /infrastructure, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-accelerator-infrastructure needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-accelerator-infrastructure needs host.${missing.join(', host.')} from the launcher.`);
  const providers = enabledProviders();
  // Every event from here on carries `system: 'infrastructure'` and the sentence Activity shows (event-words.js).
  host = { ...host, events: withWords(host.events) };

  // The launcher's logging provider, as an instance named after this accelerator (never one of our own).
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  // Business time comes from the launcher's clock, which a dev clock can move.
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).getTime();
  const seed = (options) => seedStory(host.store, { ...options, now });
  const summary = createSummary({ host, mountPath });

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, seed, summary, about: { name: NAME, version: VERSION, mountPath, providers } }));
  // The browser files (module, pages, CSS). redirect: false, or /infrastructure would 301 to /infrastructure/.
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the launcher's frame answers it, so deep links and refresh
  // land on the right screen. A missing .js or .css is still a 404. Middleware rather than a wildcard route, because
  // Express 4 and 5 disagree on wildcard syntax (architecture.md §3.4).
  router.use((req, res, next) => (req.method === 'GET' && !path.extname(req.path) && !req.path.startsWith('/api/') ? host.frame(req, res, next) : next()));
  app.use(mountPath, router);

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
    /** Stops background work (none yet: operations and jobs arrive in roadmap phase 1). */
    close: async () => {},
    /** For the tests: resolves when no operation is queued or running. */
    idle: async () => {},
  };
}
