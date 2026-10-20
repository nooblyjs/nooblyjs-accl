# Architecture: Noobly Cloud (Infrastructure accelerator)

How the accelerator is built. What it does and for whom is `product.md`; the build order is `roadmap.md`. Section
numbers here are referred to from both.

## 1. Shape in one picture

```
 Browser (NooblyJS frame, native ES modules, no React, no build)
   public/js/module.js ─ routes ─► public/js/pages/*.js ─ ctx.api ─┐      ctx.sse ◄── live events
                                                                   │
 ──────────────────────────────── HTTP ────────────────────────────┼───────────────────────────────
                                                                   ▼
 Express (the host's app)   <mountPath>/api/v1/*  (src/routes)    <mountPath>/hooks/*  (no session; signed)
                                   │
                         services (src/services)  ── emit events ──► host.events ──► SSE ──► pages
                         ├─ vms · endpoints · apps · databases · buckets · accounts
                         ├─ operations engine (queue, steps, resume)       ◄── scheduled jobs (sync, DNS, certs)
                         ├─ estimate (shared with the browser)            secrets (encrypted)
                         │
             ┌───────────┴────────────┬──────────────────────┐
             ▼                        ▼                      ▼
     records (host.store,      provider adapters        remote runner (SSH)
     FsStore, Markdown+YAML)   mock · gcp · aws         ──► VM: Docker + Caddy (HTTPS)
     data/infrastructure/      └─► cloud SDKs ──► GCP / AWS
```

Three rules hold everywhere:

1. **Services never call a cloud SDK directly.** They call a provider adapter (§6). `mock` is always available; tests
   and the seed story run on it.
2. **Anything that takes longer than a request is an operation** (§7): queued, stepped, resumable, and visible live.
3. **Pages never call a cloud.** They read records through the API; records are kept current by operations and sync
   jobs (§8).

