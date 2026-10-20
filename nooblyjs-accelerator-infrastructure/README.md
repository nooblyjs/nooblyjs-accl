# Noobly Cloud — nooblyjs-accelerator-infrastructure

A NooblyJS accelerator to run your own infrastructure on **Google Cloud** and **AWS** without their consoles: launch
Linux VMs, deploy apps from Git onto them, create databases (managed MySQL, or MongoDB on a VM) and storage buckets,
put them on public addresses, and see what everything costs.

Status: **roadmap phase 0** — the accelerator loads, and every screen is routed with a placeholder. See
`.claude/steering/roadmap.md` for what comes next.

## Run it on its own

```bash
npm install
npm start            # http://localhost:11008/infrastructure — pick a person at /login
```

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
| `INFRA_PROVIDERS` | `mock` | The clouds this install may use: `mock`, `gcp`, `aws` (comma-separated). |

## Tests

`npm test` runs every test offline, on Express 5 and then on Express 4.
