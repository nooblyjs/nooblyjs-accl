# Customer Accelerator — Product Requirements Document

| | |
|---|---|
| **Package** | `nooblyjs-accel-customers` |
| **Status** | Draft v0.1 |
| **Date** | 2026-10-02 |
| **Companion docs** | [Architecture](customer-accelerator-architecture.md) · [Build Roadmap](customer-accelerator-roadmap.md) |

---

## 1. Summary

The Customer Accelerator is an npm module that a NooblyJS application adds to its `package.json` and mounts with one call. It gives the host application a ready-made, production-grade **customer domain**:

1. **Customer Data Management (CDM / light CDP).** Customers, organisations, addresses, phones, emails, identities, consent, preferences, segments and a unified customer timeline.
2. **Marketing Communications.** Campaigns, journeys, templates, sends, every communication sent to a customer, engagement tracking, suppression and attribution.
3. **Contact Centre / Customer Service.** Queues, agents, skills, routing, interactions, issues (cases/tickets), SLAs, escalations, resolutions and surveys.

All infrastructure (persistence, cache, search, queueing, scheduling, workflow, notifications, files, metrics, AI, auth) comes from **`nooblyjs-core`** through its `ServiceRegistry`. The accelerator owns only the domain model, business rules, REST routes, events and admin UIs.

The accelerator is not a full CRM suite and not a telephony platform. It provides the **system of record and the APIs** that the host application, other accelerators (e.g. `nooblyjs-accel-commerce`) and external channel providers plug into.

## 2. Problem statement

Every NooblyJS application that touches customers rebuilds the same objects: customer, address, phone, consent, "messages we sent", "tickets they raised". Each version is incompatible and incomplete, and none is compliant. Teams then integrate a SaaS CRM, ESP or CCaaS product and pay for features they half-use. That also fragments the customer view across systems.

We want a single, reusable, standards-aligned customer domain that:

- installs in minutes and runs on in-memory providers for development;
- moves to file, MongoDB, Redis and other providers through `nooblyjs-core` configuration alone;
- exposes a clean REST API plus an in-process JS API;
- is compliant by design (consent, suppression, DSAR, audit, PII handling).

## 3. Industry inspiration

We deliberately borrow proven concepts rather than inventing new ones.

| Domain | Leader | What we take |
|---|---|---|
| Customer | **Salesforce** (Account/Contact, Person Accounts, Account-Contact Relations) | Party model: individuals *and* organisations, many-to-many relationships with roles |
| Customer | **Microsoft Dynamics 365 Customer Insights**, **Segment (Twilio)**, **Adobe Real-Time CDP** | Identity resolution across namespaces, unified profile, computed traits, event-sourced timeline |
| Customer | **HubSpot** | Lifecycle stages, owner assignment, simple custom properties, friendly UI |
| Customer | **Informatica / Reltio MDM** | Match rules, duplicate candidates, merge with survivorship rules, merge history |
| Customer | **OneTrust**, GDPR / POPIA / CCPA | Purpose- and channel-level consent ledger with evidence; data subject requests |
| Marketing | **Salesforce Marketing Cloud**, **Adobe Marketo** | Campaign → Message → Send → Recipient-level Communication; programs; attribution |
| Marketing | **Braze**, **Iterable**, **Klaviyo** | Event-triggered journeys (canvas/flows), frequency capping, quiet hours, A/B variants, per-message engagement events |
| Marketing | **HubSpot**, **Mailchimp** | Subscription topics, preference centre, double opt-in, suppression lists |
| Contact centre | **Amazon Connect** | Queues, routing profiles (queue + channel concurrency), hours of operation, contact records, contact attributes |
| Contact centre | **Genesys Cloud**, **NICE CXone**, **Five9** | Skills-based routing with proficiency, agent presence/states, wrap-up codes, interaction metrics (ASA, AHT, abandon rate, service level) |
| Contact centre | **Zendesk**, **Salesforce Service Cloud**, **ServiceNow CSM** | Ticket/case lifecycle, SLA policies with business hours, macros, internal vs public comments, escalations, knowledge base, CSAT |

