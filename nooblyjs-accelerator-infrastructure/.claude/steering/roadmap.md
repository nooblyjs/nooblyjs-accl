# Roadmap: Noobly Cloud (Infrastructure accelerator)

The order Noobly Cloud is built in. What and why: `product.md`. How: `architecture.md` (§ numbers below point
there). Tick a box in the same change as the work. Each phase ends with its **exit check**: the phase is not done until
that passes.

Ground rules for every phase:

- Everything works **offline on the mock provider first** (seed story, tests, screens); the real clouds come after,
  behind the same adapter contract (§6).
- A screen is done when it matches its mockup in `.claude/steering/ui/` at desktop and phone width, is keyboard and
  screen-reader usable, and its numbers come from records (no hard-coded totals).
- `npm test` stays green and offline. New routes get permission tests; new operation types get crash-and-recover tests.

## Where we start (2026-10-20)

The repo holds a seeded hosted app whose **loading contract we keep** (`register()`, the host capabilities, the
HostedApp description, FsStore records, the error shape, the UI module + frame, live redraw, `node:test` with a
stand-in host) and whose **domain we replace** (infrastructure designs, environments, provisioning runs, drift,
blueprints, policies, approvals). Known gaps in the seed:

- `package.json` is named `nooblyjs-ai-infrastructure` and its `start`/`seed` scripts run `server.js`, which doesn't
  exist.
- `README.md` describes an older cloud micro-service; `CLAUDE.md` describes the NooblyJS AI app and points at files that
  aren't here (`.claude/steering/nooblyjs-ai.md`, `stack.md`, `structure.md`, `docs/roadmap-history.md`).
- The page fallback route `'/{*rest}'` is Express 5 only; the launcher (`../app.js`) runs Express 4 and does not
  build a `host` yet. (The seed was written against the NooblyJS AI host, which is only an example of a launcher.)

---

## Phase 0 — Reset the skeleton

Goal: the seeded contract, with this product's name, nav and empty pages, loaded by the launcher and standalone (§3.3).

