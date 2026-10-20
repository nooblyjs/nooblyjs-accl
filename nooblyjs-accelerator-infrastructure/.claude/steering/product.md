# Product: Noobly Cloud (Infrastructure accelerator)

What this accelerator is, who it is for, and what each screen must do. The UI designs it is built from are in
`.claude/steering/ui/` (ten mockups, listed in §6). How it is built is `architecture.md`; the order it is built in is
`roadmap.md`.

## 1. In one paragraph

Noobly Cloud lets a small team run its own infrastructure on **Google Cloud (GCP)** and **Amazon Web Services (AWS)**
without learning either console. From one place, a person connects their cloud accounts, then **launches Linux VMs**,
**creates databases** (managed MySQL, or MongoDB installed on a VM launched for it) and **creates storage buckets** on
either cloud, puts a VM on a **public address** (the cloud's own, or their domain with a certificate that renews
itself), and **deploys apps from Git** (a repo's Dockerfile, built and run on one of their VMs). Every screen shows what things cost per month before and after they are created.
It is an opinionated subset of the clouds, not a replacement for their consoles: sensible defaults, a few sizes, plain
words.

## 2. Who it is for

| Person | What they want | What they must never have to do |
| --- | --- | --- |
| **Owner / platform engineer** (Stevie in the designs) | Connect the company's GCP project and AWS account once; see everything that is running and what it costs; stay in control of who can delete or expose things. | Hand out cloud console access to everyone. |
| **Developer** | A VM with Docker and HTTPS in two minutes; deploy a repo; get a database connection string; somewhere to put uploads. | Write Terraform, configure Nginx/certbot, set up security groups or IAM by hand. |
| **Viewer** (product manager, finance) | See what exists, where, whether it is up, and the monthly estimate. | Change anything. |

People sign in through the host (NooblyJS). Their **access role** decides what they may do (§7). Agents (non-human
actors) may read and propose, never destroy or reveal secrets.

## 3. Principles

1. **Plain words over cloud words.** "Small · 2 vCPU · 2 GB" first, `e2-small` second. "Private · only my VMs" rather
   than VPC peering. The cloud's own names are shown, smaller, for people who know them.
2. **Same product on both clouds.** A VM, a database and a bucket look and behave the same whichever cloud they are
   on; the cloud is a badge (`GCP` blue, `AWS` amber), not a different screen.
3. **Cost is always visible.** Every create form has a live summary with an estimated monthly price; every list has an
   "Est. / month" column; the Overview totals it per account.
4. **Safe by default.** New databases are private; SSH is open to "my IP only"; buckets are private; HTTPS redirects
   HTTP. Anything less safe is a deliberate, labelled choice ("Anywhere (not recommended)").
5. **Long things show progress.** Launching, building, backing up and restoring take minutes. Each one is an
   operation with steps ("Starting · 1 of 3", "Building · step 4 of 9", "Backing up · 64%") that updates live and
   survives a restart of the server.
6. **The cloud is the truth.** If someone changes or deletes a resource in the cloud console, Noobly Cloud notices and
   shows it as it is, rather than as it was created.
7. **Nothing is destroyed by surprise.** Deleting a VM, database or bucket, or making a bucket public, asks for the
   name to be typed, is limited to roles that may do it, and is recorded in the audit log.

## 4. Scope

### In scope (v1)

| Area | Capabilities |
| --- | --- |
| **Cloud accounts** | Connect one or more GCP projects and AWS accounts; show Connected / Needs attention; disconnect. |
| **Git connections** | Connect GitHub (or GitLab) with a **personal access token**; used to list repos, clone private ones and add auto-deploy webhooks. |
| **Virtual machines** | Launch Linux VMs (Ubuntu 24.04 / 22.04, Debian 12, Rocky 9) in a chosen region and zone; preset sizes (Small, Medium, Large) or a custom machine type; SSD boot disk; Docker installed on first boot; SSH key; SSH allow-list; static public IP; start, stop, restart, delete; health (CPU, memory, disk, requests). |
| **Public endpoints** | Put a VM (and each app on it) on a public address: **the cloud's default address** for the VM (AWS: its public DNS name, `ec2-…compute.amazonaws.com`; GCP: its static IP, since GCP gives VMs no public hostname), or **the person's own domain** (an A record to the static IP, checked every minute) with a free auto-renewing certificate (Let's Encrypt) and HTTP→HTTPS redirect. The cloud's address cannot get a trusted certificate (§6.3), so it serves HTTP and self-signed HTTPS. Endpoints pause while the VM is stopped. |
| **Apps** | Deploy a Git repository's Dockerfile to one of your VMs; branch, Dockerfile path, build context; container port, restart policy, environment variables (plain or linked to a database/bucket as a secret); health check before switching traffic; logs; redeploy; auto-deploy on push. |
| **Databases** | **MySQL** (8.4 LTS, 8.0), managed by the cloud: Cloud SQL (GCP) or RDS (AWS). **MongoDB** (7.0): Noobly Cloud launches a VM for the database and installs, configures, backs up and patches MongoDB Community on it. Both: sizes Starter / Standard / Performance; storage that grows automatically; high availability (MySQL only in v1); **private only, reachable just from chosen VMs in the same cloud account**; daily backups at a chosen time, kept 7/14/30 days; connection string (revealed on request); restore, resize; users; metrics. |
| **Buckets** | Create buckets on Cloud Storage (GCP) or S3 (AWS) with a name-availability check; storage class (Standard / Infrequent / Archive); private or public read; versioning with retention; delete-after lifecycle rules; give an app access; browse folders, upload (drag and drop), download, share a time-limited link (7 days), delete objects. |
| **Overview** | Totals per resource type, quick-create tiles, public HTTPS endpoints and their state, recent activity, estimated spend this month per cloud account. |
| **Activity and audit** | Every create, change, deploy, backup, stop and delete appears in Recent activity and in the host's audit log, with who did it. |

### Out of scope (v1)

Windows VMs, Kubernetes, serverless functions, load balancers across several VMs, autoscaling, Azure, multi-region
replicas, importing ("adopting") resources that were not created here, real invoiced spend (v1 shows estimates),
bucket custom domains over HTTPS, MongoDB replica sets (see §8 and the roadmap for when these come).

**Not planned:** reaching a database from another cloud, or from the internet. A database is used by VMs in its own
cloud account; to connect from a laptop, open an SSH tunnel through one of those VMs (the Connect tab shows the
command).

## 5. Navigation

The host draws the rail and the sidebar from what this app declares; this app draws the content area only.

Sidebar (in order): **Overview**, **Virtual machines**, **Apps**, **Databases**, **Buckets**.
Sidebar footer card: **Cloud accounts** — each connected account with its cloud badge, name and state
(`Connected` in teal, `Needs attention` in red), and a **Manage accounts** link.

| Path (relative to the mount path) | Screen | Mockup |
| --- | --- | --- |
| `/` | Overview | `infra-overview/Main.dc.html` |
| `/vms` | Virtual machines | `infra-virtual-machines/VirtualMachines.dc.html` |
| `/vms/new` | Launch a Linux VM | `infra-launch-a-vm/LaunchVM.dc.html` |
| `/vms/:name` | VM detail | `infra-vm-detail/VMDetail.dc.html` |
| `/apps` | Apps | `infra-apps/Apps.dc.html` |
| `/apps/new` (`?vm=web-01` preselects the VM) | Deploy an app from Git | `infra-deploy-a-app/DeployApp.dc.html` |
| `/apps/:name` | App detail and deploy log | none yet (reuses the VM detail's log card) |
| `/databases` (`/databases/:name` selects one) | Databases, with the selected one's panel | `infra-databases/Databases.dc.html` |
| `/databases/new` | Create a database | `infra-create-a-database/CreateDatabase.dc.html` |
| `/buckets` (`/buckets/:name?path=products/2026/` opens the browser) | Buckets and object browser | `infra-buckets/Buckets.dc.html` |
| `/buckets/new` | Create a bucket | `infra-create-a-bucket/CreateBucket.dc.html` |
| `/accounts` | Cloud accounts | none yet |
| `/activity` | Full activity history | none yet |

Every page is a real URL: refresh and deep links land on the same screen.

## 6. Screens

Numbers in the mockups (5 VMs, 6 apps, $412) are the seed story (§9), not constants: every count, total and
estimate on a screen is computed from the records.

### 6.1 Overview (`Main.dc.html`)

- Title **Infrastructure**; lead line "*N* cloud accounts · *N* resources · est. $*N* this month". Primary button
  **Launch VM**.
- **Totals** (four tiles): Virtual machines (count; "3 running · 1 stopped · 1 starting"), Apps ("4 live on HTTPS ·
  1 building"), Databases ("2 MySQL · 1 MongoDB"), Bucket storage (total GB; "4 buckets · 2 public").
- **Create something**: four tiles linking to Launch a Linux VM, Deploy from Git, Create a database, Create a bucket.
- **Public HTTPS endpoints**: every endpoint, its app · VM · cloud, and state (`Live`, `Live · self-signed`, `VM stopped`,
  `Certificate pending`, `DNS not verified`). Live ones are links. "All apps" link.
- **Recent activity**: the latest five events with a verb pill (`Deployed`, `Building`, `Created`, `Backup`,
  `Stopped`, `Deleted`, `Failed`), a sentence, and a relative time. Links to `/activity`.
- **Spend this month**: one block per cloud account — badge, name, estimated dollars, a bar showing its share of the
  total, and "3 VMs · 2 databases · 2 buckets". Caption "Estimate · resets 1 Nov" (the first of next month).

### 6.2 Virtual machines (`VirtualMachines.dc.html`)

- Title, lead "*N* Linux VMs across GCP and AWS · *N* running", **Launch VM**.
- Filter chips by cloud (All · 5, GCP 3, AWS 2) and a search box (name, IP or domain). Filters are kept in the URL.
- Table: **Name** (link; image underneath), **Cloud · zone**, **Size** (machine type; vCPU · memory), **Status**
  pill, **Public IP** (or "Released" when stopped, "Assigning…" while starting), **HTTPS endpoint** (first one,
  "+N more", "Private only · Add endpoint", "Paused while stopped", "Certificate pending"), **Est. / month** ("disk
  only" when stopped), and an actions menu (Open, Start/Stop, Restart, Copy SSH command, Delete).
- Statuses: `Starting · n of 3` (warn), `Running` (ok), `Stopping` (warn), `Stopped` (off), `Failed` (err),
  `Deleting` (warn), `Missing in cloud` (err).
- VMs that run a MongoDB database belong to that database: they are not in this list or its counts (a "Show database
  VMs" chip lists them, read-only, linking to their database), and they are stopped, resized and deleted from the
  Databases screen.
- Information band: "Every VM is ready for apps. Docker and an HTTPS proxy are installed on first boot, and
  certificates for your endpoints are issued and renewed automatically."

### 6.3 Launch a Linux VM (`LaunchVM.dc.html`)

Numbered sections with a sticky **Summary** beside them (below them at phone width):

1. **Cloud and region** — cloud cards (Google Cloud with its project; Amazon Web Services with its account); region
   and zone selects, filtered by the chosen cloud.
2. **Machine** — name (lowercase letters, numbers and dashes; unique per account; validated as you type); size cards
   Small / Medium / Large with vCPU, memory, machine type and price for the chosen cloud, and Custom (any machine
   type in the zone).
3. **Image and disk** — Linux image; boot disk GB (minimum 10, SSD); **Install Docker on first boot** (on by
   default; "Adds about 40 seconds to launch").
4. **Access** — SSH key (saved keys, or paste a new public key); **Allow SSH from**: My IP only (shows the detected
   address), Anywhere (not recommended), Custom range (CIDR). "Ports 80 and 443 open automatically when you add an
   HTTPS endpoint."
5. **Public endpoint** — switch on/off; address:
   - **Use the cloud's address** (the mockup's "generated address"): on AWS the VM's public DNS name
     (`ec2-203-0-113-24.af-south-1.compute.amazonaws.com`, which follows its static Elastic IP), on GCP its static IP.
     Shown before launch as "assigned at launch". Help text: "Served over HTTP, and HTTPS with a self-signed
     certificate that browsers warn about. Add your own domain for a trusted certificate."
   - **Use my own domain** — "Add at your DNS host: `A shop2 → <static IP>`" (shown once the IP is reserved; on AWS a
     `CNAME` to the cloud address works too). Certificate: free, auto-renewing (Let's Encrypt), or upload my own;
     redirect HTTP to HTTPS.

   Traffic port in both cases.

Summary: cloud · zone, name, size, image · disk, Docker, endpoint, **Est. per month** (with its parts: "VM $28 · disk
$2 · billed by GCP to stevie-prod"), **Launch VM**, "Ready in about 2 minutes". Launching goes to the new VM's detail
page, which shows the launch progress.

### 6.4 VM detail (`VMDetail.dc.html`)

- Breadcrumb Virtual machines / *name*; title with status pill; line: cloud badge, zone · machine type · image · "up
  18 days". Buttons: **Open SSH** (copies the command and shows how to connect), **Stop**/**Start**, **Deploy an
  app** (primary).
- **Health** tiles: CPU last hour, memory used / total, disk used / total (with meters), requests in 24 h with the
  share that returned 2xx/3xx.
- **HTTPS endpoints**: address, routes to (app; container port), certificate (`Valid · Renews 14 Dec`, `Self-signed` for the cloud's address, `Pending`,
  `Failed`), DNS (`Verified`, `Waiting for DNS record`, `Not needed` for the cloud's address), Edit. **Add endpoint**.
- **Apps on this VM**: app, repository (branch · Dockerfile path), commit, status, auto-deploy, Logs, Redeploy.
- **Details**: public IP (static), private IP, SSH command (copy), SSH key, open ports, runtime (Docker version ·
  HTTPS proxy), created (date, by whom), estimated cost.
- **Latest deploy**: the most recent deploy log (timestamped lines, finished-in time).
- Danger zone (below the fold, not in the mockup): Delete VM. (Resize comes after v1.)

### 6.5 Apps (`Apps.dc.html`)

- Title, lead "*N* apps built from Dockerfiles in Git · *N* live on HTTPS", **Deploy from Git**.
- Status chips (All, Live, Building, Stopped, Failed) and search (app, repo or domain).
- Table: **App**, **Source** (owner/repo; branch · commit · auto-deploy), **Runs on** (VM link; cloud · region),
  **Endpoint** (or "Private · no endpoint"), **Status** (`Live`, `Building · step n of 9`, `Stopped with VM`,
  `Failed`, `Crashed`), **Last deploy** (when; by push or by person), action (**Redeploy**, **View log** while
  building, **Start VM** when its VM is stopped).

### 6.6 Deploy an app from Git (`DeployApp.dc.html`)

1. **Source** — Git connection banner ("GitHub connected as stevie · 24 repositories" — the personal access token's
   user; "Use another Git host" picks or adds another connection); repository URL (public needs no token; private
   uses the connection's token); branch; Dockerfile path; build
   context; a check result ("Found Dockerfile · exposes port 3000 · node:22-alpine"); **Redeploy when *branch* is
   pushed** (adds a webhook).
2. **Where it runs** — VM cards (cloud, name, apps, CPU, free memory) for running VMs with Docker; "Launch a new VM
   for this app".
3. **Run settings** — app name, container port (prefilled from the Dockerfile's EXPOSE), restart policy (Always, On
   failure, Never); environment variables: key/value rows, or rows linked to a database ("Linked to catalog ·
   secret") or bucket ("Linked to stevie-media · read and write"); **Add variable**, **Link a database** (only
   databases in the chosen VM's cloud account; linking also lets that VM connect), **Link a bucket**.
4. **Public HTTPS endpoint** — serve on HTTPS (off for workers); domain (with a DNS check note); path; health check
   path ("Traffic switches only after this returns 200").

Aside **What happens next**: Clone → Build the image on *vm* → Start the container → Check health → Go live on HTTPS.
**Deploy *name*** ("No extra cost · runs on web-01").

### 6.7 Databases (`Databases.dc.html`)

- Title, lead "*N* managed databases · 2 MySQL · 1 MongoDB · backed up daily", **Create database**.
- Cards: engine badge (MySQL purple, MongoDB green) and version, status (`Available`, `Creating · n%`, `Backing up ·
  64%`, `Restoring`, `Resizing`, `Stopped`, `Failed`), name, cloud · region · size, storage meter (used of total),
  "Used by *app*", est. per month. The selected card is outlined.
- Selected database panel: name and engine; **Restore a backup**, **Resize**; tabs:
  - **Connect** — connection string with the password masked, **Reveal** (permission-gated and audited), copy; host
    (private network), port, database, admin user, TLS (MySQL: required; MongoDB: private network only in v1);
    **Who can connect** (VM chips, **Allow another VM** — lists VMs in the same cloud account only); the line reads
    "Not reachable from the internet. Only VMs in this cloud account can connect." (replacing the mockup's
    private-tunnel sentence); an SSH-tunnel command for connecting from a laptop through an allowed VM; backups
    summary; linked apps (`orders-api` as `DATABASE_URL`).
  - MongoDB databases also show "Runs on VM *catalog-db*" (machine type, disk) and **Restart**.
  - **Backups** — list of backups (time, size, automatic/manual), **Back up now**, restore to a new database.
  - **Users** — database users (create with a generated password, delete, reset password).
  - **Metrics** — CPU, connections, storage, read/write ops over 1 h / 24 h / 7 d.

### 6.8 Create a database (`CreateDatabase.dc.html`)

1. **Engine** — MySQL (relational) or MongoDB (document); version (MySQL 8.4 LTS / 8.0; MongoDB 7.0).
2. **Cloud and name** — cloud cards say what the database runs on: for MySQL "Runs on Cloud SQL" / "Runs on RDS";
   for MongoDB "Runs on a VM we launch and look after" on either cloud. Region ("Put it in the same region as the
   VMs that use it"; on AWS only VMs in the same region can connect); name.
3. **Size and storage** — Starter / Standard / Performance with prices (for MongoDB these are VM sizes, and the card
   shows the machine type); storage GB; **Grow storage automatically** ("Adds 10 GB when 90% full"; for MongoDB the
   VM's data disk is enlarged); **High availability** ("Doubles the server cost"; MySQL only, disabled with "Coming
   later for MongoDB").
4. **Access and backups** — network access is fixed and shown as text, not a choice: "Private · only VMs in this
   cloud account can connect" (the mockup's "Public, with an IP allowlist" option is dropped); VMs that can connect
   (checkboxes, listing only VMs in the chosen cloud account); daily backup time (in the account's timezone); keep
   backups for; admin user ("We generate the password and store it as a secret"). MongoDB backups are written to a
   private backups bucket in the same account, which the summary names.

Summary with every choice, **Est. per month** with parts (MySQL: server · storage · backups; MongoDB: VM · disk ·
backup storage), **Create database**, "Ready in about 6 minutes" (MongoDB: "about 4 minutes").

### 6.9 Buckets (`Buckets.dc.html`)

- Title, lead "*N* buckets · *N* GB stored · *N* serve files publicly", **Create bucket**.
- Table: **Bucket** (name, link), **Cloud · region**, **Access** (`Public read` accent, `Private` neutral), **Size**,
  **Objects**, **Versioning** ("On · 30 days"), **Est. / month**. Selecting a row opens the browser below.
- **Object browser** (left): bucket name, folder breadcrumb (root / products / 2026), **New folder**, **Upload**;
  table of folders then files (select checkbox, name, size, type, modified); drop zone "Drop files here to upload to
  *path*".
- **Object panel** (right): file name; public URL (public buckets) with copy; size, type, uploaded (when, by whom or
  which app), cache; **Download**, **Share for 7 days**, **Delete**. **Bucket settings**: access, domain, lifecycle,
  linked apps, **Edit settings**.
- Size and object counts are refreshed periodically from the cloud (they are not live to the byte).

### 6.10 Create a bucket (`CreateBucket.dc.html`)

1. **Name and location** — name with a live availability check ("Available. Names are shared across each cloud, so
   they must be unique."); cloud (Cloud Storage / S3, with the project or account); region.
2. **How often you read it** — Standard, Infrequent, Archive, each with use and price per GB.
3. **Access** — Private or Public read; **Serve on my own domain over HTTPS** (public only; a later phase); **Give an
   app access** (read and write; "We add the bucket name and a key to the app's environment variables").
4. **Protection and clean-up** — keep old versions (switch) and for how long; delete files older than.

Summary, **Cost** "~$0.03 / GB" ("Per month, plus transfer out. Empty buckets are free."), **Create bucket**.

### 6.11 Screens with no mockup yet

- **Cloud accounts** (`/accounts`): list (cloud, name, project/account id, default region, connected state, last
  checked, resources), **Connect GCP** (service account JSON or workload identity), **Connect AWS** (role ARN with
  external id, or access keys), test connection, set default region, disconnect (only when it has no
  resources, or after confirming they stay running unmanaged). Owner only.
- **Git connections** (on the same page, Owner only): add a GitHub or GitLab **personal access token** (the scopes
  it needs are listed), show the user it belongs to, how many repositories it can see and when it expires; test;
  remove (apps that use it keep running but can't redeploy until given another).
- **App detail** (`/apps/:name`): source, runs on, endpoint, env vars (values of secrets hidden), deploy history with
  each deploy's log, Redeploy, Stop, Delete.
- **Activity** (`/activity`): the full event history, filterable by resource type and person.

These need designs before they are built (roadmap). Until then they use the shared UI kit components in the same
style as the mockups.

## 7. Who may do what

Permissions come from the host's access roles (Viewer, Contributor, Approver, Architect, Owner). Refusals are
recorded in the audit log; a hidden button is not the control, the API is.

| Action | Permission | Roles |
| --- | --- | --- |
| See everything (no secrets) | `read` | All |
| Launch/start/stop/restart a VM; add an endpoint; deploy/redeploy an app; create a database or private bucket; upload files; back up now | `draft` | Contributor and up |
| Delete a VM, database, bucket or app; restore or resize a database; make a bucket public; SSH from Anywhere; reveal a connection string; share links | `approve` | Approver and up; people only (never agents) |
| Connect, change or disconnect cloud accounts and Git connections; set budgets | `change-guardrails` | Owner |

## 8. Non-functional requirements

- **Native web, no React, no build step.** Server: Node.js (≥ 22.12) and Express. Browser: native ES modules,
  tagged-template HTML and the NooblyJS UI kit. Pages work without a bundler.
- **Accessible.** WCAG 2.2 AA: 44 px targets, visible focus, labels for every control, status conveyed in words not
  only colour, live regions for progress, keyboard-usable tables and menus. Works at phone width (the mockups'
  `@media (max-width:860px)` behaviour).
- **Fast.** List screens answer from local records in under 300 ms; cloud calls happen in operations and background
  sync, not on page load. Live progress arrives over the host's event stream (polling only when standalone).
- **Resilient.** An operation in progress survives a server restart and resumes or is reconciled with the cloud.
  A cloud being unreachable makes its resources show "Last seen …", never an error page.
- **Secure.** Cloud credentials and database passwords encrypted at rest and never sent to the browser except an
  audited reveal. Every write audited. Resources are tagged so Noobly Cloud only ever touches what it created.
- **Honest costs.** Estimates come from a dated price catalogue per cloud and region and say "Estimate".

## 9. Seed story

`npm run seed` writes a story that reproduces the mockups with the mock cloud provider, so every screen can be built
and tested offline: accounts `stevie-prod` (GCP) and `stevie-aws · 0932` (AWS); VMs `web-01`, `api-01`, `worker-01`,
`staging-01` (stopped), `docs-01` (starting); apps `storefront`, `blog`, `orders-api`, `queue-worker`, `docs`
(building), `admin` (stopped with VM); databases `orders-db` (MySQL on RDS; only `api-01` may connect,
since `web-01` is in the other cloud), `catalog` (MongoDB on its own database VM `catalog-db`, not counted among the
five VMs), `analytics` (backing up); a GitHub connection for `stevie`; buckets
`stevie-media`, `orders-exports`, `backups-db`, `static-assets`; the activity in the Overview; person Stevie (Owner).

## 10. Success measures

- A developer with a connected account goes from Overview to a running VM on HTTPS in under 5 minutes, and to a
  deployed app in under 10, without opening a cloud console.
- The estimate shown before creation is within 10% of the resource's actual first full month.
- Zero resources created by Noobly Cloud that it cannot see, and zero changes to resources it did not create.
