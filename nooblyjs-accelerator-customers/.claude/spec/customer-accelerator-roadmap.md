# Customer Accelerator — Build Roadmap

| | |
|---|---|
| **Package** | `nooblyjs-accel-customers` |
| **Status** | Draft v0.1 |
| **Date** | 2026-10-02 |
| **Companion docs** | [PRD](customer-accelerator-prd.md) · [Architecture](customer-accelerator-architecture.md) |

---

## Overview

| Phase | Theme | Outcome | Est. |
|---|---|---|---|
| **0** | Foundation & clean-up | Mountable package skeleton on core; shared repository, schema, events, RBAC, audit | 2 wks |
| **1** | Customer core (MVP) | Customers, orgs, contact points, identities, consent, lookup, timeline | 3 wks |
| **2** | Marketing MVP | Templates, campaigns, messages, send pipeline, communications sent, tracking, suppression | 3 wks |
| **3** | Contact-centre MVP | Agents, skills, queues, hours, routing, interactions, issues, resolutions | 4 wks |
| **4** | v1.0 hardening | SLA, escalations, surveys, preference centre, segments, imports, dashboards, docs | 4 wks |
| **5** | v1.x advanced | Journeys, match/merge, DSAR, A/B, macros, knowledge, CCaaS + real channel adapters | 5 wks |
| **6** | Scale & intelligence | Core query push-down, multi-node routing, AI assist, attribution, WFM/QA hooks | ongoing |

Estimates assume one to two developers. Each phase ends in a tagged release, with tests green and README/Swagger updated.

---

## Phase 0 — Foundation and clean-up (v0.1.0)

**Fix the current scaffold.** These issues were found in the repo as of `cb05aa1`:

- [ ] `app.js` calls `serviceRegistry.dataServe('memory')`, which does not exist in core (`dataService`). Startup throws.
- [ ] All three module `index.js` files default `app_path` to `'warehouse'`. Their routes default to `'delivery'` (copy-paste from accel-commerce). Views for customer, marketing and support all mount on `/applications/warehouse`.
- [ ] Each module uses its own `DataManager` (raw `fs` JSON files in `./data`), which bypasses core `dataService`. Replace it with the repository layer.
- [ ] `package.json`: `main` points at `app.js` (a server). Change it to `index.js` (library). Rename the package to `nooblyjs-accel-customers`. Add `files`, `engines`, and a `peerDependencies` entry on `nooblyjs-core`.
- [ ] Hard-coded session secret `'ecommerce-secret'` and a debug `patchEmitter` that logs every event payload, which leaks PII to the console.
- [ ] Local `src/auth` duplicates core `authservice`. Retire it and depend on the host session + core API keys.
- [ ] `activities/keepalive.js` stubs (`console.log("Alive")`). Remove them.

**Build the shared foundation:**

- [ ] `index.js` → `mount(app, eventEmitter, serviceRegistry, options)` and `shutdown()`. Move `app.js` to `examples/host-app.js`.
- [ ] `src/shared/schema`: `defineSchema()`, validation, defaults, PII masking, enum handling, OpenAPI generation.
- [ ] `src/shared/repository`: `BaseRepository` (create/get/update/softDelete/list), `IndexManager` (secondary + unique indexes on core cache), `QueryEngine` (filter/sort/paginate DSL), `Counter` (human-readable numbers).
- [ ] `src/shared/events`: `DomainEventBus` (EventEmitter + core `notifying` topics, standard envelope, correlation ids).
- [ ] `src/shared/audit`: append-only `AuditService` with redacted diffs.
- [ ] `src/shared/rbac`: roles, permissions, `requirePermission()` middleware, role resolver option.
- [ ] `src/shared/http`: list-query parser, ETag/If-Match, error mapping to core `ClientError` / `sendSafeError`.
- [ ] Jest setup, a mock/in-memory `ServiceRegistry` helper, and CI (Node 22/24, coverage gate).

**Exit criteria:** `examples/host-app.js` boots. `GET /applications/customer/api/v1/health` returns OK. BaseRepository has ≥ 90% coverage. `mount()` + `shutdown()` leaves no open handles.

---

## Phase 1 — Customer core (v0.2.0)

**PRD:** PL-1–6, PL-8, PL-10, PL-12, PL-16, CU-1–3, CU-5–8, CU-11.

- [ ] Schemas and repositories: `Customer`, `Organization`, `Address`, `Phone`, `Email`, `Identity`, `ConsentRecord`, `Note`, `AuditEntry`.
- [ ] `CustomerService`: CRUD, lifecycle/status transitions, primary contact-point management, `upsertByIdentity()`.
- [ ] `ContactPointService`: E.164 normalisation (a small embedded country-code table, or `libphonenumber-js` as an optional dependency), email normalisation, ISO country validation, one-primary-per-type rule.
- [ ] `IdentityService`: link and lookup by `(namespace, value)`, unique index.
- [ ] `ConsentService`: append-only ledger, `getConsentState(customerId)`, `canContact(customerId, purpose, channel, topic)`. Phase 2's send pipeline depends on this.
- [ ] Lookup and typeahead via a core `searching` index. `GET /customers/lookup`.
- [ ] `TimelineService` (v1: query-time merge of notes, consent, audit; later modules register timeline providers).
- [ ] REST routes and Swagger for all of the above. `expand` support.
- [ ] Seed generator: 500 customers, 50 orgs, mixed contact points and consents.
- [ ] Admin UI: customer search, customer 360 (profile, contact points, consent, timeline).