- [x] 0.1 Remove the seeded domain: `src/services/{designs,environments,runs,drift,policies,policy-checks,approvals,sweep,views,code}.js`, their routes, pages, seed data and tests. Keep `src/util/*`, `public/js/{lib,live}.js`, `test/fixtures/host.js`, `test/helpers.js`.
- [x] 0.2 Rename the package (`nooblyjs-accelerator-infrastructure`), fix its description, add `exports["./host"]`; rewrite `README.md` and `CLAUDE.md` for this product (point at these three steering docs).
- [x] 0.3 `NAV` and the HostedApp description for Overview, Virtual machines, Apps, Databases, Buckets; `public/js/module.js` with every route from product.md §5, each page rendering its title and an empty state.
- [x] 0.4 `src/host/standalone.js` (`createStandaloneHost()`: nooblyjs-core `createShell()`, `/ui` static, FsStore, dev sign-in, in-memory events + SSE) and `server.js`; `npm start` serves the frame on :11008.
- [x] 0.5 Express 4/5 compatibility: replace `'/{*rest}'` with the fallback middleware (§3.4); run the suite under both majors.
- [x] 0.6 Load the accelerator from the launcher `../app.js` via `register()` (using `createDevLauncher()` until the launcher builds its own host). Proven by `test/launcher.test.js` (CommonJS, Express 4, real nooblyjs-core).
- [ ] 0.6a Agree one entry-point convention for all accelerators with the launcher's owner (architecture O8): `nooblyjs-accelerator-customers` uses `mount()`.
- [ ] 0.6b Make `../app.js` runnable: it calls `serviceRegistry.dataServe()` (nooblyjs-core's is `dataService()`), and the monorepo root has no `node_modules` and doesn't list `passport`, which it requires.
- [x] 0.7 `infrastructure.css` skeleton: scoped, app tokens for cloud and engine badges (§11.4).

**Exit check:** `npm test` green on Express 4 and 5; both `npm start` and the launcher (`../app.js`) show the five nav
items and every route from product.md §5 renders (deep link + refresh); `register()` with a missing host capability
mounts nothing.

## Phase 1 — Foundations (mock cloud)

Goal: everything the resource screens stand on, plus the Overview, on the mock provider.

- [ ] 1.1 Provider contract (`src/providers/contract.js`) and registry (per-account instances, lazy SDK loading).
- [ ] 1.2 Mock provider: in-memory cloud, timings, failure injection, out-of-band changes (§6.3).
- [ ] 1.3 Records and repos for accounts, VMs, endpoints, apps, deploys, databases, buckets, operations, ssh keys, activity, config (§5).
- [ ] 1.4 Operations engine: queue, steps, per-account concurrency, one-at-a-time per resource, recover, cancel, retry, events (§7).
- [ ] 1.5 Scheduled job runner (host clock, `unref`, stopped by `close()`), with the inventory sync and account check jobs (§8).
- [ ] 1.6 Secrets service over nooblyjs-core encrypted settings; log scrubbing (§10).
- [ ] 1.7 Catalogue (`gcp.yaml`, `aws.yaml` with `asOf`) and `public/js/shared/estimate.js`; `GET /catalog`; tests against the mockups' figures (§12).
- [ ] 1.8 Activity: `withWords()` sentences for every event type; `GET /activity`; Activity page.
- [ ] 1.9 Cloud accounts on mock: API, sidebar status card ("Connected"), **Accounts page** (needs a design; build from kit components until then). The Git connections section of that page comes in phase 6.
- [ ] 1.10 Seed story reproducing the mockups (product.md §9), records + mock cloud state; `npm run seed [-- --reset]`.
- [ ] 1.11 **Overview** page (`Main.dc.html`): totals, create tiles, HTTPS endpoints, recent activity, spend this month.
- [ ] 1.12 App components shared by all screens: `cloudBadge`, `engineBadge`, `kv`, `copyField`, `confirmDialog`, `actionsMenu` (§11.3).

**Exit check:** after `npm run seed`, the Overview matches `Main.dc.html` with computed numbers; killing the server
mid-operation and restarting resumes it with no duplicate mock resource.

## Phase 2 — Virtual machines

Goal: launch, see and run Linux VMs, first on mock, then on GCP, then on AWS.

- [ ] 2.1 VM API (§13) with permissions (product.md §7) and confirm-to-delete.
- [ ] 2.2 `vm.launch`, `vm.start`, `vm.stop`, `vm.restart`, `vm.delete` steps; static IP, firewall/security group, labels.
- [ ] 2.3 Form components: `formSection`, `optionCards`, `switchRow`, `summary`; `forms.js`; shared `names.js`.
- [ ] 2.4 **Virtual machines** page (`VirtualMachines.dc.html`): cloud chips, search (in the URL), table, statuses, actions menu, info band.
- [ ] 2.5 **Launch a Linux VM** page (`LaunchVM.dc.html`): five sections, live summary and estimate, SSH keys (saved or pasted), "My IP only" (`GET /my-ip`, honours `trust proxy`), 422 field errors. The endpoint section is built but hidden behind a flag until phase 3 provides its API.
- [ ] 2.6 **VM detail** page (`VMDetail.dc.html`): header and actions, Details card, launch progress while starting; Health tiles from mock metrics.
- [ ] 2.7 cloud-init template (§9): `noobly` user, keys, Docker; ready marker; SSH runner (`ssh2`, pooled) with the fake-executor tests.
- [ ] 2.8 **GCP compute adapter**: network `noobly-cloud`, instance, static address, firewall, images, machine types, extra data disks and disk resize, Cloud Monitoring CPU; contract suite passes against a sandbox project.
- [ ] 2.9 **AWS compute adapter**: VPC, EC2, Elastic IP and the public DNS name, security group, AMIs via SSM, EBS data volumes and resize, CloudWatch CPU; contract suite passes against a sandbox account.
- [ ] 2.10 Real account connection for GCP (service account JSON) and AWS (AssumeRole + ExternalId), with a documented least-privilege role for each.
- [ ] 2.11 VM memory/disk health over SSH; 60 s cache.

**Exit check:** on a real GCP project and a real AWS account, a Contributor launches an Ubuntu 24.04 VM with Docker
from the form, sees it go Starting 1→2 of 3 → Running live, SSHes in with the shown command, stops and starts it
(same IP), and an Approver deletes it; nothing labelled `noobly-install` is left behind.

## Phase 3 — Public endpoints

- [ ] 3.1 Caddy in cloud-init; one site file per endpoint; HTTP→HTTPS redirect; uploaded certificates (§9).
- [ ] 3.2 **The cloud's address** (architecture D9): the AWS public DNS name or the GCP static IP; HTTP, plus HTTPS with Caddy `tls internal`; the UI wording that it is self-signed and a domain gives a trusted certificate; several apps on one address by path.
- [ ] 3.3 **Own domains**: the A record (or AWS CNAME) to add, shown once the IP is reserved; the DNS check job (§8); Let's Encrypt via Caddy.
- [ ] 3.4 `endpoint.add` operation and the `vm.launch` step 3; ports 80/443 opened on demand.
- [ ] 3.5 Certificate status and expiry from Caddy; the certificate check job.
- [ ] 3.6 VM detail **HTTPS endpoints** card (add, edit, remove); endpoint column on the VM list; Overview endpoints card live; "Paused while stopped".

**Exit check:** on both clouds, a VM launched with the cloud's address answers on `http://<address>` straight away
(and on HTTPS, self-signed); a VM launched with "my own domain" serves `https://<domain>` with a valid Let's Encrypt
certificate once the A record is added, and the DNS/cert pills go Waiting → Verified/Valid without a page refresh.

## Phase 4 — Buckets

Buckets come before databases: simpler cloud APIs and no private networking.

- [ ] 4.1 Bucket API, name check, `bucket.create/update/delete` operations; storage classes, access, versioning, lifecycle on mock.
- [ ] 4.2 **Create a bucket** page (`CreateBucket.dc.html`): debounced availability check, class cards with prices, access, versioning/clean-up, summary.
- [ ] 4.3 **Buckets** page (`Buckets.dc.html`): table with selection; object browser (folders, breadcrumb, cursor paging), object panel, bucket settings.
- [ ] 4.4 Objects API: streamed upload with progress and size cap, new folder, download, delete (confirm), share for ≤ 7 days (`approve`); `dropZone` component.
- [ ] 4.5 Making a bucket public is `approve`, people-only, confirm-typed, audited.
- [ ] 4.6 **GCS adapter** and **S3 adapter**; bucket stats job (Monitoring / CloudWatch).
- [ ] 4.7 App access grants (`iam.grantBucket`) stored as secrets; "Give an app access" select (wired to apps in phase 6).

**Exit check:** on both clouds, create a private bucket and a public one, upload a 200 MB file from the browser with
progress, open the public URL, share a private file and open the link in a signed-out browser, delete with confirm.

## Phase 5 — Databases (managed MySQL, and MongoDB on a VM)

- [ ] 5.1 Database API, `db.create/backup/restore/resize/delete` operations on mock for both engines; generated admin password in secrets.
- [ ] 5.2 Same-cloud rule (architecture D10): `allowVms` and app links limited to the database's account (and AWS region), refused with 422 otherwise; no public access option.
- [ ] 5.3 **Create a database** page (`CreateDatabase.dc.html`): engine, version, cloud cards worded per engine, region hint, tiers with prices (VM sizes for MongoDB), storage, auto-grow, HA (MySQL only), fixed "Private · only VMs in this cloud account" text instead of the public option, VMs that can connect (same account only), backup time and retention, admin user, summary.
- [ ] 5.4 **Databases** page (`Databases.dc.html`): cards with selection (`/databases/:name`), storage meters, panel with `tabs`: Connect (masked string, Reveal — `approve`, audited, hides after 60 s; who can connect; allow another VM; the same-cloud sentence; SSH-tunnel command for laptops), Backups (list, back up now, restore to new), Users, Metrics.
- [ ] 5.5 **Cloud SQL adapter**: private IP via Private Service Access (set up once per account), SSL required, backups, HA, resize, users, metrics.
- [ ] 5.6 **RDS adapter**: subnet group, security group from VM security groups, `rds.force_ssl`, backup window/retention, Multi-AZ, resize, users, CloudWatch metrics.
- [ ] 5.7 **MongoDB on a VM** (architecture D8, §9): database VMs (`role: database`, hidden from the VM list), data disk, `mongodb-install` script (MongoDB 7.0 Community, auth on, private IP only), firewall on 27017 for `allowVms`.
- [ ] 5.8 MongoDB users with `mongosh` over SSH; metrics from `db.serverStatus()`; restart; resize (with downtime warning); storage auto-grow (disk resize + online filesystem grow).
- [ ] 5.9 MongoDB backups: per-account backups bucket, VM identity limited to its prefix, systemd timer running `mongodump`, lifecycle retention, back up now, backup status job, restore into a new database VM with `mongorestore`.

**Exit check:** on both clouds, create a Standard MySQL database and a Standard MongoDB database, each private to one
VM in the same account; connect from that VM with the revealed string; confirm a VM that wasn't allowed (and any VM in
the other cloud) cannot connect or be chosen; take a backup of each and restore it to a new database.