## 2. Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js ≥ 22.12, ESM (`"type": "module"`) | `node --env-file-if-exists=.env`. |
| HTTP | Express, the **host's** instance (`host.express`) | Must run on Express 4 *and* 5 (§3.4). |
| Browser | Native ES modules, tagged-template HTML (`/ui/js/html.js`), NooblyJS UI kit | No React, no bundler, no transpiler, no CDN scripts (the frame's CSP allows `'self'` only). |
| Styling | The kit's `tokens.css` + `components.css`, plus `public/css/infrastructure.css` scoped to `[data-module="infrastructure"]` | The mockup palette *is* the kit's palette (§11.4). |
| Records | `host.store` (nooblyjs-core `FsStore`: Markdown with YAML front matter, YAML, atomic writes, per-path locks) | Under `<dataDir>/infrastructure/`. |
| Queue, logging, caching, scheduling | nooblyjs-core services via `serverManager`, instances named `infrastructure` | Never our own copies. |
| Secrets | nooblyjs-core settings service, `encrypted` provider (AES-256-GCM) behind `src/services/secrets.js` | Swappable for GCP Secret Manager / AWS Secrets Manager (§10). |
| GCP | `@google-cloud/compute`, `@google-cloud/storage`, `@google-cloud/monitoring`, `googleapis` (Cloud SQL Admin) | Loaded lazily (`await import`) so mock-only installs and tests need none of them. |
| AWS | AWS SDK v3: `client-ec2`, `client-rds`, `client-s3`, `s3-request-presigner`, `client-iam`, `client-cloudwatch`, `client-sts`, `client-ssm` | Same, lazily. |
| Git | GitHub and GitLab REST APIs over `fetch`, authenticated with a personal access token | No SDK. |
| MongoDB | MongoDB Community packages installed **on the database VM**; administered with `mongosh` over SSH | The server needs no MongoDB driver. |
| Remote execution | `ssh2` (SSH + SFTP) | §9. |
| Tests | `node:test`, offline on the mock provider | §14. |

## 3. How it is loaded (kept from the seeded code)

The seeded `index.js` is the loading contract and stays. The domain behind it (designs, environments, provisioning
runs, drift, blueprints, policies) is replaced (roadmap phase 0).

A **launcher** loads accelerator modules: it owns the Express app, the nooblyjs-core `serverManager`, sign-in, the
frame (rail, sidebar, chat) and the data folder, and calls each accelerator's `register()`. The accelerators
monorepo's `../app.js` is the launcher being built; the NooblyJS AI host (`../../nooblyjs-ai/nooblyjs-ai-host`) is
an example of one, and the seeded code was written against it. This accelerator depends only on the contract in
§3.1–3.2, never on a particular launcher.

### 3.1 `register(app, serverManager, options)`

```js
import { register } from 'nooblyjs-accelerator-infrastructure';
const hosted = await register(app, serverManager, { mountPath: '/infrastructure', dataDir, host });
```

- **Checks everything before mounting anything**: an Express app, an *initialised* serverManager, a valid mount path,
  a `dataDir`, and every `host` capability in `NEEDS`. A failed start mounts nothing.
- **Never listens on a port.** The host (or `server.js`) does.
- Builds, in order: logger and queue instances from `serverManager` → provider registry (§6) → repos over `host.store`
  (§5) → services → operations engine → API router + static files + page fallback, all on one router mounted at
  `mountPath` → `operations.recover()` → scheduled jobs.
- Returns the **HostedApp description** the host uses to draw the rail and sidebar:

```js
{
  name: 'infrastructure', label: 'Cloud', title: 'Noobly Cloud', icon: 'cube', mountPath,
  ui: { entry: 'js/module.js', styles: ['css/infrastructure.css'] },
  nav: NAV,                        // Overview, Virtual machines, Apps, Databases, Buckets (product.md §5)
  status: async () => ({ ... }),   // the sidebar card: cloud accounts and their state
  services: { summary, listResources, ... },   // what other hosted apps may call
  seed: async ({ reset }) => {},   // writes the seed story (product.md §9)
  close: async () => {},           // stops jobs, lets the running step finish, closes SSH pools
  idle: () => Promise,             // tests: resolves when no operation is queued or running
}
```

### 3.2 The `host` contract

What the host hands to `register()` (exactly the seeded `NEEDS`, plus optional `clock` and `sampleData`):

| Capability | Used for |
| --- | --- |
| `express` | `Router()`, `static()`, `json()`. |
| `auth` | Middleware: sets `req.person` (`{ id, name, accessRole, kind? }`) or answers 401. |
| `requireRole(permission)` / `can(accessRole, permission)` | Permission checks (product.md §7). |
| `audit` | Middleware for writes, and `audit.record({...})` for refusals and reveals. |
| `events` | `emit(type, payload)`; the host relays them to the browser's event stream. Wrapped by `withWords()` so each carries `system: 'infrastructure'` and the sentence Activity shows. |
| `store` | FsStore rooted at `<dataDir>/infrastructure`. |
| `people` | Names for "by Stevie". |
| `service(name)` | Other hosted apps' services (optional partners). |
| `frame` | Handler that answers any page URL with the host's frame HTML. |
| `clock` (optional) | Business time (`now()`), so tests and the dev clock can move time. |

### 3.3 Three ways to run

| Mode | Who builds `host` | Entry |
| --- | --- | --- |
| **Loaded by a launcher** (the accelerators `../app.js`, or any other host such as the NooblyJS AI host) | The launcher, once, shared by every accelerator it loads | It imports the package (`await import()` from CommonJS) and calls `register(app, serverManager, { mountPath, dataDir, host })`. |
| **Standalone** (`npm start`, port 11008) | `createDevLauncher()` in `src/host/standalone.js` | `server.js`: Express app → `serviceRegistry.initialize()` → `createDevLauncher({ express, rootDir })` (the stand-in host from `createStandaloneHost()`, nooblyjs-core `createShell()` for the frame and `/ui`, a `/login` page) → `launcher.mount(app)` → `register()` → `launcher.add()` → `listen()`. |
| **Tests** | `test/fixtures/host.js` (`createStandaloneHost()` on Express 4 or 5) | `register()` on an ephemeral port; `test/launcher.test.js` also runs a CommonJS, Express 4 launcher shaped like `../app.js`. |

`src/host/standalone.js` is exported as `nooblyjs-accelerator-infrastructure/host`. `createStandaloneHost({ express })`
is the reference implementation of the host contract; `createDevLauncher({ express, rootDir })` adds the shell, the
`/ui` kit and a dev `/login`, and refuses to run with `NODE_ENV=production`. `../app.js` uses `createDevLauncher()`
until it builds a host of its own (sign-in, audit, events, the frame).

Note for the launcher: the sibling `nooblyjs-accelerator-customers` exposes a different entry point
(`mount(app, eventEmitter, serviceRegistry, options)`). The launcher needs one convention for all accelerators; this
one uses `register()` as seeded (roadmap 0.6).

### 3.4 Express 4 and 5

The monorepo host runs Express 4; the seeded package develops against Express 5. Routes use only syntax both accept:
no `'/{*rest}'` (Express 5 only) and no `'*'` (Express 4 only). The page fallback becomes a middleware:

```js
router.use((req, res, next) =>
  req.method === 'GET' && !path.extname(req.path) && !req.path.startsWith('/api/') ? host.frame(req, res, next) : next());
```

Where a wildcard is unavoidable, use nooblyjs-core's `route()` helper (`src/shared/utils/routePattern.js`). The test
suite runs once per Express major (roadmap 0.5).

## 4. Repository layout

```
index.js                       register(), NAV, the HostedApp description
server.js                      standalone server (§3.3)
src/
  host/standalone.js           createStandaloneHost() and createDevLauncher(), for server.js, the tests and ../app.js
  routes/                      index.js (API router), vms.js, apps.js, databases.js, buckets.js, accounts.js,
                               operations.js, hooks.js (git webhooks, mounted before auth)
  services/                    accounts.js, git.js (connections, repos, webhooks), vms.js, endpoints.js, apps.js,
                               databases.js, engines/ (mysql-managed.js, mongodb-vm.js), buckets.js, objects.js,
                               operations.js (engine), steps/ (one file per operation type), sync.js (jobs),
                               summary.js (Overview, sidebar status), activity.js, cost.js, secrets.js,
                               event-words.js
  providers/                   index.js (registry), contract.js (the interface + shape checks),
                               mock/, gcp/, aws/   each: account.js compute.js network.js databases.js
                               storage.js iam.js metrics.js
  remote/                      ssh.js (pooled runner), scripts/ (fixed shell scripts: first-boot, deploy, caddy,
                               mongodb-install, mongodb-backup, mongodb-restore, mongodb-users, disk-grow),
                               cloud-init.js (renders user-data)
  repos/index.js               records over host.store (§5)
  catalog/                     index.js; data/gcp.yaml, data/aws.yaml (regions, zones, sizes, images, prices, asOf)
  seed/                        index.js; data/ (the mockups' story)
  util/                        errors.js, http.js, ids.js (kept from the seed)
public/
  js/module.js                 the route table (§11.1)
  js/lib.js, js/live.js        page helpers, live redraw (kept, generalised)
  js/pages/                    overview, vms, vm, vm-launch, apps, app, app-deploy, databases, database-create,
                               buckets, bucket-create, accounts, activity
  js/components/               cloud-badge, engine-badge, option-cards, switch-row, form-section, summary,
                               kv, code-log, copy-field, tabs, drop-zone, actions-menu, confirm-dialog, env-rows
  js/shared/                   estimate.js, names.js, statuses.js (imported by the browser AND the server)
  css/infrastructure.css
test/                          see §14
```

## 5. Records

The **cloud is the source of truth for what exists**; records hold **what was asked for** (spec), **what was last
seen** (observed), and **the cloud's identifiers** (ref). Every record is a Markdown file whose front matter is the
record and whose body is free notes. Folders under `<dataDir>/infrastructure/`:

| Folder / file | One per | Key fields |
| --- | --- | --- |
| `accounts/<id>.md` | cloud account | `cloud` (gcp/aws), `name`, `projectId` / `accountId`, `defaultRegion`, `credentialRef` (secret id), `state` (connected/needs-attention), `checkedAt`, `network` (VPC/subnet ids per region) |
| `vms/<name>.md` | VM | `role` (`app` or `database`), `ownedBy` (the database, for `role: database`), `spec` (account, region, zone, size, machineType, image, diskGb, dataDiskGb?, docker, sshKeyId, sshFrom), `ref` (instance id, address id, data disk id, firewall/SG id), `observed` (status, publicIp, publicDns, privateIp, startedAt), `estimate`, `createdBy`, `createdAt` |
| `endpoints/<id>.md` | public endpoint | `vm`, `app?`, `address` (`cloud` = the VM's default address, or `domain`), `host` (the domain, or the cloud's DNS name / IP), `path`, `port`, `redirectHttp`, `cert` (`self-signed` / `letsencrypt` / `uploaded`; status, expiresAt), `dns` (status, checkedAt; domains only) |
| `apps/<name>.md` | app | `source` (repo, branch, dockerfile, context, `gitConnection` or none for public repos), `vm`, `run` (port, restart, env: `[{ key, value } \| { key, secretRef } \| { key, link: { database \| bucket } }]`), `endpoint?`, `healthCheck`, `autoDeploy` (webhookSecretRef), `current` (commit, image, container), `status` |
| `apps/<name>/deploys/<id>.md` | deploy | `commit`, `trigger` (push/person), `by`, `operation`, `result`; body = the log |
| `databases/<name>.md` | database | `engine` (`mysql` / `mongodb`), `hosting` (`managed` for MySQL, `vm` for MongoDB), `vm` (the owned VM's name, MongoDB), `spec` (version, account, region, tier, storageGb, autoGrow, ha, allowVms, backupAt, keepDays, adminUser), `ref` (managed instance id, or backups bucket + prefix), `observed` (status, host, port, storageUsedGb, lastBackup), `adminSecretRef`, `estimate` |
| `buckets/<name>.md` | bucket | `spec` (account, region, class, access, versioning, keepVersionsDays, deleteAfterDays, lifecycle[], domain?), `ref`, `observed` (bytes, objects, measuredAt), `links` (`[{ app, mode, credentialRef }]`) |
| `operations/<id>.md` | operation | §7 |
| `ssh-keys.yaml` | — | people's public keys: `{ id, name, type, publicKey, fingerprint, addedBy, addedAt }` |
| `activity/ledger.yaml` | — | append-only event lines (Recent activity, Activity page, month-to-date cost) |
| `git-connections/<id>.md` | Git connection | `host` (github/gitlab), `user`, `tokenRef` (secret), `scopes`, `expiresAt`, `checkedAt`, `state` |
| `config.yaml` | — | install id, defaults |

Names are the URL ids: VM, app and database names are unique across the install (`^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$`),
bucket names follow the clouds' global rules and are checked against the cloud (§6). Generated ids (operations,
endpoints, deploys) keep the seeded `ids.js` format. Reads tolerate a hand-broken file (skip with a warning), as the
seeded repos do.

## 6. Cloud provider layer

### 6.1 The contract

`src/providers/contract.js` defines one interface; `mock`, `gcp` and `aws` implement it. A provider instance is
created **per account** with that account's credentials (from secrets) and cached until the account changes.

```js
provider = {
  cloud: 'gcp' | 'aws' | 'mock',
  account:   { verify(), regions(), zones(region), detectNetwork(region), ensureNetwork(region) },
  catalog:   { machineTypes(zone), images() },                     // live lists; prices come from src/catalog
  compute:   { create(spec), get(ref), list({ labels }), start(ref), stop(ref), restart(ref), remove(ref),
               reserveAddress(region), releaseAddress(ref), setFirewall(ref, rules), defaultAddress(ref),
               attachDisk(ref, gb), resizeDisk(ref, diskRef, gb), setIdentity(ref, grant) },
  databases: {   // managed MySQL only (Cloud SQL / RDS); MongoDB is built on compute + the remote runner (§9)
               create(spec), get(ref), remove(ref), resize(ref, tier, storageGb), setAccess(ref, access),
               backups: { list(ref), create(ref), restore(ref, backupId, newSpec) },
               users:   { list(ref), create(ref, user, password), remove(ref, user), setPassword(ref, user, pw) } },
  storage:   { nameAvailable(name), create(spec), get(ref), update(ref, settings), remove(ref),
               list(ref, { prefix, delimiter: '/', cursor }), put(ref, key, stream, { contentType, size }),
               get(ref, key) /* stream */, remove(ref, key), signedUrl(ref, key, seconds), stats(ref) },
  iam:       { grantBucket(bucketRef, mode) /* → credentials */, grantVm(vmRef, bucketRef, prefix, mode), revoke(grant) },
  metrics:   { vm(ref, window), database(ref, window) },
  waitFor(cloudOp, { signal, onProgress }),                         // polls the cloud's long-running operation
}
```

Calls that start long cloud work return a **cloud operation handle** (`{ kind, id, zone? }`), which the operation
engine stores in the operation record before waiting on it, so a restart resumes waiting instead of creating twice.

### 6.2 What each call maps to

| Area | GCP | AWS |
| --- | --- | --- |
| Credentials | Service account JSON key, or Workload Identity Federation | IAM role assumed with `sts:AssumeRole` + ExternalId (recommended), or access keys |
| Network | VPC `noobly-cloud` (custom mode), one subnet per region, Private Service Access for Cloud SQL | VPC `noobly-cloud` per region (or the default VPC), public subnets for VMs, private subnets for RDS |
| VM | Compute Engine instance; static external address; firewall rules targeting a network tag per VM | EC2 instance (`t3.*`); Elastic IP; one security group per VM |
| Sizes Small/Medium/Large | `e2-small` / `e2-medium` / `e2-standard-4` | `t3.small` / `t3.medium` / `t3.xlarge` |
| Database tiers Starter/Standard/Performance | Nearest Cloud SQL tier (`db-g1-small`-class / `db-custom-2-4096` / `db-custom-4-16384`) | Nearest RDS class (`db.t4g.small` / `db.t4g.medium` / `db.m6g.xlarge`) |
| Images | `ubuntu-os-cloud/ubuntu-2404-lts-amd64`, `ubuntu-2204-lts`, `debian-cloud/debian-12`, `rocky-linux-cloud/rocky-linux-9` (image families) | Canonical/Debian/Rocky AMIs resolved per region via SSM public parameters |
| First boot | `user-data` metadata (cloud-init) | `UserData` (cloud-init) |
| SSH keys | `ssh-keys` instance metadata | cloud-init `ssh_authorized_keys` (no EC2 key pair needed) |
| MySQL | Cloud SQL Admin API (`sqladmin v1`): `storageAutoResize`, `availabilityType: REGIONAL` for HA, `backupConfiguration.startTime`, `transactionLogRetentionDays`/retained backups, `ipConfiguration` (private network / authorized networks), `requireSsl` | RDS: `MaxAllocatedStorage` for auto-grow; `MultiAZ` for HA; `PreferredBackupWindow`, `BackupRetentionPeriod`; security group rules; `rds.force_ssl` parameter group |
| MongoDB | A Compute Engine VM (`role: database`, Ubuntu 22.04 LTS) with a separate persistent data disk, MongoDB Community 7.0 from MongoDB's apt repository (§9) | An EC2 instance with a separate EBS data volume, same install |
| MongoDB backups | `mongodump` to the account's backups bucket using the VM's attached service account (write to its prefix only) | Same, with an instance profile scoped to the prefix |
| Default address (the mockup's "generated address") | The static external IP (GCP gives VMs no public hostname) | The public DNS name `ec2-<a-b-c-d>.<region>.compute.amazonaws.com`, which follows the Elastic IP |
| Buckets | Cloud Storage: classes STANDARD / NEARLINE / ARCHIVE; uniform bucket-level access; public = `allUsers:objectViewer` with public access prevention off; versioning + lifecycle (`numNewerVersions`/`daysSinceNoncurrentTime`, `age`, prefix conditions) | S3: STANDARD / STANDARD_IA / GLACIER_IR; Block Public Access on unless public, then a read-only bucket policy; versioning + lifecycle (`NoncurrentVersionExpiration`, `Expiration`, prefix filters) |
| Name check | `bucket.exists()` (+ 403 means taken) | `HeadBucket` (404 free, 403/301 taken) |
| Share link (7 days) | V4 signed URL, max 7 days | Presigned GET, max 7 days |
| App access to a bucket | Service account + HMAC key scoped by IAM condition to the bucket | IAM user (or role for same-cloud VMs) + access key with a bucket-scoped policy |
| Metrics | Cloud Monitoring (CPU); memory/disk from the VM (§9) | CloudWatch (CPU); memory/disk from the VM |
| Labels / tags | `managed-by=noobly-cloud`, `noobly-install=<id>`, `noobly-name=<name>` | same keys as tags |

Every resource is **tagged on creation** and every list/sync call **filters by `noobly-install`**, so the accelerator
never shows or touches what it did not create (product.md §10).

**Databases stay in their cloud.** `allowVms` may only name VMs in the database's account (and, on AWS, its region,
since the VPC is regional; a GCP VPC spans regions). The API refuses anything else with a 422, and so does linking an
app to a database in another account. Nothing in v1 opens a database to the internet or to another cloud.

### 6.3 Mock provider

Deterministic, in-process, no network. Holds its "cloud" in memory (and optionally under `<dataDir>/infrastructure/
.mock-cloud/` so a standalone server keeps it across restarts). Timings scale with `INFRA_MOCK_STEP_MS` (tests use 0).
Supports **failure injection** (`failAt: 'compute.create'`, `once: true`) and **out-of-band changes** (delete or stop
a resource "in the console") so recovery and drift paths are testable. The seed story writes both the records and
the mock cloud's matching state.

## 7. Operations engine

Generalised from the seeded `runs` service (queue, progress, `recover()`, `cancel`, `idle()`).

**Record** (`operations/<id>.md`): `type` (`vm.launch`, `vm.start`, `vm.stop`, `vm.delete`, `endpoint.add`,
`app.deploy`, `db.create`, `db.backup`, `db.restore`, `db.resize`, `db.delete`, `bucket.create`, `bucket.update`,
`bucket.delete`, …), `resource` (`{ type, name }`), `steps` (`[{ key, label, status, startedAt, endedAt, detail }]`),
`progress` (0–100), `status` (`queued` → `running` → `succeeded` \| `failed` \| `cancelled`), `cloudOps` (handles
saved per step), `requestedBy`, `error` (`{ code, message, step }`), `createdAt`. The body is the operation's log.

**Steps** live in `src/services/steps/<type>.js` as an ordered list of `{ key, label, run(ctx) }`. Each `run` is
**idempotent**: it first checks the record (`ref`, `cloudOps`) and the cloud for work already done, so re-running a
step after a crash never creates twice. Examples, matching the mockups' progress text:

| Type | Steps |
| --- | --- |
| `vm.launch` ("Starting · 1 of 3") | 1 Create the machine (network, static IP, firewall, instance; wait for RUNNING) · 2 Prepare it (wait for cloud-init: Docker, Caddy, control key) · 3 Endpoint (Caddy site; for the cloud's address a self-signed certificate at once, for a domain wait for its DNS record, then the Let's Encrypt certificate) — skipped without an endpoint |
| `app.deploy` ("Building · step 4 of 9") | 1 Connect · 2 Clone · 3 Read Dockerfile · 4 Build image · 5 Start new container · 6 Health check · 7 Switch traffic · 8 Stop previous container · 9 Clean up old images |
| `db.create` (MySQL) | 1 Network access · 2 Create the server · 3 Admin user and password · 4 Backups · 5 Allow VMs |
| `db.create` (MongoDB) | 1 Launch the database VM (the `vm.launch` steps 1–2, no Docker, no endpoint, data disk) · 2 Install MongoDB · 3 Admin user and password · 4 Backups (bucket, VM identity, timer) · 5 Allow VMs (firewall on 27017) |
| `db.backup` ("Backing up · 64%") | MySQL: 1 Start backup · 2 Wait (progress from the cloud). MongoDB: 1 Run the backup script on the VM · 2 Upload (progress from bytes written) |
| `bucket.create` | 1 Create · 2 Access · 3 Versioning and lifecycle · 4 Link apps |

**Running.** Operations go on the nooblyjs-core queue (instance `infrastructure`). In-process workers take them with a
concurrency limit per account (`INFRA_OPS_PER_ACCOUNT`, default 4) and **one operation at a time per resource** (a
stop waits for the launch to finish). Each step transition writes the record under its lock, appends to the log, and
emits `infrastructure.operation.progress`; completion emits the domain event (`vm.launched`, `app.deployed`,
`database.backed_up`, …) that Activity and the pages listen to.

**Recovery.** `register()` calls `operations.recover()`: every `running` operation is re-queued at its current step
(idempotency makes that safe); a `queued` one is re-queued. **Cancel** sets an `AbortSignal`; the current step stops
at its next safe point and the steps' `undo` (where defined, e.g. release the reserved IP) runs.

**Failure.** A failed step marks the operation `failed` with the step and a client-safe message; the resource shows
`Failed` with **Retry** (re-queues from the failed step) and **Delete**. Cloud errors are mapped to plain words in
the adapter (quota exceeded, name taken, permission missing on the account).

## 8. Keeping records current (scheduled jobs)

Driven by one timer that checks which job is due (the seeded `sweep` pattern; host clock aware; `unref()`ed; stopped
by `close()`):

| Job | Every | Does |
| --- | --- | --- |
| Account check | 15 min | `account.verify()`; sets Connected / Needs attention (sidebar card). |
| Inventory sync | 60 s while any resource is transitional, else 5 min | Lists tagged resources per account; updates `observed`; marks records whose resource is gone as `Missing in cloud`; never deletes a record by itself. |
| DNS check | 60 s for pending domain endpoints | Resolves the person's domain (public resolvers) and compares it to the VM's static IP (or, on AWS, its public DNS name); flips `Waiting for DNS record` → `Verified`, then Caddy gets the certificate. |
| MongoDB backup status | 15 min | Reads the last backup's result from each database VM; marks a missed or failed backup. |
| Certificate check | 12 h | Reads expiry from Caddy on each VM; flags anything renewing within 7 days that hasn't renewed. |
| Bucket stats | 60 min | Bytes and object counts (GCS: Monitoring `storage/total_bytes`; S3: CloudWatch `BucketSizeBytes`/`NumberOfObjects`), falls back to listing for small buckets. |
| Cost snapshot | 60 min | Adds the hour's estimated cost per resource to the month's tally (§12). |

VM and database **metrics** are not polled in the background: the detail page asks, and the answer is cached for 60 s
(nooblyjs-core caching, instance `infrastructure`).

## 9. Inside a VM: first boot, endpoints, deploys and MongoDB

**First boot** (cloud-init user-data rendered by `src/remote/cloud-init.js` from fixed templates): create user
`noobly`, install the person's SSH key and the install's **control key**, install Docker Engine (when chosen) and
**Caddy** (as a systemd service; site files in `/etc/caddy/sites/*.caddy`; ACME email `ACME_EMAIL`), open ports as
asked, write `/var/lib/noobly/ready` when done. Step 2 of `vm.launch` waits for that marker.

**Control channel.** The server reaches VMs over SSH (`ssh2`) as `noobly` with a per-install ed25519 **control key**
generated at first start (private half in secrets). The VM's SSH firewall rule always includes the server's egress
address (`INFRA_CONTROL_CIDR`, detected if unset) in addition to the person's choice. Connections are pooled per VM and
closed when idle. *Alternative (open decision O4): a small agent on the VM that polls the server over HTTPS, so no
inbound SSH is needed.*

**No shell interpolation of user input.** Remote work runs fixed scripts from `src/remote/scripts/` uploaded over
SFTP. Arguments are validated (repo URL `https://` or `git@host:path`, never starting with `-`; branch passes
`git check-ref-format`; names match §5; env keys `^[A-Z_][A-Z0-9_]*$`) and passed as positional arguments with
`shell-quote`-style escaping; environment values are written to `/srv/apps/<app>/.env` (mode 0600) over SFTP and given
to Docker with `--env-file`, never placed on a command line.

**Endpoints.** One Caddy site file per endpoint: `host { reverse_proxy 127.0.0.1:<port> }`.

- **The cloud's address** (no DNS to manage): on AWS the VM's public DNS name, on GCP its static IP. Caddy serves it
  on HTTP and on HTTPS with `tls internal` (its own local CA, so browsers warn). Public CAs won't help here: Let's
  Encrypt refuses `amazonaws.com` names, and GCP gives no name at all. The UI says so (product.md §6.3).
- **The person's domain**: they add an A record to the static IP (on AWS a CNAME to the public DNS name works too);
  the DNS job (§8) waits for it; Caddy then obtains and renews a Let's Encrypt certificate itself (HTTP-01, so port
  80 is open whenever an endpoint exists), with `redir` for HTTP→HTTPS, or uses `tls /path/cert /path/key` when one
  was uploaded.