**Exit criteria:** PRD scenario 1 (commerce upsert) passes as an integration test. Swapping `providers.data` to `file` passes the same suite.

---

## Phase 2 — Marketing MVP (v0.3.0)

**PRD:** MK-1 (email, SMS), MK-2–9, MK-13, MK-7 (click/unsub/bounce).

- [ ] Schemas and repositories: `Template`, `Campaign`, `Message`, `Variant` (single variant only), `Communication`, `EngagementEvent`, `TrackingLink`, `SuppressionEntry`, `ChannelConfig`, `SubscriptionTopic`.
- [ ] `ChannelAdapter` base, plus a `console` adapter (dev) and an `smtp` adapter (`nodemailer` as an optional dependency, or a host-supplied transport).
- [ ] Safe template renderer (Mustache subset, declared variables only, locale fallback, HTML sanitisation on save).
- [ ] `SendPipeline`:
  - audience resolution (explicit ids + simple rule; full segments come in Phase 4);
  - policy checks (do-not-contact, consent, suppression, frequency cap, quiet hours → defer);
  - render → dispatch through core `queue` + `working` workers;
  - throttling;
  - idempotent per `(messageId, customerId)`.
- [ ] Scheduling of messages via core `scheduling` (at / cron / immediate). Pause and cancel.
- [ ] `sendTransactional()` in-process API + `POST /transactional`.
- [ ] Tracking: signed tokens, click redirect (no open redirect), open pixel, `List-Unsubscribe` + one-click unsubscribe endpoint → ConsentRecord + SuppressionEntry.
- [ ] Generic webhook ingestion endpoint with an adapter-specific `parseWebhook()` / `verifySignature()`.
- [ ] Customer timeline provider: communications + engagement.
- [ ] Admin UI: templates (editor + preview), campaigns/messages (create, schedule, test send), communications log per customer.

**Exit criteria:** PRD scenarios 2 and 3 pass end-to-end with the console adapter. A property-based test proves zero sends to opted-out or suppressed recipients.

---

## Phase 3 — Contact-centre MVP (v0.4.0)

**PRD:** CC-1–5, CC-7 (longest-idle, skills), CC-8–10, CC-13, CC-14, CC-22.

- [ ] Schemas and repositories: `Agent`, `AgentStateEvent`, `Team`, `Skill`, `Queue`, `HoursOfOperation`, `HolidayCalendar`, `Interaction`, `Issue`, `IssueCategory`, `IssueComment`, `Resolution`, `ResolutionCode`, `WrapUpCode`.
- [ ] `BusinessCalendar` (open/closed checks, business-minute arithmetic, holidays, time zones). Table-driven tests.
- [ ] `AgentService`: presence state machine, state history, capacity tracking.
- [ ] `InteractionService`: state machine (§7.2), metric computation, customer resolution from ANI/email via `IdentityService` / contact-point lookup.
- [ ] `RoutingEngine` with a waiting pool in core cache, event + tick triggers, `longest_idle` and `skills_weighted` strategies, offer/accept/reject/timeout, closed-hours handling.
- [ ] `IssueService`: numbering (`CS-000001`), lifecycle, assignment, linking interactions, comments (public replies dispatched through marketing `sendTransactional` with `purpose: service`).
- [ ] Resolution capture, with FCR derivation and wrap-up codes on interactions.
- [ ] Public issue-submission route (web form) with rate limiting.
- [ ] SSE stream for the agent desktop.
- [ ] Customer timeline provider: interactions + issues.
- [ ] UI: agent desktop (state, offers, 360, issue workspace, wrap-up), admin (queues, skills, agents, hours, codes).
- [ ] Fake CCaaS driver script (simulates inbound calls/chats for demos and tests).

**Exit criteria:** PRD scenario 4 passes. Routing load test: 200 agents, 20 queues, 50 interactions/s → p95 routing decision < 200 ms on memory providers.

---

## Phase 4 — v1.0 hardening (v1.0.0)

**PRD:** CC-6, CC-7 (rr, priority), CC-11, CC-12, CC-15 (basic), CC-17, CC-19; MK-7 (all), MK-10, MK-16, MK-17; CU-4, CU-9, CU-10, CU-12, CU-13; PL-7, PL-9, PL-11, PL-13–15.