## 4. Goals and non-goals

### 4.1 Goals

- **G1. Drop-in.** `npm i nooblyjs-accel-customers` plus one `mount()` call gives working APIs and admin UIs.
- **G2. Complete core object model** for customer, marketing and contact centre (section 7).
- **G3. Infrastructure-agnostic.** Zero direct database, queue or SMTP code. Everything goes through `nooblyjs-core` services, so provider swaps are configuration-only.
- **G4. Composable.** Each of the three modules can be enabled on its own. Marketing and Support depend on Customer.
- **G5. Event-driven.** Every state change emits a documented domain event, so hosts and other accelerators can react.
- **G6. Compliant by default.** Consent and suppression are enforced at send time. PII is masked by role. DSAR export and erasure are supported. Every change is audited.
- **G7. Extensible.** Custom attributes, pluggable channel adapters, a routing strategy plug-in and hooks around persistence.

### 4.2 Non-goals (v1)

- Being a PBX, SIP stack, softphone or chat widget. Telephony and chat transports are integrated via adapters and webhooks (Amazon Connect, Twilio, Genesys).
- Being an email/SMS gateway. Delivery goes through channel adapters (SMTP, SES, SendGrid, Twilio). A console/log adapter ships for development.
- A drag-and-drop email designer or visual journey canvas. v1 offers JSON/HTML templates and JSON journey definitions with a simple viewer.
- Sales pipeline (opportunities, quotes, forecasting). This may come later as a separate module.
- Workforce management (forecasting, shift scheduling), quality management and speech analytics beyond basic hooks.
- A billion-profile real-time CDP. The target scale is in section 9.

## 5. Personas

| Persona | Needs |
|---|---|
| **Application developer** (primary) | Mount the module, call the JS/REST APIs, subscribe to events, extend the schema, swap providers |
| **Data steward / admin** | Configure custom attributes, review duplicates and merges, run imports, handle DSARs, view the audit log |
| **Marketer** | Build segments, templates and campaigns; schedule sends; run journeys; read engagement reports |
| **Contact-centre agent** | See the customer 360 on an incoming interaction, work assigned issues, apply macros, wrap up and resolve |
| **Contact-centre supervisor** | Manage queues, skills and agents; view real-time queue and agent dashboards; reassign and escalate |
| **Customer (indirect)** | Manage preferences and unsubscribe via the hosted preference centre; submit a support request |

## 6. Functional requirements

Priority: **P0** = MVP must-have, **P1** = v1.0, **P2** = v1.x, **P3** = later.

### 6.1 Platform and integration

| ID | Requirement | Pri |
|---|---|---|
| PL-1 | Single entry point `mount(app, eventEmitter, serviceRegistry, options)` returns an in-process API (`{ customer, marketing, support, events }`) | P0 |
| PL-2 | Modules individually enabled via `options.modules` | P0 |
| PL-3 | Configurable base paths for API and UI | P0 |
| PL-4 | All persistence via core `dataService`, using the provider the host configures (`memory`, `file`, `mongodb`, `documentdb`, `simpledb`, `api`) | P0 |
| PL-5 | Versioned REST API (`/v1`) with OpenAPI/Swagger docs, matching core's swagger convention | P0 |
| PL-6 | Standard list semantics: pagination, field filters, sort, `expand`, sparse fields | P0 |
| PL-7 | Optimistic concurrency (`version` / `If-Match`) and `Idempotency-Key` on create | P1 |
| PL-8 | Domain events on the shared EventEmitter and mirrored to core `notifying` topics | P0 |
| PL-9 | Outbound webhooks (signed) for selected events | P1 |
| PL-10 | RBAC roles: `admin`, `data-steward`, `marketer`, `agent`, `supervisor`, `readonly`, `service` (API key). Integrates with core auth/session and API keys | P0 |
| PL-11 | Field-level PII masking by role (e.g. agents see `***@gmail.com` unless the customer is verified on the interaction) | P1 |
| PL-12 | Audit log for every create, update, delete, merge and export (who, when, before/after diff) | P0 |
| PL-13 | Optional multi-tenancy: `tenantId` on every record, resolved from request context | P1 |
| PL-14 | Custom attribute definitions per entity (type, validation, PII flag, searchable flag) | P1 |
| PL-15 | Bulk import (CSV/JSON via core `filing`, processed by core `working`) with a dry-run and error report; bulk export | P1 |
| PL-16 | Seed/demo data generator | P0 |

