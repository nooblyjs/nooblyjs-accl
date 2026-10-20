# Noobly Cloud — nooblyjs-accelerator-infrastructure

A NooblyJS accelerator to run your own infrastructure on **Google Cloud** and **AWS** without their consoles: launch
Linux VMs, deploy apps from Git onto them, create databases (managed MySQL, or MongoDB on a VM) and storage buckets,
put them on public addresses, and see what everything costs.

Status: **roadmap phase 1** — everything runs on a **mock cloud** (nothing is created in GCP or AWS yet). Built: the
Overview, cloud accounts (connect, check, remove), the activity log, the operations engine that runs long work and
picks it up again after a restart, encrypted secrets, and the price catalogue. The VM, app, database and bucket screens
are routed placeholders until their phases. See `.claude/steering/roadmap.md` for what comes next.

## Run it on its own

```bash
npm install
npm start            # http://localhost:11008/infrastructure — pick a person at /login
npm run seed -- --reset   # start again from the seed story (the design mockups' data)
```

The first start writes the seed story: Stevie's GCP and AWS accounts on the mock cloud, with the VMs, apps, databases
and buckets from the design mockups.

Development only: the sign-in lets anyone be anyone, so `npm start` refuses to run with `NODE_ENV=production`.

## Load it from a launcher

The accelerator is an ES module. A launcher (such as `../app.js`, which is CommonJS on Express 4) loads it and calls
`register()`:

```js
const { register } = await import('nooblyjs-accelerator-infrastructure');
const hosted = await register(app, serviceRegistry, { mountPath: '/infrastructure', dataDir, host });
```

`host` is what the launcher shares: sign-in, permissions, audit, events, a file store, the frame page. Until a
launcher has its own, `nooblyjs-accelerator-infrastructure/host` provides a development one (`createDevLauncher()`).
The full contract is in `.claude/steering/architecture.md` §3.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `11008` | Standalone only. |
| `DATA_DIR` | `./data` | Standalone only; this accelerator's files go in `<DATA_DIR>/infrastructure`. |
| `INFRA_PROVIDERS` | `mock` | The clouds this install may use: `mock`, `gcp`, `aws` (comma-separated). Only `mock` works until roadmap phase 2. |
| `INFRA_SECRET_KEY` | the launcher's `SETTINGS_SECRET`, then `SESSION_SECRET` | Encrypts cloud credentials and passwords. Required in production; in development one is made in `secrets/dev-key.txt`. |
| `INFRA_MOCK_STEP_MS` | `1200` | How long one unit of mock cloud work takes (a network: 2 units; a VM: 3). |
| `INFRA_SYNC_CHECK_MS` | `60000` | How often to check which background jobs (account check, inventory sync) are due. |
| `INFRA_OPS_PER_ACCOUNT` | `4` | How many operations may run at once in one cloud account. |

## Tests

`npm test` runs every test offline, on Express 5 and then on Express 4. Pages are rendered in Node with `linkedom`
against a seeded accelerator's real API.
