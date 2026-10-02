# nooblyjs-accel-customers

A NooblyJS accelerator for customer applications: customer data management (CDP-style profiles,
contact points, identities, consent), marketing communications, and contact-centre customer service.

It is a **library**. The host application owns the Express app, the shared `EventEmitter` and the
`nooblyjs-core` `ServiceRegistry`, and mounts the accelerator. All persistence, caching, search and
notifications go through core services, so provider choice (memory, file, MongoDB, Redis, …) is the
host's configuration.

> Status: **v0.3.0 — Phase 2 (marketing MVP)**. The customer and marketing modules are complete,
> each with a REST API and admin UI. The contact centre (Phase 3) currently mounts a status page
> only. See `.claude/spec/customer-accelerator-roadmap.md`.

## Quick start

```js
const express = require('express');
const { EventEmitter } = require('events');
const serviceRegistry = require('nooblyjs-core');
const customers = require('nooblyjs-accel-customers');

const app = express();
const eventEmitter = new EventEmitter();
serviceRegistry.initialize(app, eventEmitter, { /* core security options */ });

const cx = await customers.mount(app, eventEmitter, serviceRegistry, {
  modules: ['customer', 'marketing', 'support'],   // marketing and support require customer
  basePath: '/applications',                       // → /applications/customer/api/v1/...
  containerPrefix: 'cx',                           // dataService containers: cx_customers, cx_audit, ...
  providers: { data: { type: 'memory' }, cache: { type: 'memory' } },
  auth: { roleResolver: (req) => req.user?.roles ?? [] }
});

cx.events.on('customer.created', (event) => { /* ... */ });
// on exit
await cx.shutdown();
```

Run the test app in `test/app/index.js` to browse the admin UI with seeded demo data (no
authentication; every request gets the `admin` role, override with `CX_DEMO_ROLES`; `CX_SEED=0`
starts empty):

```bash
npm start            # http://localhost:3003/applications/customer/
npm test             # Jest
npm run coverage     # Jest with the coverage gate used in CI
```

`nooblyjs-core` is a peer dependency. In development it is linked from the sibling directory
`../nooblyjs-core/`.

## Mount options

| Option | Default | Notes |
|---|---|---|
| `modules` | all three | `customer`, `marketing`, `support` |
| `basePath` | `/applications` | APIs at `{basePath}/{module}/api/v1`, UIs at `{basePath}/{module}/` |
| `containerPrefix` | `cx` | Namespace for dataService containers and cache keys |
| `providers` | memory (console logger) | `{ data, cache, search, notifying, logging }`, each `{ type, options }` |
| `auth.roleResolver` | session user roles, `service` for core API keys | `(req) => string[]` |
| `auth.roles` | see below | Override or add role → permission lists |
| `tenancy` | `{ enabled: false }` | `{ enabled: true, resolve: (req) => tenantId }` (default: `X-Tenant-Id` header) |
| `ui` | `true` | Serve the module UIs |
| `bodyLimit` | `1mb` | JSON body limit on module APIs |
| `cacheDocuments` | `false` | Read-through document cache in repositories |

## Customer module

Admin UI at `{basePath}/customer/`: customer search and list, customer 360 (profile, contact points,
identities, consent, notes, timeline, audit), and organizations.

All module UIs are plain JavaScript on Bootstrap 5.3 and Bootstrap Icons. Shared assets are served at
`{basePath}/_cx/` from `src/shared/views/`: `css/styles.css` is a verbatim copy of the NooblyJS theme
(`nooblyjs/styling/styles.css`; re-copy it to update), `css/accelerator.css` holds the shared layout and
components, and `js/api.js` / `js/ui.js` the shared client helpers. Each module keeps its own local
rules (`customer.css`, `marketing.css`).

REST API at `{basePath}/customer/api/v1` (OpenAPI at `…/openapi.json`):

| Resource | Notes |
|---|---|
| `customers` | CRUD; `POST /customers` accepts nested `emails`, `phones`, `addresses`, `identities`, `consents` (and `email` / `phone` shorthands) |
| `customers/{id}:status` | `active` ↔ `inactive` ↔ `blocked` |
| `customers:upsert` | `{ identity: { namespace, value }, profile }`: match by identity, then email, else create |
| `customers/lookup` | `?email=`, `?phone=`, `?identity=ns:value`, `?number=`, or typeahead `?q=` |
| `customers/{id}/addresses`, `/phones`, `/emails` | One primary per kind (`isPrimary: true` promotes); phones stored as E.164 |
| `customers/{id}/identities` | Unique per tenant on `(namespace, value)` |
| `customers/{id}/consents` | Append-only ledger; `/state` current state; `/check?purpose=&channel=&topicId=` |
| `customers/{id}/notes`, `/timeline`, `/audit` | Timeline merges notes, consent and audit; other modules add providers |
| `organizations` | CRUD, the same contact-point and note sub-resources, `?expand=members` |
| `audit`, `reference` | Audit log (`audit:read`); enumerations and countries for forms |