## Phase 6 — Apps (deploy from Git)

- [ ] 6.1 **Git connections** with personal access tokens (architecture D11): GitHub and GitLab; the Owner adds a token on the Accounts page; the token's user, scopes and expiry are checked on save and daily; stored in secrets; used to list repos and create webhooks.
- [ ] 6.2 `POST /git/check`: read the Dockerfile through the Git host's API; report exposed port and base image.
- [ ] 6.3 `app.deploy` operation, nine steps, blue/green on one VM, health check gate, streamed build log, deploy history (§9); private clones on the VM through a `GIT_ASKPASS` helper so the token is never on a command line.
- [ ] 6.4 Env vars: plain, secret, linked to a database (connection string) or bucket (name + grant keys), written to a 0600 env file on the VM.
- [ ] 6.5 **Deploy an app from Git** page (`DeployApp.dc.html`): source with check result, VM cards with load, run settings, env rows with link buttons, HTTPS endpoint with path and health check, "What happens next".
- [ ] 6.6 **Apps** page (`Apps.dc.html`): status chips, search, table, Redeploy / View log / Start VM.
- [ ] 6.7 **App detail** page (needs a design): deploy history, logs (`docker logs` tail), env (secrets hidden), stop, delete.
- [ ] 6.8 VM detail **Apps on this VM** and **Latest deploy** cards; Overview "Deployed/Building" activity.
- [ ] 6.9 Auto-deploy webhook (`hooks/git/:app`, mounted before auth, HMAC verified, branch filtered); requires `INFRA_PUBLIC_URL`.
- [ ] 6.10 Requests per 24 h and 2xx/3xx share from Caddy access logs on VM detail.

