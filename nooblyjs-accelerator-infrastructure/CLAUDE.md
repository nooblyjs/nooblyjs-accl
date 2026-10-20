# CLAUDE.md

Guidance for Claude Code in this repository.

`nooblyjs-accelerator-infrastructure` is **Noobly Cloud**: a NooblyJS accelerator to launch and manage Linux VMs,
apps deployed from Git, databases (managed MySQL; MongoDB on a VM) and buckets on GCP and AWS. Its screens and its
API (`/infrastructure/api/v1`) are mounted by a launcher at `/infrastructure`.

## Read first

- `.claude/steering/product.md`: what it does, for whom, every screen, who may do what.
- `.claude/steering/architecture.md`: how it is built (the launcher contract, providers, operations, records, UI).
- `.claude/steering/roadmap.md`: the build order. **Tick its checkboxes in the same change as the work.**
- `.claude/steering/ui/`: the mockups the screens are built from (reference only; never copy their React runtime).

## Rules

- **Loaded by a launcher.** `index.js` exports `register(app, serverManager, { mountPath, dataDir, host })`. It checks
  everything before mounting anything, never listens on a port, never initialises the serverManager, and uses only
  what `host` provides (architecture.md §3). `../app.js` is the launcher; `server.js` runs this repo on its own.
- **Express 4 and 5.** Launchers may run either. No wildcard routes (`'/{*rest}'` is Express 5 only, `'*'` Express 4
  only); wrap every async route in `handler()` from `src/util/http.js` (Express 4 ignores rejected promises).
  `npm test` runs every test on both.
- **No React, no build step.** Pages are native ES modules in `public/js/pages/` that export
  `render(view, { params, query, ctx, route })` and build HTML with the kit's `html```; they import the kit by
  absolute URL (`/ui/js/...`) and their own files relatively. No inline styles, no CDN scripts.
- **Styles** go in `public/css/infrastructure.css`, every selector under `[data-module="infrastructure"]`, kit tokens
  only (plus the `--inf-*` app tokens).
- **Mock first.** Every feature works offline on the mock cloud provider (tests, seed story, screens) before the GCP
  and AWS adapters; services never call a cloud SDK directly (architecture.md §6).
- **Writes** stay inside `dataDir` (the store refuses anything else); every write is audited; refusals are recorded.

## Commands

```bash
npm start              # standalone on :11008 (dev sign-in at /login); DATA_DIR sets the data folder
npm test               # every test on Express 5, then on Express 4 (offline)
npm run test:express5  # one Express major only
npm run test:express4
npm run seed           # writes the seed story into data/infrastructure/ (-- --reset to start again)
```

This repo lives in the `nooblyjs-accl` monorepo; `nooblyjs-core` is a separate repo next to it
(`file:../../nooblyjs-core`), which provides the serverManager, the FsStore, the shell and the `/ui` kit.