- [ ] **SLA engine:** policies, timers, pause/resume, warning/breach scheduling, startup recovery, escalation rules → `Escalation` records.
- [ ] Routing profiles, `round_robin` and `priority_age` strategies, overflow queues.
- [ ] **Surveys:** CSAT/NPS/CES, triggered on resolve via a marketing channel, signed public response page, traits updated.
- [ ] **Segments:** rule DSL evaluator, static and dynamic segments, scheduled evaluation as a `working` job, enter/exit events, membership history. Plug into the marketing audience.
- [ ] **Preference centre** (hosted, token-based), subscription topics, communication preferences (quiet hours, frequency caps per customer).
- [ ] Relationships and households. Notes and attachments (core filing).
- [ ] Events ingestion API (`track` / `identify`).
- [ ] Imports and exports (CSV/JSON, dry run, error report) via `filing` + `working`.
- [ ] Optimistic concurrency + idempotency keys. Signed outbound webhooks with retry.
- [ ] Field-level PII masking by role, plus `view_pii` audit.
- [ ] Optional multi-tenancy (`tenantId` on context, enforced in BaseRepository).
- [ ] Metrics via core `measuring`, a real-time supervisor wallboard, campaign reports.
- [ ] Docs: README quick start (< 15 min), integration guide (accel-commerce example), event catalogue, Swagger complete, upgrade notes.
- [ ] Security review: input validation, CSP, signature verification, rate limits on public routes.

**Exit criteria:** all PRD §8 scenarios except 7 pass. Coverage ≥ 80%. Playwright smoke green. Published to npm as `1.0.0`. At least one internal app (accel-commerce) integrated.

---

## Phase 5 — v1.x advanced (v1.1 → v1.3)

| Release | Scope |
|---|---|
| **v1.1 Data quality and privacy** | Duplicate detection (match rules, scoring job), merge with survivorship + unmerge window, cross-module repointing on `customer.merged`; DSAR workflow (access export, erasure with cross-module redaction, hashed suppression), retention jobs. **PRD scenario 7 passes.** (CU-15–17) |
| **v1.2 Marketing orchestration** | Journeys compiled to core `workflow` with a persisted wait/resume sweep, enrolments, goals and exits; A/B variants with auto-winner; production channel adapters (SES, SendGrid, Twilio SMS/WhatsApp, FCM push); forms with double opt-in. (MK-1 full, MK-11, MK-12, MK-15) |
| **v1.3 Service productivity** | Macros (full action set), knowledge base with article suggestions on issues, callbacks / virtual hold, CCaaS adapters (Amazon Connect, Twilio Flex, Genesys Cloud) in mirror and routing modes. (CC-15, CC-16, CC-18, CC-20) |

---

## Phase 6 — Scale and intelligence (v2.x, ongoing)

- [ ] Land the core enhancements C1–C6 (Architecture §6.3) in `nooblyjs-core`. Switch the repository layer to `QueryAdapter` push-down and native indexes on mongodb/documentdb.
- [ ] Multi-node routing: queue-partition leases, shared waiting pool on Redis cache.
- [ ] Computed traits engine (LTV, RFM, engagement score) and incremental segment evaluation on events.
- [ ] Conversion attribution (first / last / linear) and revenue reporting. (MK-14)
- [ ] AI assist via core `aiservice`: issue summarisation, suggested replies, auto-categorisation and priority, sentiment on interactions, subject-line suggestions. Escalation on negative sentiment. (CC-21)
- [ ] Address verification/geocoding adapters. (CU-18)
- [ ] Quality-evaluation scorecards and WFM adherence hooks. (CC-23)
- [ ] Possible sales module (Lead/Opportunity), pending PRD open question 5.

---

## Dependencies and risks

| Risk | Impact | Mitigation |
|---|---|---|
| Core `dataService` lacks query/index/conditional-write APIs | In-memory list scans and single-node concurrency limit scale | QueryAdapter abstraction now; propose C1–C6 to core early (Phase 0) so they land by Phase 6 |
| Core `scheduling` / `workflow` state is in-memory | SLA timers and journeys lost on restart | Accelerator persists timers/enrolments and re-derives schedules on startup (Phases 3/4/5) |
| Accidental marketing sends without consent | Legal/regulatory exposure | Single enforced pipeline, property-based tests, audit of every skip/send, transactional purpose explicitly flagged |
| Routing correctness under concurrency | Double offers, lost interactions | Per-queue single owner (lease), reserve-then-offer, idempotent state transitions, load tests in Phase 3 |
| PII leakage via logs/events | Privacy breach | Remove debug emitter patch (Phase 0), redact PII in audit/event payloads, masking by default |
| Scope creep toward full CRM/CCaaS | Delays v1.0 | Non-goals in PRD §4.2; adapters over re-implementation |

## Immediate next steps

1. Review this PRD, Architecture and Roadmap, and answer the open questions in PRD §12. Multi-tenancy priority and the `support` naming matter most.
2. Raise the core enhancement proposals C1–C6 on `nooblyjs-core`.
3. Start Phase 0: fix `app.js`, re-path the modules, and introduce `mount()` + BaseRepository.