Several apps on one VM share the cloud's address by **path** (`handle_path /blog/*`), or get a domain each. While a
VM is stopped its endpoints show "Paused while stopped"; on start the static IP (and so the AWS DNS name) is unchanged.

**Deploy (blue/green on one VM).** `git clone --depth 1 --branch <b>` (private repos: the Git connection's token,
written to a 0600 temp file read by a `GIT_ASKPASS` helper and removed after the clone; never on a command line, in
the remote URL or in `.git/config`) → `docker build -f <dockerfile> <context> -t <app>:<sha>` (output
streamed into the operation log) → `docker run -d --name <app>-<sha> --restart <policy> --env-file … -p
127.0.0.1:<ephemeral>:<containerPort>` → health check `GET http://127.0.0.1:<ephemeral><path>` until 200 (timeout 60 s)
→ rewrite the Caddy site's upstream and `caddy reload` → stop and remove the previous container → prune images older
than the last two. A failed health check leaves the old container serving and marks the deploy failed.

**Git connections (personal access tokens).** An Owner adds a GitHub or GitLab token on the Accounts page; it is
stored in secrets and checked on save (who it belongs to, scopes, expiry) and daily. GitHub needs, for a
fine-grained token, *Contents: read*, *Metadata: read* and *Webhooks: read and write* on the chosen repositories (for
a classic token: `repo` and `admin:repo_hook`); GitLab needs `read_repository` and `api` (for webhooks). The token is
used to list repositories, to read the Dockerfile through the API for `POST /git/check` (no clone on the server), to
clone private repos on the VM (above), and to create and remove webhooks. Public repositories need no connection. A
token close to expiry shows "Needs attention" on the Accounts page and on its apps.