**Exit check:** deploy `storefront` from a private GitHub repo (personal access token) to a VM with a linked database
in the same cloud and a bucket, reach it on its endpoint, push a commit and watch it rebuild and switch with zero failed requests; push a commit whose health check fails
and confirm the old version keeps serving.

## Phase 7 — Beyond v1

Ordered by expected value; each needs its open decision settled first (architecture §16).

- [ ] 7.1 MongoDB high availability: a three-VM replica set across zones.
- [ ] 7.2 Trusted HTTPS on the cloud's address without the person's domain (O9).
- [ ] 7.3 Bucket custom domains over HTTPS (GCS backend bucket + managed cert behind a load balancer; S3 + CloudFront + ACM).
- [ ] 7.4 Real billed spend (O7: GCP billing export, AWS Cost Explorer) beside the estimate; budgets and alerts.
- [ ] 7.5 Catalogue refresh script from the Cloud Billing Catalog and AWS Price List APIs.
- [ ] 7.6 Adopt existing cloud resources into Noobly Cloud.
- [ ] 7.7 Resize VMs; snapshots; scheduled stop/start for non-production VMs.
- [ ] 7.8 On-VM agent as an alternative to inbound SSH (O4).

## Designs still needed

Screens in product.md with no mockup yet: **Cloud accounts** (and connect flows for GCP and AWS), **Git
connections** (adding a personal access token), **App detail**, **Activity**, **confirm-delete dialog**, the
**actions menu**, **error and empty states** for each list, and the **Backups / Users / Metrics** tabs of the
database panel. Phases build them from kit components first and restyle when a design arrives.

The existing mockups also need small changes to match the decisions: Launch VM's "generated address" becomes "the
cloud's address"; Create a database loses "Public, with an IP allowlist" and gains MongoDB-on-a-VM wording; the
Databases panel loses the private-tunnel sentence.