### 6.2 Customer data management

| ID | Requirement | Pri |
|---|---|---|
| CU-1 | CRUD for **Customer** (individual) and **Organization** (business) | P0 |
| CU-2 | Multiple **Addresses**, **Phones** and **Emails** per party, each typed, one primary per type, with validity dates | P0 |
| CU-3 | Phone normalised to E.164. Email normalised to lowercase. Address country ISO 3166-1 alpha-2 | P0 |
| CU-4 | **Relationships** between parties (employee-of, household member, parent/child account) with role and primary flag | P1 |
| CU-5 | **Identities**: external identifiers per namespace (e.g. `commerce.customerId`, `loyalty`, `device`, `cookie`) with lookup by any identifier | P0 |
| CU-6 | **Lifecycle stage** (subscriber → lead → MQL → SQL → customer → advocate → churned) and **status** (active, inactive, blocked, merged, erased) | P0 |
| CU-7 | Fast lookup and typeahead by name, email, phone, identifier and customer number (core `searching`) | P0 |
| CU-8 | **Consent ledger**, append-only, per purpose × channel: status, lawful basis, source, evidence, expiry. Current state is derived | P0 |
| CU-9 | **Communication preferences**: preferred channel and language, quiet hours, frequency cap and topic subscriptions | P1 |
| CU-10 | **Notes** and **attachments** (core `filing`) on customer | P1 |
| CU-11 | **Customer 360 timeline** aggregating communications, engagement, interactions, issues, notes, consent changes and external events | P0 |
| CU-12 | External **events ingestion** (`POST /events`, Segment-style `track`/`identify`) to feed timeline and computed traits | P1 |
| CU-13 | **Segments**: static lists and dynamic rule-based segments (JSON rule DSL over attributes, traits and events), with scheduled re-evaluation and membership history | P1 |
| CU-14 | **Computed traits / metrics**: e.g. lifetime value, last-contacted date, open-issue count, CSAT average, RFM score | P2 |
| CU-15 | **Duplicate detection** with configurable match rules (exact email, normalised phone, fuzzy name + postcode). Creates duplicate candidates for review | P1 |
| CU-16 | **Merge** with survivorship rules (most recent, most complete, source priority). Repoints children. Keeps a `mergedInto` tombstone. Unmerge within a window | P1 |
| CU-17 | **Data subject requests**: access/export (JSON), rectification, erasure (anonymise PII but keep aggregate history), restriction; tracked with due dates | P1 |
| CU-18 | Address verification / geocoding via a pluggable adapter (core `fetching`) | P3 |

### 6.3 Marketing communications

