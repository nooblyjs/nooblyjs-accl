// Standalone mode (architecture.md §3.3): runs this accelerator on its own, for development. It does what a launcher
// does (an Express app, the nooblyjs-core serverManager, the shell and the /ui kit, a host with a dev sign-in, from
// src/host/standalone.js) and then calls the same register() a launcher calls. Launchers load index.js instead.
//
//   npm start                      the screens at http://localhost:11008/infrastructure, the API at /infrastructure/api/v1
//   npm run seed [-- --reset]      writes the seed story into data/infrastructure/ and exits
//
// Sign in at /login, or send the X-Dev-Person header (e.g. curl -H "X-Dev-Person: stevie" …).
// Development only: it refuses to start when NODE_ENV=production.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { register } from './index.js';
import { createDevLauncher } from './src/host/standalone.js';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MOUNT_PATH = '/infrastructure';
const DEFAULT_PORT = 11008;

if (process.env.NODE_ENV === 'production') {
  console.error('server.js is for development only (dev sign-in). In production, a launcher loads this accelerator.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dataRoot = path.resolve(ROOT, process.env.DATA_DIR ?? 'data');
const dataDir = path.join(dataRoot, MOUNT_PATH.slice(1));
await fs.mkdir(dataDir, { recursive: true });
const firstStart = (await fs.readdir(dataDir)).length === 0;

// nooblyjs-core: the launcher owns the serverManager and initialises it once.
const serverManager = require('nooblyjs-core');

const app = express();
app.disable('x-powered-by');
serverManager.initialize(app, undefined, {
  security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } },
});
const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: 'standalone' });

// The launcher's order: CSRF and sign-in → shell and UI kit → accelerators → 404.
const launcher = createDevLauncher({ express, rootDir: dataRoot, log });
launcher.mount(app);

let hosted;
try {
  hosted = await register(app, serverManager, { mountPath: MOUNT_PATH, dataDir, host: launcher.hostFor(dataDir) });
  launcher.add(hosted, MOUNT_PATH);
  log.info(`mounted ${hosted.name} at ${MOUNT_PATH}`);
} catch (err) {
  log.error(`could not mount nooblyjs-accelerator-infrastructure at ${MOUNT_PATH}: ${err.message}`);
  process.exit(1);
}

if (args.has('--seed')) {
  await hosted.seed({ reset: args.has('--reset') });
  log.info(`seeded ${path.relative(ROOT, dataDir)}${args.has('--reset') ? ' (reset)' : ''}`);
  await hosted.close();
  await serverManager.shutdown?.();
  process.exit(0);
}
if (firstStart) await hosted.seed({ reset: false });

// The home page is Noobly Cloud; its pages are this accelerator's module in the frame.
app.get('/', (req, res) => res.redirect(302, MOUNT_PATH));
app.use((req, res) => {
  if (req.originalUrl.includes('/api/')) return res.status(404).json({ error: { code: 'not_found', message: 'No such API route.' } });
  res.status(404).type('text').send('Not found.');
});

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = app.listen(port, () => {
  log.info(`Noobly Cloud standalone on http://localhost:${port}${MOUNT_PATH} (API at ${MOUNT_PATH}/api/v1, data in ${path.relative(ROOT, dataDir)})`);
});

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`${signal}: stopping`);
  server.close();
  await hosted.close();
  await serverManager.shutdown?.();
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