**Auto-deploy.** `POST <mountPath>/hooks/git/:app` is mounted **before** `host.auth`: it verifies the payload
signature (GitHub `X-Hub-Signature-256` HMAC with the app's webhook secret; GitLab `X-Gitlab-Token`), checks the
branch, and enqueues `app.deploy` with `trigger: push`. Needs the server reachable at `INFRA_PUBLIC_URL`.

**Linked env vars.** `{ key, link: { database } }` resolves at deploy time to the database's connection string (from
secrets; the database must be in the app's VM's account, and linking adds that VM to `allowVms`); `{ key, link: { bucket } }` to the bucket name plus the grant's credentials (`<KEY>`, `<KEY>_ACCESS_KEY`,
`<KEY>_SECRET_KEY`, `<KEY>_ENDPOINT`). Values reach the VM only, never the browser.

**VM health.** CPU from the cloud's monitoring; memory and disk from `free -b` and `df -B1 /` over SSH; requests per
24 h and 2xx/3xx share from Caddy's JSON access log (`/var/log/caddy/access.log`), summarised on the VM by a script.

**MongoDB on a VM.** `src/services/engines/mongodb-vm.js` gives the Databases screen the same actions as managed
MySQL, built from compute and the remote runner:

- **The VM** is a normal VM record with `role: database` and `ownedBy: <database>`: Ubuntu 22.04 LTS (an OS MongoDB
  7.0 supports; check MongoDB's platform matrix before changing either), sized from the tier, no Docker, no endpoint,
  SSH only from the control address. Data lives on a **separate data disk** mounted at `/var/lib/mongodb`, so the boot
  disk can be replaced and the data disk can grow.
- **Install** (`mongodb-install` script): MongoDB's signed apt repository pinned to 7.0, `mongod` bound to the private
  IP and localhost, `security.authorization: enabled`, WiredTiger cache sized to the VM, systemd, unattended security
  upgrades for the OS (MongoDB minor upgrades are an explicit action).
- **Users** with `mongosh` over SSH (`createUser`, `dropUser`, `changeUserPassword`; passwords passed on stdin, never
  as arguments). The admin password is generated and kept in secrets.
- **Access**: the database VM's firewall/security group allows 27017 only from the private IPs of `allowVms`.
  Connection string `mongodb://<user>:<password>@<private IP>:27017/<db>?authSource=admin`.
- **Backups**: on first use the account gets a private `noobly-<install>-backups` bucket. The VM gets a service
  account / instance profile that may only write under `mongodb/<database>/`; a systemd timer at the chosen time runs
  `mongodump --archive --gzip` and streams it to the bucket with the cloud's CLI (installed by cloud-init); a bucket
  lifecycle rule deletes archives after the retention period. **Back up now** runs the same script. **Restore** creates
  a new database (VM) and runs `mongorestore` from the chosen archive.
- **Grow storage**: when the data disk passes 90%, `compute.resizeDisk()` adds 10 GB, then `disk-grow` runs
  `growpart`/`resize2fs` online.
- **Resize** stops the VM, changes the machine type and starts it (a few minutes of downtime, said in the confirm
  dialog). **Metrics**: VM CPU from the cloud, plus `db.serverStatus()` (connections, operations, cache) over SSH.
- **High availability** (a three-VM replica set) is later (roadmap phase 7).

## 10. Secrets

`src/services/secrets.js`: `put(kind, value) → ref`, `get(ref)`, `remove(ref)`, `reveal(ref, person, reason)`.
Backed by the nooblyjs-core settings service with the `encrypted` provider (AES-256-GCM, key from `INFRA_SECRET_KEY`,
else the host's `SETTINGS_SECRET`/`SESSION_SECRET`). Holds: cloud credentials, the control key, database admin and user
passwords (MySQL and MongoDB), bucket grant keys, Git personal access tokens, webhook secrets, uploaded TLS keys. Records hold only `…Ref`s.

- The API never returns a secret, except `POST /databases/:name/reveal`, which needs `approve`, is people-only, and
  writes an audit record. The UI hides it again after 60 s.
- Database passwords are generated server-side (32 chars, URL-safe) and set through the cloud API (MySQL) or `mongosh` on stdin (MongoDB).
- Logs and operation logs are scrubbed of known secret values before they are written.

## 11. UI

### 11.1 The module and pages

`public/js/module.js` exports `routes`, relative to the mount path; the frame matches the URL, lazy-imports the page
and calls `render(view, { params, query, ctx, route })`. `ctx` gives `api` (fetch wrapper rooted at
`<mountPath>/api/v1`, CSRF and abort built in), `sse`, `signal` (aborted when the person leaves), `isCurrent()`,
`app.mountPath`, `person`.

```js
export const routes = [
  { path: '/', nav: 'overview', title: 'Infrastructure', page: () => import('./pages/overview.js') },
  { path: '/vms', nav: 'vms', title: 'Virtual machines', page: () => import('./pages/vms.js') },
  { path: '/vms/new', nav: 'vms', title: 'Launch a Linux VM', page: () => import('./pages/vm-launch.js') },
  { path: '/vms/:name', nav: 'vms', title: 'Virtual machine', page: () => import('./pages/vm.js') },
  // apps, apps/new, apps/:name, databases(/:name), databases/new, buckets(/:name), buckets/new, accounts, activity
];
```

Pages build HTML with the kit's `html``…``` (escapes every value; `raw()` only for kit output) and set
`view.innerHTML`. Event handling is delegated on `view` with `{ signal: ctx.signal }` and `data-action` attributes.
Focus and scroll are kept across redraws (the seeded pattern in `runs.js`).

### 11.2 Live updates

`live.js`'s `reloadable(view, ctx, draw)` stays: hosted, it redraws (at most every 500 ms) when an event whose type
starts with `infrastructure.` arrives on `ctx.sse`; standalone without a stream, `draw()` returns a delay while
anything on the page is transitional and the page polls. Operation logs on VM/app pages append lines from
`infrastructure.operation.progress` events instead of redrawing.

### 11.3 Components

From the kit (`/ui/js/components/index.js`): `pageHead`, `card`, `notice`, `button`, `statusPill`, `statCard`,
`dataTable`, `chips`, `meter`, `listRow`, plus `/ui/js/format.js` (`money`, `count`, `ago`). App components in
`public/js/components/`, each a function returning `html`:

| Component | Mockup class | Used on |
| --- | --- | --- |
| `cloudBadge(cloud)` | `.prov .prov-g/.prov-a` | everywhere |
| `engineBadge(engine, version)` | `.eng .eng-my/.eng-mg` | databases |
| `optionCards({ name, legend, items, value })` | `.opt` + `.rad` (radio cards, `:has(:checked)`) | all create forms |
| `switchRow({ name, title, text, checked })` | `.sw` (`role="switch"` checkbox) | all create forms |
| `formSection(n, title, body)` | `.sec` + `.step` | all create forms |
| `summary(rows, total, parts, action, note)` | aside `.sumrow` | all create forms |
| `kv(pairs)` | `dl.kv` | VM detail, databases, buckets |
| `codeLog(lines)` | `pre.code` | VM detail, app detail |
| `copyField(text, label)` | `.codebox` | SSH command, connection string, public URL |
| `tabs(items, current)` | `.tabs .tab` (`role="tablist"`) | database panel |
| `dropZone(path)` | `.drop` | object browser |
| `actionsMenu(items)` | `.btn-icon` "…" | VM table |
| `confirmDialog({ title, text, typeToConfirm })` | (new; native `<dialog>`) | deletes, make public |
| `envRows(rows)` | `.env` | deploy form |

### 11.4 Styling

The mockups' colours, type and radii are the kit's tokens (`#F5F1EE` = `--surface-page`, `#241C1A` = `--navy-900`,
`#C2471F` = `--blue-600`, `#6B605A` = `--text-subtle`, `#E6DED8` = `--border`, `#DDEFEC`/`#1C5A5F` =
`--success-100/700`, Figtree / Bricolage Grotesque / JetBrains Mono are self-hosted by the kit). `infrastructure.css`
uses tokens only, scopes every selector under `[data-module="infrastructure"]`, and defines the few colours the kit
lacks as app tokens:

```css
[data-module="infrastructure"] {
  --inf-gcp-bg: #D6E4FA;  --inf-gcp-fg: #1F4A8A;
  --inf-aws-bg: #FBE6A6;  --inf-aws-fg: #6B4E00;
  --inf-mysql-bg: #E5DAF5; --inf-mysql-fg: #4B2E83;
  --inf-mongo-bg: #DCE8C8; --inf-mongo-fg: #3D5A1E;
}
```

Layout follows the mockups: content max 1240 px, cards radius 20 px, numbered form + 320 px summary aside that wraps
below at narrow widths, tables in an `overflow-x: auto` card, 44 px minimum targets, the 860 px breakpoint.

### 11.5 Forms

Create forms are real `<form>`s with named controls. `public/js/forms.js` turns `FormData` into the spec JSON. On
every `input`, the page recomputes the summary with **`public/js/shared/estimate.js`** and the catalogue from
`GET /catalog` — the *same module* the server imports to price the spec it stores, so the browser and the server can't
disagree. Name rules (`shared/names.js`) are shared the same way; the bucket name check debounces a call to
`GET /buckets/check-name`. Submitting POSTs the spec; on 202 the page navigates to the new resource, which shows the
operation's progress. Server-side validation is authoritative and answers `422` with per-field `details`, which the
form shows next to the fields.

### 11.6 Uploads and downloads

Uploads stream through the server (`POST /buckets/:name/objects?key=<path>`, raw body, `Content-Type` from the file)
straight into the provider's `put()` — no buffering to disk, size capped by `INFRA_UPLOAD_MAX_MB`, keys validated
(no `..`, no leading `/`). The page uses `XMLHttpRequest` for upload progress. Downloads stream back with
`Content-Disposition: attachment`. (Direct-to-cloud signed uploads would need the frame's CSP to allow cloud origins;
not in v1.)

## 12. Cost

- **Catalogue** (`src/catalog/data/{gcp,aws}.yaml`): per region, hourly machine prices, disk GB-month, static IP,
  database tiers (and HA multiplier), database storage and backup GB-month, bucket class GB-month; each file has
  `asOf`. A script (`npm run catalog:refresh`, later) regenerates them from the Cloud Billing Catalog API and the AWS
  Price List API.
- **Estimate** (`shared/estimate.js`): `estimate(spec, catalog) → { monthly, parts: [{ label, monthly }] }`, 730
  hours a month. A stopped VM costs its disk (and static IP). A MongoDB database costs its VM, its boot and data
  disks, and its share of the backups bucket (archive size × retention).
- **Spend this month** (Overview): the hourly cost snapshot job (§8) sums each resource's rate for the state it was in
  that hour; reset on the 1st. Labelled "Estimate". Real billed spend (GCP billing export, AWS Cost Explorer) is a
  later phase (open decision O7).

## 13. API

All under `<mountPath>/api/v1`, signed in, JSON, writes audited, one error shape
`{ "error": { "code", "message", "details" } }` (kept from `src/util/errors.js`). Long actions answer **202** with
`{ operation }`.

| Resource | Routes |
| --- | --- |
| System | `GET /about` · `GET /summary` (Overview) · `GET /catalog?account=` · `GET /activity?limit=&type=` · `GET /cost?month=` · `POST /seed` (Owner, not in production) |
| Accounts | `GET /accounts` · `POST /accounts` · `GET /accounts/:id` · `POST /accounts/:id/verify` · `PATCH /accounts/:id` · `DELETE /accounts/:id` |
| Git connections | `GET /git/connections` · `POST /git/connections` (`{ host, token }`; Owner) · `POST /git/connections/:id/verify` · `DELETE /git/connections/:id` · `GET /git/repos?connection=` · `POST /git/check` (repo, branch, dockerfile → found, exposes, base image) |
| SSH keys | `GET /ssh-keys` · `POST /ssh-keys` · `DELETE /ssh-keys/:id` · `GET /my-ip` |
| VMs | `GET /vms?cloud=&q=` · `POST /vms` · `GET /vms/:name` · `POST /vms/:name/start` · `…/stop` · `…/restart` · `DELETE /vms/:name` · `GET /vms/:name/metrics?window=` |
| Endpoints | `GET /endpoints` · `POST /vms/:name/endpoints` · `PATCH /endpoints/:id` · `DELETE /endpoints/:id` |
| Apps | `GET /apps?status=&q=` · `POST /apps` (deploy) · `GET /apps/:name` · `PATCH /apps/:name` · `POST /apps/:name/deploy` · `POST /apps/:name/stop` · `DELETE /apps/:name` · `GET /apps/:name/deploys` · `GET /apps/:name/deploys/:id` |
| Databases | `GET /databases` · `POST /databases` · `GET /databases/:name` · `POST /databases/:name/reveal` · `PUT /databases/:name/access` · `POST /databases/:name/resize` · `GET/POST /databases/:name/backups` · `POST /databases/:name/restore` · `GET/POST /databases/:name/users` · `DELETE /databases/:name/users/:user` · `GET /databases/:name/metrics` · `POST /databases/:name/restart` (MongoDB) · `DELETE /databases/:name` (MongoDB: also deletes its VM and disks; backups are kept until they expire) |
| Buckets | `GET /buckets` · `GET /buckets/check-name?account=&name=` · `POST /buckets` · `GET /buckets/:name` · `PATCH /buckets/:name` · `DELETE /buckets/:name` |
| Objects | `GET /buckets/:name/objects?prefix=&cursor=` · `POST /buckets/:name/objects?key=` (upload) · `POST /buckets/:name/folders` · `GET /buckets/:name/object?key=` (download) · `POST /buckets/:name/share` (`{ key, days ≤ 7 }`) · `DELETE /buckets/:name/object?key=` |
| Operations | `GET /operations?resource=&status=` · `GET /operations/:id` · `POST /operations/:id/cancel` · `POST /operations/:id/retry` |
| Hooks (no session) | `POST <mountPath>/hooks/git/:app` |

Deletes take `{ confirm: "<name>" }` in the body and refuse without it (the API, not only the dialog).

## 14. Testing

- **`node:test`, offline, on the mock provider** (`npm test`). The seeded stand-in host (`test/fixtures/host.js`) and
  helpers (`startApp`, `t.get(…, { as: 'stevie' })`) stay.
- **Contract suite** (`test/providers/contract.test.js`): one set of tests every provider must pass. Always runs
  against `mock`; runs against `gcp`/`aws` when `INFRA_CLOUD_TESTS=gcp,aws` and sandbox credentials are set. Real-cloud
  runs label everything `noobly-test=<run id>` and delete it in `after`, plus a sweeper script for leftovers.
- **Operations**: each step type runs to success; crash-and-recover at every step (kill between steps, call
  `recover()`, assert no duplicate cloud resource); cancel; failure injection; one-at-a-time per resource.
- **Remote runner**: a fake SSH executor records commands and files; assert every argument is validated and no user
  value appears unquoted in a command line.
- **API**: permissions per route (product.md §7), refusals audited, confirm-to-delete, the error shape, 202 +
  operation for long actions, reveal audited and people-only; a database refuses `allowVms` or an app link from
  another account (or, on AWS, another region) with 422.
- **MongoDB on a VM**: install, users, backup and restore scripts run against the fake SSH executor; the mock
  provider's database VM is hidden from `GET /vms` and listed with `?role=database`.
- **Git tokens**: never returned by any route, never in an operation log or command line (asserted against the fake
  executor).
- **Shared modules**: `estimate.js` against the mockups' numbers ($30 VM, $56 database, ~$0.03/GB), `names.js`.
- **UI**: `test/public/` keeps the module tests (routes, nav); pages render against a fake `ctx` with seed data and are
  checked for the mockups' headings, labels and accessible names.
- **Express 4 and 5**: CI runs the suite twice (`EXPRESS_MAJOR=4|5`).

## 15. Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 11008 | Standalone only. |
| `DATA_DIR` | `./data` | Standalone only; records in `<DATA_DIR>/infrastructure`. |
| `INFRA_PROVIDERS` | `mock` | Which adapters may be used: `mock`, `gcp`, `aws` (comma-separated). |
| `INFRA_MOCK_STEP_MS` | 1200 | Mock provider pace. |
| `INFRA_SECRET_KEY` | host's `SETTINGS_SECRET` | Key for secrets at rest. Required outside development. |
| `INFRA_PUBLIC_URL` | — | Where Git webhooks reach this server. Without it, auto-deploy is off. |
| `INFRA_CONTROL_CIDR` | detected | The server's egress address(es) allowed to SSH to VMs. |
| `ACME_EMAIL` | — | Let's Encrypt account email written into Caddy. |
| `INFRA_OPS_PER_ACCOUNT` | 4 | Concurrent operations per cloud account. |
| `INFRA_SYNC_CHECK_MS` | 60000 | How often the job timer checks what is due. |
| `INFRA_UPLOAD_MAX_MB` | 512 | Largest single upload through the browser. |

## 16. Decisions and open questions

**Decided**

- **D1 Keep the seeded loading contract** (`register()`, host capabilities, HostedApp description, FsStore records,
  error shape, live redraw). Replace its domain.
- **D2 No React, no build.** Native ES modules and the NooblyJS UI kit; pure logic shared by browser and server lives
  in `public/js/shared/`.
- **D3 Cloud SDKs, not Terraform/Pulumi.** The product exposes a small, fixed set of resources with per-step progress
  and per-resource actions (start, stop, back up, resize); imperative calls behind an adapter give that directly, with
  no state file to store and lock. Labels plus records are the state.
- **D4 Caddy on each VM** for TLS (automatic Let's Encrypt issuance and renewal for domains, `tls internal` for the
  cloud's address) and routing to containers.
- **D5 SSH control channel** with a per-install key for first-boot checks, deploys, health and certificate reads.
- **D6 The cloud is the source of truth**; records are intent + last observed; sync never deletes records.
- **D7 Estimates from a dated catalogue**, shared by browser and server.
- **D8 MongoDB runs on a VM Noobly Cloud launches and looks after** (§9): the same on both clouds, real MongoDB 7.0,
  no third-party account. MySQL stays managed (Cloud SQL / RDS).
- **D9 The default public address is the cloud's own**: the AWS public DNS name, or the GCP static IP. No DNS zone to
  own or manage. Trusted HTTPS needs the person's domain.
- **D10 Databases are reached only from VMs in the same cloud account** (and, on AWS, region). No public database
  access, no cross-cloud networking.
- **D11 Git access by personal access token** (GitHub, GitLab), stored as a secret, added by an Owner.
- **D12 The accelerator depends on the host contract, not on a launcher.** `../app.js` is the launcher; the NooblyJS AI
  host is an example of one.

**Open (each blocks the roadmap item named)**

| # | Question | Options | Recommendation | Blocks |
| --- | --- | --- | --- | --- |
| O4 | Control channel | SSH from the server (D5); agent on the VM polling over HTTPS | SSH for v1; revisit if inbound SSH from the server is unacceptable | — |
| O6 | Secrets backend | nooblyjs-core encrypted settings; cloud secret managers | Encrypted settings now, interface ready for the others | — |
| O7 | Real spend | GCP billing export to BigQuery + AWS Cost Explorer | Later; estimates in v1 | Phase 7 |
| O8 | The launcher's entry-point convention across accelerators | `register(app, serverManager, { host, … })` (this one); `mount(app, eventEmitter, serviceRegistry, options)` (customers) | One convention, agreed with the `../app.js` owner; this accelerator keeps `register()` | Phase 0.6 |
| O9 | Trusted HTTPS without the person's own domain | Let's Encrypt certificates for IP addresses (short-lived; check Caddy support); a wildcard-IP DNS service such as `sslip.io`; stay self-signed | Stay self-signed in v1; revisit IP certificates | Phase 7 |