| ID | Requirement | Pri |
|---|---|---|
| MK-1 | **Channels**: email, SMS, push, WhatsApp, in-app, direct mail (record only). Each is backed by a **channel adapter** | P0 (email, SMS) / P2 (others) |
| MK-2 | **Templates** per channel with variables (`{{customer.givenName}}`), locale variants, versioning and approval status | P0 |
| MK-3 | **Campaigns**: objective, type (one-off, recurring, triggered, A/B), status lifecycle, owner, budget, dates, UTM defaults | P0 |
| MK-4 | **Messages (send definitions)**: campaign + template + audience (segment/list/query) + schedule + throttle + send window + variants | P0 |
| MK-5 | **Send pipeline** for every recipient: consent check → suppression check → frequency cap → quiet hours → render → dispatch via adapter → record the Communication. A skip is recorded with its reason | P0 |
| MK-6 | **Communications sent**: one immutable record per recipient per message. Holds the rendered snapshot and the status lifecycle (queued → sent → delivered / bounced / failed / suppressed) | P0 |
| MK-7 | **Engagement events**: open, click, unsubscribe, complaint, bounce (hard/soft), reply, conversion. Captured via tracking pixel, click redirect and provider webhooks | P0 (click/unsub/bounce) / P1 (others) |
| MK-8 | **Transactional sends** API (e.g. order confirmation from commerce) that respects suppression but not marketing consent | P0 |
| MK-9 | **Suppression lists**: global, per channel and per topic. Automatic on hard bounce, complaint or unsubscribe | P0 |
| MK-10 | **Subscription topics** and a hosted **preference centre / one-click unsubscribe** (RFC 8058 `List-Unsubscribe`) | P1 |
| MK-11 | **A/B and multivariate** variants with split %, a winner metric and auto-promotion after a test window | P2 |
| MK-12 | **Journeys**: JSON-defined multi-step flows (entry trigger: segment entry, event or date attribute; steps: send, wait, branch on attribute/engagement, update attribute, exit). Executed on core `workflow` and `scheduling`. Holds enrolments and exit criteria | P1 |
| MK-13 | **Tracking links** with UTM append and open-redirect protection (only registered destinations) | P0 |
| MK-14 | **Conversion attribution**: first-touch, last-touch and linear across communications within a lookback window | P2 |
| MK-15 | **Forms** for lead capture with double opt-in | P2 |
| MK-16 | Campaign and message **reporting**: sent, delivered, open rate, CTR, unsub, bounce, conversions and revenue (core `measuring`) | P1 |
| MK-17 | Seed lists and test sends to internal addresses before launch | P1 |

### 6.4 Contact centre / customer service

| ID | Requirement | Pri |
|---|---|---|
| CC-1 | **Agents** linked to auth users: team, supervisor, languages, skills with proficiency (1–5), channel capacity (e.g. voice 1, chat 3, email 5) | P0 |
| CC-2 | **Agent presence/state** (available, busy, after-call work, break, training, offline) with reason codes and a state history | P0 |
| CC-3 | **Skills** and **teams** | P0 |
| CC-4 | **Queues**: channels, required skills, routing strategy, priority, SLA target (e.g. 80% answered in 20s), max wait, overflow queue, hours of operation | P0 |
| CC-5 | **Hours of operation** and **holiday calendars**. Business-hours maths for SLAs | P0 |
| CC-6 | **Routing profiles** (Amazon Connect style): which queues an agent serves, with priority and delay | P1 |
| CC-7 | **Routing engine**: longest-idle-agent, skills-based (proficiency-weighted), round-robin and priority + age. Supports offer/accept/reject/timeout and re-queue | P0 (longest-idle, skills) / P1 (others) |
| CC-8 | **Interactions** (contacts/conversations): channel (voice, chat, email, SMS, social, web), direction, state machine (queued → offered → connected ↔ hold → wrap-up → ended / abandoned), timestamps, transfers, conference participants, recording/transcript refs, disposition | P0 |
| CC-9 | **Issues** (cases/tickets) with human-readable numbers (`CS-000123`), category taxonomy, priority, status lifecycle (new → open → pending-customer / on-hold → escalated → resolved → closed; reopen), assignee/queue, linked interactions and communications | P0 |
| CC-10 | **Issue comments**: public replies (sent to the customer via the marketing transactional pipeline) and internal notes; attachments | P0 |
| CC-11 | **SLA policies**: targets for first response, next response and resolution by priority; business-hours aware; pause on pending-customer; warning and breach events | P1 |
| CC-12 | **Escalations**: manual or SLA-triggered, functional (team) or hierarchical (supervisor), with a history | P1 |
| CC-13 | **Resolutions**: resolution code, root-cause category, summary, linked knowledge articles, first-contact-resolution flag, customer confirmation | P0 |
| CC-14 | **Wrap-up / disposition codes** on interactions | P0 |
| CC-15 | **Macros / canned responses** that set fields and insert a reply | P1 |
| CC-16 | **Knowledge articles** (draft/published, tags, linked issues, helpfulness) | P2 |
| CC-17 | **Surveys**: CSAT, NPS and CES, sent after resolution through marketing channels; responses linked to issue, agent and customer | P1 |
| CC-18 | **Callbacks**: scheduled/virtual-hold callback requests that re-enter the queue at their position | P2 |
| CC-19 | **Real-time dashboards**: queue depth, longest wait, agents by state, service level, abandon rate. **Historical**: ASA, AHT, FCR, CSAT and SLA compliance (core `measuring`) | P1 |
| CC-20 | **CCaaS adapters / webhooks** to ingest contact events from Amazon Connect, Twilio Flex or Genesys Cloud, and to push routing decisions | P2 |
| CC-21 | **AI assist** (core `aiservice`, optional): issue summary, suggested reply, sentiment, auto-categorisation | P2 |
| CC-22 | Customer-facing **issue submission** route (web form / email-to-case adapter) | P1 |
| CC-23 | **Quality evaluations** (scorecards) and **WFM** schedule adherence | P3 |