In-process API (`cx.customer`): `create`, `get`, `update`, `list`, `remove`, `setStatus`, `lookup`,
`typeahead`, `upsertByIdentity`, `recordConsent`, `getConsentState`, `canContact`, `timeline`,
`registerTimelineProvider`. Calls without a context run as the system.

Options: `customer: { defaultCountry: 'ZA' }` lets phones be entered in national format.
`seed: true` (or `{ customers, organizations }`) loads deterministic demo data into an empty store.

## Marketing module

Admin UI at `{basePath}/marketing/`: campaigns, messages (audience rule builder with live count,
schedule, test send, pause/resume/cancel, delivery and engagement stats), templates (editor with
locales, declared variables, approval and live preview), communications sent, suppressions and topics.

Send pipeline, for every recipient: consent (via the customer module) → suppression → frequency cap →
quiet hours → throttle → render (safe Mustache subset, declared variables only, sanitised HTML) →
tracked links, open pixel and RFC 8058 one-click unsubscribe → channel adapter. Every skip is recorded
on the communication with its reason. Transactional sends ignore marketing consent but honour bounces,
complaints and legal suppressions.

| Resource | Notes |
|---|---|
| `templates`, `templates/{id}:approve`, `:retire`, `:preview` | Content edits bump `revision` and return the template to draft |
| `campaigns`, `campaigns/{id}:status` | draft → running ↔ paused → completed → archived |
| `messages`, `messages/{id}:schedule`, `:pause`, `:resume`, `:cancel`, `:test-send`, `/stats` | Schedule `immediate`, `at` or `recurring` (cron) |
| `messages:preview-audience` | Count and sample an audience |
| `communications`, `communications/{id}/events` | The "communications sent" log |
| `transactional` | `{ template, customerId \| to, data, purpose, idempotencyKey }` |
| `suppressions`, `topics`, `channels`, `reference` | |

Public routes (no session; signed tokens or webhook signatures) at `{basePath}/marketing/p`:
`/o/{token}.gif` (open), `/c/{token}` (click redirect to a registered URL only), `/u/{token}`
(unsubscribe page and one-click POST), `/webhooks/{adapter}?tenant=` (delivery, bounce, complaint).

```js
const customers = require('nooblyjs-accel-customers');
await customers.mount(app, eventEmitter, serviceRegistry, {
  marketing: {
    channels: { email: customers.adapters.smtp({ transport: nodemailer.createTransport(smtpUrl) }) },
    tracking: { baseUrl: 'https://shop.example.com', signingSecret: process.env.CX_TRACKING_SECRET },
    defaults: {
      from: { email: { address: 'news@example.com', name: 'Acme' } },
      frequencyCap: { count: 3, perDays: 7 },
      quietHours: { start: '21:00', end: '08:00' }
    }
  }
});
await cx.marketing.sendTransactional({ template: 'order-confirmation', customerId, data: { order } });
```

Without `tracking.signingSecret` a random secret is used and tracking links stop working after a
restart; without `tracking.baseUrl` links are relative. Both are logged as warnings. Custom adapters
extend `customers.ChannelAdapter` (`send`, `verifySignature`, `parseWebhook`).

**File data provider:** set `marketing: { dispatch: { concurrency: 1 } }`. The core file provider
rewrites container files in place and does not coordinate reads with writes, so parallel sends can
read a half-written file. Memory, MongoDB and DocumentDB providers are unaffected.

## Every module API

- `GET {apiBase}/health` → `{ status, module, version, checks }` (503 when a dependency check fails)
- `GET {apiBase}/openapi.json`
- Errors: `{ error: { code, message, details[] } }`. Server faults never expose internal messages.
- Lists (from Phase 1): `filter[field]=v`, `filter[field][op]=v` (`eq ne in nin gt gte lt lte contains prefix exists`),
  `sort=-createdAt,name`, `limit`, `offset`, `fields`, `expand`, `q`. Responses are
  `{ items, total, limit, offset, nextCursor }`. Documents carry `ETag: W/"{version}"`; send `If-Match` to update safely.
- Every request gets an `X-Correlation-Id` (echoed from the request when valid).

## Roles

`admin` (everything), `data-steward`, `marketer`, `agent`, `supervisor`, `readonly`, `service`
(core API keys). Fields flagged as PII are masked (`a***@example.com`) for roles without `pii:read`.

## Building blocks

The shared layer is exported for module code and host extensions:

- `schema.defineSchema()`: declarative entities, validation, PII masking, OpenAPI.
- `repository.BaseRepository`: create / get / update (merge patch, optimistic concurrency) / softDelete /
  hardDelete / list / findOne / findByIndex / searchText on core `dataService`, with unique and secondary
  indexes in core `cache`, an audit entry and a domain event per write.
- `DomainEventBus`: `cx.*` events on the shared emitter, mirrored to the core `notifying` topic `cx.{module}`.
- `AuditService`: append-only audit log with PII values redacted.
- `rbac`, `http`, `context`, `errors`.

## Licence

See `LICENSE`.