## 7. Domain object catalogue

Full field-level definitions are in the [Architecture document §5](customer-accelerator-architecture.md#5-domain-model). Every object carries the **standard envelope**: `id`, `tenantId`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `version`, `deletedAt`, `customFields`, `tags`.

### Customer
`Customer` · `Organization` · `Relationship` · `Household` · `Address` · `Phone` · `Email` · `SocialProfile` · `Identity` · `ConsentRecord` · `CommunicationPreference` · `SubscriptionTopic` · `Note` · `Attachment` · `CustomerEvent` · `Segment` · `SegmentMembership` · `ComputedTrait` · `DuplicateCandidate` · `MergeRecord` · `DataSubjectRequest` · `AttributeDefinition` · `AuditEntry`

### Marketing
`Campaign` · `Message` · `Variant` · `Template` · `ContentAsset` · `Journey` · `JourneyEnrollment` · `Communication` · `EngagementEvent` · `TrackingLink` · `SuppressionEntry` · `ChannelConfig` · `Conversion` · `Form` · `FormSubmission`

### Contact centre
`Agent` · `AgentStateEvent` · `Team` · `Skill` · `Queue` · `RoutingProfile` · `HoursOfOperation` · `HolidayCalendar` · `Interaction` · `InteractionParticipant` · `Issue` · `IssueComment` · `IssueCategory` · `Resolution` · `ResolutionCode` · `WrapUpCode` · `SlaPolicy` · `SlaTimer` · `Escalation` · `Macro` · `KnowledgeArticle` · `Survey` · `SurveyResponse` · `CallbackRequest`

## 8. Key user journeys (acceptance scenarios)

1. **Commerce checkout creates a customer.** The commerce accelerator calls `customer.upsertByIdentity({ namespace: 'commerce', value: '123' }, profile)`. The customer is created or matched by email, the identity is attached, `customer.created` fires, and an order-confirmation transactional email is sent and appears on the timeline.
2. **Marketer sends a newsletter.** Build segment "Opted-in, ZA, active 90 days" → create campaign and message with template → test send → schedule. At send time the 5% of members without email consent are recorded as `suppressed: no_consent`. The report shows delivered/open/click within minutes of webhook events.
3. **Unsubscribe.** A customer clicks one-click unsubscribe. A consent record (`opt_out`, evidence: IP and link token) and a suppression entry are written, and the next send skips them.
4. **Inbound call.** A CCaaS webhook creates an Interaction with ANI `+27…`. The phone is resolved to the customer, and routing selects the queue `Billing-EN` and offers to the longest-idle billing agent with proficiency ≥ 3. The agent sees the 360, opens an Issue, wraps up with code `BILLING_QUERY`, and the interaction metrics are recorded.
5. **SLA breach.** A P2 issue has a 4 business-hour first-response target. At 75% a warning event and notification fire. At 100% the issue escalates to the supervisor and `issue.sla.breached` is emitted.
6. **Resolution and CSAT.** The agent resolves with code `REFUND_ISSUED` and root cause `DELIVERY_DELAY`. A CSAT survey goes out via the email channel. The response links back to issue, agent and customer and updates the customer's CSAT trait.
7. **Right to be forgotten.** A data steward logs an erasure DSAR. PII on customer, contact points, communications (rendered bodies) and interactions (transcripts) is anonymised. Aggregate counts are retained, the identity is added to a hashed suppression list to prevent re-mailing, and an audit entry is written.

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| **Scale (v1 target)** | 1M customers, 10M communications per month, 500 concurrent agents, 50 queues per tenant, on the MongoDB provider. In-memory/file providers are for dev and small installs (≤ 50k customers) |
| **Performance** | p95 < 150 ms for get-by-id and lookup; < 400 ms for filtered lists (page 50); routing decision < 200 ms; send pipeline ≥ 50 msgs/s per worker |
| **Availability** | Stateless HTTP layer. All state in core providers, so horizontal scaling is possible with Redis/Mongo providers. Routing engine leader-elected or partitioned per queue |
| **Security** | Uses core API keys, session auth and CSP. RBAC on every route. Input validated via core `validate`. Errors via core `sendSafeError` (no stack/message leaks). Webhook signatures (HMAC-SHA256). Click redirect allow-list |
| **Privacy** | PII fields tagged in schema. Masking by role. Erasure workflow. Consent evidence retained. Configurable retention per object (e.g. transcripts 13 months) |
| **Compliance** | GDPR, POPIA, CCPA/CPRA (DSAR, consent); CAN-SPAM / PECR / CASL (unsubscribe, sender identity); TCPA (SMS/voice consent, quiet hours); RFC 8058 one-click unsubscribe; Gmail/Yahoo bulk-sender rules |
| **Observability** | Structured logs via core logger. Metrics via core `measuring`. Every event has a `correlationId` |
| **Quality** | Jest unit tests ≥ 80% line coverage on domain services. Contract tests for REST. Playwright smoke for admin UIs |
| **Compatibility** | Node ≥ 18, CommonJS, `nooblyjs-core` ≥ 1.0.10, Express 4/5 |

## 10. Success metrics

- A new app is mounted, seeded and serving `/customers` in **< 15 minutes** following the README.
- **≥ 2** internal NooblyJS apps (e.g. commerce, blog/CMS) adopt the accelerator within two releases of v1.0.
- **0** marketing sends to customers without valid consent or on suppression (verified by test suite and audit).
- Provider swap memory → MongoDB with **no code change** beyond `options`.
- Domain-service test coverage ≥ 80%.

## 11. Assumptions and dependencies

- `nooblyjs-core` services are used through the public `ServiceRegistry` factories (`dataService`, `cache`, `searching`, `queue`, `scheduling`, `workflow`, `notifying`, `filing`, `measuring`, `working`, `aiservice`, `fetching`, `authservice`).
- Core `dataService` is a key/value document store with substring `find` only. Field queries, sorting and indexing are therefore implemented in the accelerator's repository layer for v1. A core enhancement for query push-down is proposed in the Architecture doc (§6.3).
- Real message delivery and telephony require third-party accounts, which are configured by the host app.

## 12. Open questions

1. Should `support` be renamed `contactcentre` / `service` for clarity? (The folder is currently `src/support`.)
2. Is multi-tenancy needed for the first adopters (P0 vs P1)?
3. Should local `src/auth` be retired in favour of core `authservice`? (Recommended: yes.)
4. Preferred first real channel adapters: SES + Twilio, or SendGrid + Twilio?
5. Do we need a sales module (Lead/Opportunity) on the roadmap, or does lifecycle stage suffice?
