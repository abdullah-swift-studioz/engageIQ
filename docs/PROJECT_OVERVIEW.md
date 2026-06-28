# EngageIQ — Complete Technical Overview

> **Purpose of this document:** a single, self-contained technical briefing for an
> assistant (or engineer) who has never seen this codebase and has no access to it.
> Everything needed to understand and direct work is here. Where something is
> uncertain, stubbed, not implemented, or contradictory, it is flagged explicitly
> rather than guessed.
>
> **Generated:** 2026-06-28 · **Branch:** `main` · **HEAD:** `16cbd67`
> **Method:** read directly from source, schema, config, migrations, and docs. No
> behavior was changed; this is a read-and-document artifact only.

---

## 1. Project Summary

**What it is.** EngageIQ is a full-stack, multi-tenant SaaS customer-engagement
platform for Shopify merchants — positioned as the Klaviyo / CleverTap equivalent
built specifically for South Asian and MENA e-commerce. Its differentiators are
WhatsApp-first messaging, Cash-on-Delivery (COD) native features (fake-order
scoring, COD verification flows), Urdu / RTL support, multi-store unified customer
profiles for agencies/operators, and PKR-denominated pricing. Built by Swift
Studioz (Lahore, Pakistan); owner Abdullah Ali. The codebase is a pnpm +
Turborepo monorepo with a Fastify API, a Remix dashboard, Prisma/PostgreSQL for
relational data, ClickHouse for event analytics, and Redis + BullMQ for queues.

**Honest completion assessment: roughly 25–30% of the product built.**
- By the project's own count, **10 of 38 roadmap milestones** are recorded
  complete (Phases 1–3 fully, plus two milestones the team labels "Phase 4"). That
  is ~26% by milestone count.
- The completed work is the **data spine**: scaffold, auth/RBAC/multi-tenancy,
  Postgres schema, ClickHouse event store, Shopify OAuth + webhook ingestion +
  backfill, storefront tracking SDK, unified customer profiles, identity
  resolution, custom-event API, segment builder/evaluator, and a journey
  entry/exit executor.
- **Almost nothing customer-facing actually sends or analyzes yet.** All outbound
  channels (WhatsApp/SMS/Email/Push) are a single stub function. All ML/AI scores
  (RFM, churn, LTV, fake-order) are nullable DB columns with **no engine writing
  them**. There is no analytics dashboard, no campaign engine, no courier
  integration, no Python ML service. The Remix dashboard covers only customers,
  segments, and journeys.
- **Nothing is deployed.** No CI, no production infra, and per the project's own
  notes the Prisma migrations may not have been applied even to a local DB yet.

So: a solid, well-structured foundation with the hard plumbing done, but the
revenue-generating feature surface (campaigns, channels, analytics, AI) is mostly
ahead of the team, not behind it.

---

## 2. How to Run It

### 2.1 Runtime prerequisites

| Dependency | How it's expected to run locally | Notes |
|---|---|---|
| **Node.js** | Local install | Not pinned in an `.nvmrc`/`engines` field; TS targets ES2022 and `@types/node@^20`, so **Node 20.x** is the safe assumption. |
| **pnpm** | Local install | Pinned: `packageManager: pnpm@9.1.0`. Monorepo uses pnpm workspaces. |
| **PostgreSQL 16** | Docker (`docker compose up -d`) | Service `postgres`, port **5432**, db/user/pass all `engageiq`. |
| **ClickHouse 24.3** | Docker | Service `clickhouse`, ports **8123** (HTTP) / **9000** (native), db `engageiq`, user `default`, empty password. |
| **Redis 7** | Docker | Service `redis`, port **6379**. Backs BullMQ + OAuth state + caches. |
| **Python / FastAPI ML service** | **Does not exist yet** | Roadmapped for Phases 5/7. No `.py` files in the repo. |

Docker services are defined in `docker-compose.yml` (all three have healthchecks).

### 2.2 Exact commands

Root `package.json` (Turborepo orchestration):

```bash
pnpm install            # install all workspace deps
pnpm dev                # turbo run dev      → runs dev across packages (API + web)
pnpm build              # turbo run build    → builds all packages (respects build graph)
pnpm lint               # turbo run lint     → eslint across packages
pnpm type-check         # turbo run type-check → tsc --noEmit across packages
pnpm format             # prettier --write across the repo
```

> Note: `pnpm dev` via Turbo starts the long-running `dev` tasks for every package
> that defines one. The API dev server and the worker are **separate processes**
> (see below) — `turbo run dev` does **not** start the worker.

**API** (`apps/api`, package `@engageiq/api`):

```bash
pnpm --filter @engageiq/api dev          # tsx watch src/index.ts   (HTTP server, hot reload)
pnpm --filter @engageiq/api worker:dev   # tsx watch src/worker.ts  (BullMQ workers, hot reload)
pnpm --filter @engageiq/api worker       # tsx src/worker.ts        (workers, no watch)
pnpm --filter @engageiq/api build        # tsc → dist/
pnpm --filter @engageiq/api start        # node dist/index.js       (prod server)
pnpm --filter @engageiq/api start:worker # node dist/worker.js      (prod worker)
pnpm --filter @engageiq/api test         # vitest run
pnpm --filter @engageiq/api type-check   # tsc --noEmit
pnpm --filter @engageiq/api lint         # eslint src
```

**Web** (`apps/web`, package `@engageiq/web`):

```bash
pnpm --filter @engageiq/web dev          # remix vite:dev   (port 3000)
pnpm --filter @engageiq/web build        # remix vite:build
pnpm --filter @engageiq/web start        # remix-serve ./build/server/index.js
pnpm --filter @engageiq/web type-check   # tsc --noEmit
```

**Database / migrations / seed** (`packages/db`, package `@engageiq/db`):

```bash
pnpm --filter @engageiq/db db:generate   # prisma generate
pnpm --filter @engageiq/db db:migrate    # prisma migrate dev   (create + apply migration)
pnpm --filter @engageiq/db db:push       # prisma db push       (schema → DB, no migration)
pnpm --filter @engageiq/db db:studio     # prisma studio
pnpm --filter @engageiq/db db:seed       # tsx prisma/seed.ts   (idempotent upserts)
pnpm --filter @engageiq/db ch:setup      # verify-clickhouse.ts: create CH table + MVs + round-trip test
pnpm --filter @engageiq/db build         # tsc → dist/  (REQUIRED before API/web typecheck — see §3)
```

**Tests:** Vitest is configured in `apps/api` only (`apps/api/vitest.config.ts`).
There is **no E2E (Playwright) or load (k6) setup yet** despite the roadmap calling
for them in Phase 10.

### 2.3 First-run sequence (inferred from docs + config)

```bash
docker compose up -d                          # postgres + clickhouse + redis
cp .env.example .env                          # then fill required secrets (see §below)
pnpm install
pnpm --filter @engageiq/db build              # build db package so others resolve its dist
pnpm --filter @engageiq/db db:migrate         # apply Prisma migrations to Postgres
pnpm --filter @engageiq/db db:seed            # seed test merchant + users
pnpm --filter @engageiq/db ch:setup           # create ClickHouse table + materialized views
pnpm --filter @engageiq/api dev               # API on :3001
pnpm --filter @engageiq/api worker:dev        # workers (separate terminal)
pnpm --filter @engageiq/web dev               # dashboard on :3000
```

**Known startup gotchas** (from `memory/context.md`):
- `JWT_SECRET` and `JWT_REFRESH_SECRET` must each be ≥ 32 chars or the app
  `process.exit(1)`s at startup (Zod env validation).
- `SENTRY_DSN=` with an empty value fails Zod `url()` — keep it blank/commented.
- `pino-pretty` is a dev dependency of `apps/api` (present in `package.json` now);
  it is required by the dev logger transport.

---

## 3. Repository Structure

```
engageiq/
├── apps/
│   ├── api/                      Fastify backend (HTTP server + BullMQ workers + processors)
│   │   ├── src/
│   │   │   ├── index.ts          ★ HTTP server entry — registers all plugins + routers (CENTRAL ROUTE REGISTRY)
│   │   │   ├── worker.ts         ★ Worker entry — instantiates all BullMQ workers (WORKER REGISTRY)
│   │   │   ├── plugins/          Fastify decorators: jwt.ts, authenticate.ts, api-key.ts
│   │   │   ├── routes/           HTTP routes, one folder/file per domain (see §4 for the convention)
│   │   │   │   ├── auth.ts, shopify.ts, backfill.ts, sdk.ts   (single-file routes)
│   │   │   │   ├── customers/  events/  segments/  journeys/  (folder routes: index/controller/service/schema)
│   │   │   ├── services/         Cross-route business logic (identity, merge, multi-store,
│   │   │   │                      profile-sync, segment-evaluator, journey-entry, journey-exit, shopify*)
│   │   │   ├── processors/       Shopify webhook payload processors (customer/order/checkout/refund/product)
│   │   │   ├── workers/          BullMQ worker factories (webhook/backfill/segment-evaluate/journey-executor)
│   │   │   └── lib/
│   │   │       ├── channels/dispatcher.ts   ★ CHANNEL DISPATCH STUB (all outbound messaging — not real yet)
│   │   │       └── segments/                condition-validator.ts, field-registry.ts
│   │   └── vitest.config.ts
│   └── web/                      Remix (React) dashboard
│       ├── app/
│       │   ├── root.tsx, entry.client.tsx, entry.server.tsx
│       │   ├── routes/           _index, customers.*, segments.*, journeys.*  (loaders/actions fetch the API)
│       │   └── components/SegmentBuilder.tsx
│       ├── vite.config.ts        dev server port 3000
│       └── tailwind.config.ts
├── packages/
│   ├── db/                       Prisma client + ClickHouse abstraction (package @engageiq/db)
│   │   ├── prisma/
│   │   │   ├── schema.prisma     ★★ SINGLE PRISMA SCHEMA — the highest-contention file in the repo
│   │   │   ├── migrations/       ★ 8 migrations + migration_lock.toml (see §6)
│   │   │   └── seed.ts           Idempotent seed (test merchant, users, customers)
│   │   ├── src/
│   │   │   ├── index.ts          re-exports prisma + all clickhouse fns
│   │   │   ├── prisma.ts         Prisma client singleton
│   │   │   └── clickhouse.ts     ★ ClickHouse client, table/MV DDL, insert + query helpers (CH BOUNDARY)
│   │   └── scripts/verify-clickhouse.ts
│   ├── queue/                    BullMQ queues (package @engageiq/queue)
│   │   └── src/
│   │       ├── queues.ts         ★ QUEUE-NAME REGISTRY — every BullMQ Queue + QueueName union type
│   │       ├── connection.ts     shared ioredis connection
│   │       └── index.ts          re-exports
│   ├── shared/                   Cross-cutting types/constants (package @engageiq/shared)
│   │   └── src/
│   │       ├── env.ts            ★★ ENV SCHEMA — Zod validation of all env vars (exit(1) on failure)
│   │       ├── types.ts          ★★ SHARED TYPE DEFINITIONS — all cross-app interfaces + job payloads
│   │       ├── roles.ts          ★ RBAC permission matrix (ROLE_PERMISSIONS, hasPermission)
│   │       └── index.ts          ★ barrel export — every shared symbol must be re-exported here
│   └── sdk/                      Storefront tracking SDK (package @engageiq/sdk, vanilla JS IIFE, esbuild)
│       └── src/index.ts
├── extensions/
│   └── app-embed-block/          Shopify App Embed extension (shopify.extension.toml) — SDK injection stub
├── memory/                       Project memory read at the start of every session
│   └── context.md                ★ current phase, completed milestones, decisions, blockers
├── updates/                      One markdown log per completed milestone / fix / decision
├── docs/
│   ├── PROJECT_OVERVIEW.md       (this file)
│   └── superpowers/
│       ├── plans/                implementation plans (3.3, segment-builder, journey-executor)
│       └── specs/                design specs (segment-builder, journey-executor, whatsapp-adapter)
├── CLAUDE.md                     ★ governance: how Claude Code must operate on this project
├── roadmap.md                    ★ the canonical 38-milestone, 10-phase roadmap
├── EngageIQ_Feature_Guide.md     full product/feature spec (~52KB)
├── docker-compose.yml            postgres + clickhouse + redis
├── package.json / turbo.json / pnpm-workspace.yaml / tsconfig.base.json
└── .env / .env.example           env files (gitignored except .env.example)
```

### 3.1 SHARED / HIGH-CONTENTION files (edit-collision hotspots)

These are the files multiple concurrent workstreams will all want to touch. Treat
them as serialization points.

| Concern | Exact path | Why it collides |
|---|---|---|
| **Prisma schema** | `packages/db/prisma/schema.prisma` | One file holds every model + enum. Any new table/field/enum edits it. Also implies a new migration (see §6). **Highest risk.** |
| **Migrations dir** | `packages/db/prisma/migrations/` | Each new migration is a new timestamped folder; two branches both adding one creates ordering hazards. |
| **Env schema** | `packages/shared/src/env.ts` | Every new external service adds a var here; merge-conflict magnet. Also `.env` / `.env.example` mirror it. |
| **Queue registry** | `packages/queue/src/queues.ts` | Every new queue adds a `Queue` + a `QueueName` union member here. |
| **Worker registry** | `apps/api/src/worker.ts` | Every new worker is instantiated + wired with event handlers here. |
| **Route registry** | `apps/api/src/index.ts` | Every new route group is imported + `app.register(...)`'d here (single file). |
| **Shared types** | `packages/shared/src/types.ts` | All cross-app interfaces + BullMQ job payloads live in one file. |
| **Shared barrel** | `packages/shared/src/index.ts` | Every shared symbol must be re-exported here to be importable; new exports edit this file. |
| **RBAC matrix** | `packages/shared/src/roles.ts` | New permissions/roles edit the permission sets. |
| **DB barrel** | `packages/db/src/index.ts` | New ClickHouse helpers must be re-exported here. |
| **Turbo config** | `turbo.json` | Build-graph edges (e.g. SDK→API) are declared here. |

---

## 4. Architecture

### 4.1 Major modules / domains and their build state

| Domain | State | Detail |
|---|---|---|
| **Scaffold / monorepo / env / Docker** | ✅ Fully built | pnpm + Turborepo; Zod-validated env; Docker Compose for PG/CH/Redis. |
| **Auth / RBAC / multi-tenancy** | ✅ Fully built | JWT access(1h)+refresh(7d), bcrypt, API-key auth, 6-role permission matrix, tenant enforcement (§4.5). |
| **PostgreSQL schema** | ✅ Built (evolving) | 11 models, 12 enums (§5). Migrations exist but may be unapplied (§6/§8). |
| **ClickHouse event store** | ✅ Built | `engageiq.events` MergeTree + 2 materialized views; full insert/query helper layer (§4.2). |
| **Shopify OAuth + webhooks** | ✅ Built | OAuth install/callback, HMAC validation, 10 webhook topics, async ingestion via BullMQ. |
| **Webhook processing** | ✅ Built | Processors for customer/order/checkout/refund/product; aggregates recalculated from DB; idempotent by Shopify webhook id. |
| **Historical backfill** | ✅ Built | Shopify Admin REST (rate-limited), customers→orders→batch-recalc phases, Redis progress, status/trigger routes. |
| **Storefront tracking SDK** | ✅ Built | Vanilla IIFE (~2.2KB gz), 13 event types, anon cookie, identity stitching, served at `/sdk.js`. |
| **Unified customer profile** | ✅ Built | `GET /api/v1/customers/:id` merges Postgres + ClickHouse stats into `EnrichedCustomerProfile`; list + detail UI. |
| **Identity resolution** | ✅ Built | `mergeCustomers()` (canonical=older), relation migration, auto-merge on SDK login; merge UI. |
| **Custom Event API + multi-store** | ✅ Built | `POST /api/v1/events` (API-key auth, rate-limited), group linking by email/phone, group profile endpoint. |
| **Segmentation (builder + evaluation)** | ✅ Built | 22 operators, recursive condition tree, field registry (20 fields), evaluator (SQL + in-memory paths), `segment-evaluate` worker, CRUD + builder UI. |
| **Journeys (entry/exit + executor)** | 🟡 Partial | Executor handles enroll/execute-step/scheduled-fire + entry/exit checks; CRUD + UI exist. **But the visual builder (drag-drop canvas) is not built, A/B split type unimplemented, and actions ultimately call the dispatch stub.** |
| **Channels (WhatsApp/SMS/Email/Push)** | 🔴 Stub only | `apps/api/src/lib/channels/dispatcher.ts` just `console.info`s the intent. No real Meta/SES/Twilio calls. A WhatsApp adapter **design spec exists** (`docs/superpowers/specs/2026-06-26-...`) but no code. |
| **Campaigns** | 🔴 Not started | `Campaign` model + `campaign-send` queue exist, but **no worker consumes the queue** and no routes/UI. |
| **Analytics dashboards (RFM/funnel/cohort/attribution/COD)** | 🔴 Not started | `analytics` queue exists but **has no worker**; no analytics routes/UI. RFM/AI score columns are empty. |
| **AI / ML (churn, LTV, fake-order, copywriter)** | 🔴 Not started | No Python service; score columns are nullable and unpopulated. |
| **Courier integrations (PostEx/Leopards/TCS/M&P)** | 🔴 Not started | — |
| **On-site personalization / pre-built flow library** | 🔴 Not started | — |

### 4.2 Data-store boundaries

- **PostgreSQL** (via Prisma) — all relational/transactional/mutable data:
  merchants, users, customers (+ profile/RFM/AI/COD columns), segments &
  memberships, campaigns, journeys/steps/enrollments, orders, COD orders,
  abandoned checkouts, API keys. **Rule: anything queried by `merchant_id`,
  updated, or related lives here.**
- **ClickHouse** — **events only**, append-only, high-volume. Single table
  `engageiq.events` (MergeTree, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY
  (merchant_id, coalesce(customer_id,''), timestamp)`, `TTL timestamp + 2 YEAR`).
  Two materialized views: `events_by_type_daily` (AggregatingMergeTree) and
  `active_visitors_mv` (ReplacingMergeTree). Helpers: `insertEvent`,
  `insertEvents`, `queryEvents`, `getEventCountsByType`, `getActiveVisitorCount`,
  `getRevenueByDay`. **Rule: never store profile data here; never query it for
  names/totals.** Everything goes through `packages/db/src/clickhouse.ts` — code
  must not import `@clickhouse/client` directly.
- **Redis** — three jobs: (1) BullMQ backing store, (2) caches (product/inventory
  cache, backfill progress hash `backfill:progress:{merchantId}`), (3) ephemeral
  state (OAuth state token, 10-min TTL). Shared connection in
  `packages/queue/src/connection.ts` (`maxRetriesPerRequest: null`).

### 4.3 Queue & worker architecture

Queues are declared in `packages/queue/src/queues.ts`. Workers are instantiated in
`apps/api/src/worker.ts` (a separate process from the HTTP server). Default job
options: 3 attempts (backfill: 5), exponential backoff 1s, keep last 1000
completed / 5000 failed.

| Queue (name string) | Defined in queues.ts | Consumed by worker | State |
|---|---|---|---|
| `webhook-ingestion` | ✅ | `workers/webhook.worker.ts` → `processors/*` | ✅ active |
| `backfill` | ✅ (attempts: 5) | `workers/backfill.worker.ts` | ✅ active |
| `segment-evaluate` | ✅ | `workers/segment-evaluate.worker.ts` | ✅ active |
| `journey-executor` | ✅ | `workers/journey-executor.worker.ts` | ✅ active |
| `campaign-send` | ✅ | **none** | ⚠️ **queue exists, no consumer** |
| `analytics` | ✅ | **none** | ⚠️ **queue exists, no consumer** |

**Standard pattern for a new queue/worker:**
1. Add a `new Queue('name', { connection: redisConnection, defaultJobOptions })`
   export in `packages/queue/src/queues.ts`, and add the literal to the
   `QueueName` union (and re-export in `index.ts`).
2. Define the job payload type in `packages/shared/src/types.ts` (and re-export in
   `index.ts`). Existing examples: `ShopifyWebhookJob`, `BackfillJobData`,
   `SegmentEvaluateJobPayload`, `JourneyExecutorJob`.
3. Create `apps/api/src/workers/<name>.worker.ts` exporting a
   `create<Name>Worker()` factory returning a BullMQ `Worker`.
4. Instantiate it in `apps/api/src/worker.ts` and wire `completed`/`failed`/`error`
   event handlers + add it to the `shutdown()` `Promise.all`.
- **Idempotency convention:** webhooks use `jobId = shopifyWebhookId`; backfill
  uses `jobId = merchantId`. Jobs must be safe to re-run.
- **Dead-letter queues:** the roadmap requires DLQs for critical queues; currently
  reliability relies on BullMQ retry + `removeOnFail` retention, **not** explicit
  DLQs. (Gap.)

### 4.4 Conventional structure of a feature/route

Two shapes coexist:
- **Folder routes** (`routes/customers/`, `events/`, `segments/`, `journeys/`):
  - `index.ts` — Fastify plugin: registers an `onRequest` auth hook + route paths.
  - `controller.ts` — HTTP layer: parse request, call service, shape response.
  - `service.ts` — business logic + DB/ClickHouse queries (merchant-scoped).
  - `schema.ts` — Zod input/output schemas.
  - `*.test.ts` — Vitest unit tests co-located.
- **Single-file routes** (`routes/auth.ts`, `shopify.ts`, `backfill.ts`,
  `sdk.ts`) — smaller domains kept in one file.
- **Route-ordering rule** (load-bearing): static/sub-paths must be registered
  **before** `/:id` wildcards. See `customers/index.ts` (`/:id/group` before
  `/:id`) and `journeys/index.ts` (`/:id/activate` etc. before `/:id`).

Routers are all mounted in `apps/api/src/index.ts` with explicit prefixes:
`/auth`, `/shopify`, `/backfill`, (sdk at root), `/api/v1/customers`,
`/api/v1/events`, `/api/v1/segments`, `/api/v1/journeys`. Plus `GET /health`.

**API response envelope** (per CLAUDE.md): success `{ success, data, meta? }`,
error `{ success: false, error: { code, message, details? } }`. (Confirm
adherence per-route; the shared `ApiResponse<T>` type uses `{ data, meta }`.)

### 4.5 Multi-tenancy enforcement

- **Dashboard requests (JWT):** `plugins/authenticate.ts` decorates
  `fastify.authenticate`. It `jwtVerify()`s, requires `type==='access'` + a role,
  then sets `request.user = { userId, merchantId, role }`. It additionally
  re-loads the user from the DB and **rejects if `dbUser.merchantId !==
  token.merchantId`** ("Tenant mismatch") and if the account is inactive. Route
  groups apply it via `fastify.addHook('onRequest', fastify.authenticate)`.
- **Role gating:** `fastify.requireRole([...roles])` wraps `authenticate` then
  checks `request.user.role`. Currently used in `routes/backfill.ts` (trigger
  requires `OWNER`/`ADMIN`). Most routes only require authentication, not a
  specific role (full RBAC enforcement is roadmapped for Phase 8.3).
- **API-key requests:** `plugins/api-key.ts` decorates `authenticateApiKey`.
  Expects `Authorization: Bearer eiq_...`; looks up by 12-char `keyPrefix`,
  bcrypt-compares the full key, sets `request.apiKeyMerchantId`. Used by
  `routes/events/`.
- **The actual scoping contract:** services must filter every query by the
  resolved tenant id (`request.user.merchantId` or `request.apiKeyMerchantId`).
  This is a **convention enforced by code review, not by a DB-level row-security
  policy or a Prisma middleware** — there is no automatic guard, so a service that
  forgets the `merchant_id` WHERE clause would leak cross-tenant data. CLAUDE.md
  flags this as a hard rule.
- **Agency model:** `Merchant` has a self-relation (`agencyId` → parent merchant)
  and agency roles exist (`AGENCY_ADMIN`/`AGENCY_MEMBER` with `agency:manage`), but
  full agency account-switching/scoping is Phase 8.3 (not built).

### 4.6 Key interface seams / adapters

- **Channel dispatch seam** — `dispatchChannel(channel, customerId, content,
  merchantId)` in `apps/api/src/lib/channels/dispatcher.ts`. **Today: a stub that
  logs intent.** The journey executor's ACTION steps call it. The design intent
  (per the WhatsApp spec) is to turn this into a thin enqueue onto a new
  `message-dispatch` queue, with a `ChannelAdapter` interface that
  WhatsApp/SMS/Email implement. **The `ChannelAdapter` interface does not exist in
  code yet** — only in the design spec. `ActionStepConfig` in `types.ts` defines
  the content contract: `{ channel: 'WHATSAPP'|'EMAIL'|'SMS'|'PUSH', content: {
  body, subject? } }`.
- **ClickHouse abstraction seam** — `packages/db/src/clickhouse.ts` is the only
  place that imports the ClickHouse client; all callers use its exported helpers.
- **Shopify access seam** — `services/shopify.service.ts` (OAuth/HMAC/webhook
  registration) and `services/shopify-admin.service.ts` (rate-limited Admin REST
  for backfill); implemented with Node `crypto` + native `fetch`, **no Shopify
  SDK**.
- **Segment evaluation seam** — `services/segment-evaluator.ts` exposes
  `compileToPrismaWhere` (SQL path), `evaluateProfile` (in-memory),
  `evaluateProfileMemberships`, and `buildProfileFromCustomer` (reused by journeys).

---

## 5. Data Model

Source of truth: `packages/db/prisma/schema.prisma`. **11 models, 12 enums.** All
monetary fields are `Decimal` (PKR); scores are `Float`. Snake_case columns via
`@map`; tables via `@@map`.

### 5.1 Models and relationships (high level)

- **Merchant** — tenant root. Self-relation `agency`/`children` (agency parent →
  child stores). Owns: users, customers, segments, campaigns, journeys, orders,
  codOrders, abandonedCheckouts, apiKeys. Has Shopify fields
  (`shopifyDomain @unique`, access token, scope, install/uninstall timestamps),
  `plan`, `timezone` (default `Asia/Karachi`), `currency` (default `PKR`).
- **User** — dashboard user. `@@unique([merchantId, email])`. `role` enum, FK to
  Merchant (cascade delete).
- **Customer** — the central profile. FK `merchantId`. Carries identity, Shopify
  aggregates (`totalOrders`/`totalSpent`/`avgOrderValue`/first/last order),
  behavioral (`lastSeenAt`, `sessionCount`), **RFM** fields, **AI** fields
  (`churnScore`, `churnRiskLabel`, `ltv90d/180d/365d`), **COD** profile
  (`codOrderCount`, acceptance/rejection rate, `fakeOrderScore`, `isBlocked`),
  channel opt-ins, `anonIds String[]` (SDK linking), `groupCustomerId` (multi-store
  unification), and identity-resolution fields (`mergedIntoId`, `mergedAt`).
  Relations: segmentMemberships, journeyEnrollments, orders, codOrders,
  abandonedCheckouts.
- **Segment** / **SegmentMembership** — segment holds a `conditions Json` tree;
  membership has `enteredAt` + nullable `exitedAt` (soft-delete preserves history).
- **Campaign** — channel, status, optional `segmentId`, `content Json`, scheduling,
  analytics counters, UTM fields. (Model only; no engine.)
- **Journey** / **JourneyStep** / **JourneyEnrollment** — journey has
  `triggerType`+`triggerConfig Json`, `reEntryRule` enum, single optional
  `exitTrigger`; steps are a self-referential tree (`parentStepId`/`childSteps`)
  with `config Json` + canvas coords; enrollment tracks `currentStepId`, status,
  timestamps, `metadata Json`.
- **Order** — full Shopify order mirror (`totalPrice`, `lineItems Json`,
  `financialStatus`, `isCod`, refunds, cancellation). `@@unique([merchantId,
  shopifyOrderId])`.
- **CodOrder** — COD-specific record with `status`, `verificationStatus`,
  `fakeScore`, verification timestamps. `@@unique([merchantId, shopifyOrderId])`.
- **AbandonedCheckout** — `@@unique([merchantId, shopifyCheckoutToken])`;
  `recoveredAt`/`recoveredOrderId` (recovery not yet wired — see §8).
- **ApiKey** — `keyHash @unique` (bcrypt), `keyPrefix` (indexed, first 12 chars),
  `isActive`, `expiresAt`.

### 5.2 The multi-tenant scoping field

**Every merchant-owned table carries `merchantId String @map("merchant_id")`**
with a FK to `Merchant` and `onDelete: Cascade`. Indexes on `merchantId` are
present on all such tables. Child-of-child tables (`SegmentMembership`,
`JourneyStep`, `JourneyEnrollment`) scope through their parent
(segment/journey/customer) rather than a direct `merchantId` — **so tenant safety
for those depends on joining through a merchant-scoped parent.** Watch this when
writing membership/enrollment/step queries directly.

### 5.3 Notable constraints / indexes / enums a developer must respect

- **Unique constraints that bite during ingestion:**
  - `Customer`: `@@unique([merchantId, shopifyCustomerId])` **and**
    `@@unique([merchantId, email])`. The dual uniqueness is the root of the
    historical stub-merge P1 bug (a stub customer with an email but no
    `shopifyCustomerId` collides when the `customers/create` webhook arrives).
  - `Order` / `CodOrder`: `@@unique([merchantId, shopifyOrderId])`.
  - `AbandonedCheckout`: `@@unique([merchantId, shopifyCheckoutToken])`.
  - `User`: `@@unique([merchantId, email])`. `Merchant.shopifyDomain @unique`.
  - `ApiKey.keyHash @unique`.
- **JourneyEnrollment is intentionally NOT unique per (journey, customer)** — only
  `@@index([journeyId, customerId, status])`. Multiple enrollments per customer per
  journey are allowed by design (supports the `ALLOW` re-entry rule).
- **Query-performance indexes:** `Customer` has indexes on `[merchantId,
  rfmSegment]`, `[merchantId, churnRiskLabel]`, `[groupCustomerId]`; `Order` on
  `[merchantId, placedAt]` and `[merchantId, isCod]`; `Campaign`/`Journey` on
  `[merchantId, status]`.
- **The GIN index on `customers.anon_ids`** (for array `@>` containment lookups)
  is created in migration `20260429100000_add_anon_ids_to_customers` (array column
  is in the schema; the GIN index is in raw migration SQL, not expressible in the
  Prisma model).
- **Nullable JSON:** use `Prisma.DbNull` (not `null`) for SQL NULL on nullable
  JSON fields (Prisma 5 behavior).
- **12 enums:** `Plan`, `Role`, `Channel`, `CampaignStatus`, `JourneyStatus`,
  `JourneyStepType` (includes `AB_SPLIT`, unimplemented in the executor),
  `EnrollmentStatus`, `CodOrderStatus`, `CodVerificationStatus`, `RfmSegment`
  (11 named segments), `ChurnRiskLabel`, `ReEntryRule`.

---

## 6. Migration System

- **Tool:** Prisma Migrate (Postgres). `migration_lock.toml` pins
  `provider = "postgresql"`.
- **Create + apply (dev):** `pnpm --filter @engageiq/db db:migrate`
  (= `prisma migrate dev`). For schema-only sync without a migration:
  `db:push`. Generate client: `db:generate`.
- **Naming/numbering scheme:** Prisma's standard `migrations/<timestamp>_<slug>/`
  with a `migration.sql`. **Inconsistency to note:** the four early migrations use
  hand-authored synthetic timestamps (`20260428000000`–`20260428000003`) rather
  than real Prisma-generated ones — they were manually numbered to enforce an
  order. Ordering is purely **lexicographic by folder name**.
- **Migrations present (8), in apply order:**
  1. `20260427085342_init`
  2. `20260428000000_add_shopify_fields`
  3. `20260428000001_fix_journey_enrollment_index`
  4. `20260428000002_fix_segment_membership_index`
  5. `20260428000003_add_api_key_prefix_index`
  6. `20260428100000_add_orders_checkouts`
  7. `20260429100000_add_anon_ids_to_customers`
  8. `20260610110533_add_exit_trigger_to_journeys` ← **current latest**
- **Applied locally vs production:** **Unknown / likely none applied.**
  `memory/context.md` still lists "Prisma migration not run yet (no live DB) — run
  `pnpm db:migrate` ... after `docker compose up -d`" as an open item. There is
  **no production database** (nothing is deployed). So treat all migrations as
  "exist as files, application state unverified."
- **What happens if two working copies both generate a migration concurrently
  (the critical question):**
  - Each `prisma migrate dev` creates a **new folder named with that machine's
    clock** (or a manually chosen prefix). Two copies produce two differently-named
    folders — no filename collision, but **no coordinated ordering** either.
  - On merge, Prisma orders migrations **lexicographically by folder name**, not by
    git history. If copy A's migration timestamps *earlier* than copy B's but B was
    applied to a shared DB first, then after merge Prisma sees a migration "in the
    past" that the DB's `_prisma_migrations` table never recorded → it flags the
    history as **out of order / drifted** and (in dev) wants to **reset the
    database**. In prod, `migrate deploy` will fail the integrity check.
  - Both migrations also edit the **same `schema.prisma`**, so you typically get a
    direct merge conflict there too.
  - **How ordering is kept consistent today: by hand and by serialization.** There
    is no tooling, no CI migration check, and no squash policy. The team's actual
    practice (visible in the synthetic `20260428000000`-series names) is to manually
    pick timestamps to force a sequence. **This is a real hazard for parallel work
    (§11).**

---

## 7. Dependency Graph

### 7.1 Package-level edges (workspace deps)

```
@engageiq/shared   ← (depended on by) db, queue, api, web    [leaf; depends on nothing internal]
@engageiq/db       → shared                                    ← api
@engageiq/queue    → shared                                    ← api
@engageiq/sdk      → (none internal)                           [standalone; built before api via turbo.json]
@engageiq/api      → shared, db, queue                         (HTTP server + workers + processors)
@engageiq/web      → shared                                    (talks to api over HTTP, not via import)
```

- `@engageiq/shared` is the universal leaf — **changing it forces a rebuild of
  everything**. Highest blast radius.
- `turbo.json` adds an explicit edge: `@engageiq/api#build` depends on
  `@engageiq/sdk#build` (the API serves the built SDK at `/sdk.js`).
- `@engageiq/web` depends on `shared` only at the type level; it reaches the API
  over HTTP. **Web→API base URL** is read from `process.env.API_URL`, defaulting to
  `http://localhost:3001` in Remix loaders/actions (confirmed in
  `routes/segments.*`, `journeys.*`, `customers.$id_.merge.tsx`). There is **no
  `API_URL` entry in `.env.example`** — it relies on the default. (Flag.)

### 7.2 Module-level coupling inside `apps/api`

| Module | Depends on | Depended on by |
|---|---|---|
| `plugins/*` (jwt, authenticate, api-key) | `@engageiq/db` (user/apikey lookup), shared | every route group |
| `processors/*` | db, services (profile-sync, identity, journey hooks) | `workers/webhook.worker` |
| `workers/webhook` | queue, processors | `worker.ts` |
| `workers/backfill` | queue, `services/shopify-admin`, processors | `worker.ts` |
| `workers/segment-evaluate` | queue, `services/segment-evaluator` | `worker.ts` |
| `workers/journey-executor` | queue, `services/journey-entry`/`journey-exit`, `lib/channels/dispatcher` | `worker.ts` |
| `services/segment-evaluator` | db, shared, `lib/segments/*` | segment routes, segment worker, **journeys** (`buildProfileFromCustomer`) |
| `services/journey-entry` / `journey-exit` | db, shared, segment-evaluator | journey executor, and hooked into segment-evaluator / order.processor / events service |
| `lib/channels/dispatcher` (stub) | shared types | journey executor (ACTION steps) |

### 7.3 Independent vs tightly-coupled (for parallelization)

- **Tightly coupled (a change ripples):** `schema.prisma` → migrations →
  `@engageiq/db` → most services; `packages/shared` → everything; the segment
  evaluator is reused by journeys, so segment + journey work are coupled.
- **Relatively independent today:** the storefront **SDK** (`packages/sdk`),
  Shopify OAuth/webhook plumbing, the **web** dashboard pages (separate process,
  HTTP boundary), and net-new features that add their *own* queue/worker/route
  (e.g. a new channel adapter or analytics module) — provided they don't edit the
  shared schema simultaneously.

---

## 8. Current State and Roadmap

### 8.1 Current milestone / in progress

Per `memory/context.md` (last updated 2026-06-10) the project is **entering "Phase
5 — Campaign Execution & Channel Integration" (Not Started)**. The most recent
commit (`16cbd67`, 2026-06-26) added a **WhatsApp channel adapter design spec**
(`docs/superpowers/specs/2026-06-26-whatsapp-channel-adapter-design.md`, status
"Approved design, pending spec review"). So the active thread is: **replace the
`dispatchChannel` stub with a real WhatsApp Cloud API send path behind a
`ChannelAdapter` interface** (design done, implementation not started). There is
also an untracked plan file `docs/superpowers/plans/2026-06-02-milestone-3-3.md` in
the working tree.

> ⚠️ **Naming caveat:** the team's "Phase 4" and "Phase 5" do **not** match
> `roadmap.md`'s numbering — see §9.2. The WhatsApp spec itself says it "maps to
> roadmap 6.3."

### 8.2 Finished (recorded complete in context.md)

10 milestones: **1.1–1.4** (scaffold, Postgres schema, ClickHouse, auth/RBAC),
**2.1–2.4** (Shopify OAuth, webhook pipeline, backfill, storefront SDK),
**3.1–3.3** (profile aggregation, identity resolution, custom-event API +
multi-store), and the team's **"4.1"** (segment builder) and **"4.2"** (journey
executor entry/exit). Test counts cited in the logs (all passing): segment builder
33 Vitest, journey executor 20, identity 21, custom-event 15, profile 11.

### 8.3 Stubbed / mocked / empty (know these before building)

- **Channel dispatch is a stub** — `lib/channels/dispatcher.ts` only logs. No
  message is ever sent on any channel.
- **`campaign-send` and `analytics` queues have no workers** — defined but inert.
- **All AI/RFM score columns are empty** — `rfmSegment`, `rfm*Score`, `churnScore`,
  `churnRiskLabel`, `ltv90d/180d/365d`, `fakeOrderScore` exist on `Customer`/
  `CodOrder` but **no engine writes them** (Python ML service doesn't exist).
- **External APIs are not integrated** — no real Meta/SES/Twilio/courier/IVR/
  Anthropic calls; their env vars are optional and mostly blank.
- **Journey gaps** — no visual builder; `AB_SPLIT` step type defined but not
  executed; ACTION steps bottom out at the dispatch stub.
- **Abandoned-checkout recovery** (`recoveredAt`/`recoveredOrderId`) is not set by
  the webhook processor (deferred).
- **`languagePreference`** not populated by webhooks (needs Shopify metafields).
- **SDK served from the API** (`/sdk.js`); production should front it with a CDN.
- **Product catalog is Redis-only** — no `products` Postgres table yet (deferred).

### 8.4 Remaining roadmap (canonical `roadmap.md` identifiers)

> These are the *roadmap's own* numbers. The team has been renumbering as it goes
> (§9.2), so "what's next" in the team's terms = WhatsApp/channel send, which the
> roadmap files under **6.3**.

- **Phase 4 — Analytics Engine:** 4.1 Real-Time Dashboard · 4.2 RFM Scoring Engine
  · 4.3 Funnel Analysis · 4.4 Cohort Retention · 4.5 Revenue Attribution + Product
  Retention + COD Analytics. *(Not built.)*
- **Phase 5 — Segmentation Engine:** 5.1 Behavioral Segment Builder *(done as team
  "4.1")* · 5.2 Dynamic Segment Evaluation *(largely done)* · 5.3 AI Segment
  Discovery *(needs Python service)*.
- **Phase 6 — Campaign & Automation Engine:** 6.1 Visual Journey Builder · 6.2
  Journey Execution Engine *(partially done as team "4.2")* · 6.3 WhatsApp & SMS
  Adapters *(in progress — design only)* · 6.4 Email + COD Verification · 6.5
  On-Site Personalization + Pre-Built Flow Library.
- **Phase 7 — AI & Intelligence:** 7.1 Churn Prediction · 7.2 LTV + Product Recs ·
  7.3 Fake Order Scoring (COD ML) · 7.4 AI Copywriter (Claude).
- **Phase 8 — Platform & Integrations:** 8.1 Courier integrations · 8.2 Public REST
  API + outbound webhooks + App Store prep · 8.3 Full RBAC + Agency accounts.
- **Phase 9 — South Asia Specialization:** 9.1 Urdu-first campaigns · 9.2 COD
  intelligence polish · 9.3 AI model calibration.
- **Phase 10 — QA, Hardening & Launch:** 10.1 E2E + perf · 10.2 Security audit ·
  10.3 Observability · 10.4 Beta launch + AWS deploy + CI/CD.

### 8.5 Known issues / TODO / tech debt (from context.md + observed)

- **[Historical P1, recorded fixed in 3.3]** stub-customer upgrade in
  `customer.processor.ts` to avoid the `@@unique([merchantId, email])` violation on
  `customers/create`.
- Migrations possibly never applied to any DB (§6).
- `JourneyEnrollment` not unique per (journey, customer) — intentional but a
  footgun for naive queries.
- `@clickhouse/client` emits benign WARN logs on DDL `exec()`.
- Backfill `recalculating` phase shows a static ~95% (no per-customer progress);
  count endpoints can drift mid-backfill.
- SDK `add_to_cart` listener / `checkout_step` tracking may miss theme-specific or
  headless Shopify implementations.
- No DLQs, no rate-limit-per-merchant on sends yet (designed, not built).
- `prettier-plugin-tailwindcss` is in `.prettierrc` but only in `apps/web` deps
  (may need hoisting for repo-wide format).
- No `API_URL` in `.env.example` (web relies on the localhost default).

### 8.6 Local vs deployed; deployment setup

- **Everything is local.** No CI (no `.github/`), no IaC, nothing deployed.
- **Intended prod (from roadmap/CLAUDE.md, not yet built):** AWS ECS + RDS
  (Postgres) + ElastiCache (Redis) + ClickHouse Cloud; SES/Meta/Twilio for
  channels; GitHub Actions for test→build→deploy; Sentry for errors. All of this is
  Phase 10 work.

---

## 9. Process and Governance Files

### 9.1 Roles of each governance / planning file

- **`CLAUDE.md`** (repo root) — the operating contract for Claude Code on this
  project. Mandates a startup sequence (read memory → architecture → schema →
  recent updates → roadmap), the tech stack (declared non-negotiable), hard
  architecture rules (merchant-id scoping, ClickHouse/Postgres boundary, BullMQ for
  webhooks, response envelope, strict TS), the parallel-agent policy (up to 4
  agents, interfaces-first, one agent owns memory writes), coding/commit
  conventions, `.env` handling, and a **Session Closing Protocol** (write an
  update file → update memory → commit). ⚠️ Its "Current Progress" tail block is
  **stale** (says "Phase 3 in progress, milestone 3.1, 8/38 done") — context.md is
  newer and authoritative.
  - Note: there is a *different* `CLAUDE.md` at `/Users/abdullahali/Downloads/`
    (parent dir) describing an unrelated "approval workflow" project — **ignore
    it**; the EngageIQ governance file is the one in this repo root.
- **`roadmap.md`** (repo root) — the canonical 38-milestone / 10-phase plan with
  per-milestone deliverables and a phase-dependency table. The product's master
  sequence.
- **`EngageIQ_Feature_Guide.md`** (repo root, ~52KB) — the detailed product/feature
  spec; the "what each feature must do" reference.
- **`memory/context.md`** — the **living state** file: current phase/milestone,
  completed-milestone table, "what was built," known issues/blockers, and a long
  decisions log. **The most up-to-date single source of project state.**
  - ⚠️ The CLAUDE.md startup sequence also expects `memory/architecture.md`,
    `memory/schema.md`, and `memory/env.md`. **These do not exist** — `memory/`
    contains only `context.md`. (Their content lives inline in CLAUDE.md /
    schema.prisma / env.ts instead.)
- **`updates/`** — append-only audit log, one markdown file per completed milestone
  / fix / decision (`YYYY-MM-DD_<phase>_<slug>.md`). 13 files, 2026-04-27 →
  2026-06-10. Each records what was built, files touched, decisions, deviations,
  open issues, and "what to do next."
- **`docs/superpowers/`** — `plans/` (implementation plans) and `specs/` (design
  specs) produced by the "superpowers" planning workflow. Includes the
  segment-builder, journey-executor, and WhatsApp-adapter specs. There is **no
  top-level `specs/` directory** at the repo root — specs live here.
- **`.env` / `.env.example`** — env config; `.env` gitignored, `.env.example`
  tracked and kept in sync as the required-vars manifest.

### 9.2 ⚠️ Discrepancies between planning sources (reported, not resolved)

There are **three** notable disagreements. Reporting them exactly:

1. **Phase numbering: `roadmap.md` vs `memory/context.md` diverge.**
   - `roadmap.md` (canonical): Phase 4 = **Analytics Engine**, Phase 5 =
     **Segmentation Engine** (5.1 Behavioral Segment Builder, 5.2 Dynamic Segment
     Evaluation, 5.3 AI Segment Discovery), Phase 6 = **Campaign & Automation
     Engine** (6.1 Visual Journey Builder, 6.2 Journey Execution Engine, 6.3
     WhatsApp & SMS Adapters …).
   - `context.md` (as-built): Phase 3 done, then **"Phase 4 — Segment Builder &
     Journey Executor"** with milestones **"4.1 Segment Builder"** and **"4.2
     Journey Executor,"** and current **"Phase 5 — Campaign Execution & Channel
     Integration."**
   - **Mapping:** team "4.1" = roadmap **5.1**; team "4.2" = roadmap **6.2** (entry/
     exit slice); team "Phase 5 / WhatsApp" = roadmap **6.3**. In effect the team
     **skipped roadmap Phase 4 (Analytics Engine entirely)** and **resequenced**
     segmentation + journeys earlier, compressing the phase numbers. The WhatsApp
     spec acknowledges this ("maps to roadmap 6.3"). **The two documents are not
     reconciled.**

2. **`CLAUDE.md` "Current Progress" is stale vs `context.md`.** CLAUDE.md's tail
   says Phase 3 in progress at milestone 3.1 with 8/38 complete; context.md shows
   through team-"4.2" complete (10 milestones) and Phase "5" starting. context.md
   is newer.

3. **Missing memory files.** CLAUDE.md's mandatory startup sequence references
   `memory/architecture.md`, `memory/schema.md`, `memory/env.md`, and
   `docs/roadmap.md`; the actual files are only `memory/context.md` and a
   root-level `roadmap.md`. The referenced memory files do not exist.

---

## 10. Testing and Integration

### 10.1 Tests

- **Framework:** **Vitest**, configured only in `apps/api`
  (`apps/api/vitest.config.ts`). Run with `pnpm --filter @engageiq/api test`
  (`vitest run`) or `test:watch`.
- **Organization:** unit tests are **co-located** next to the code they cover
  (e.g. `services/merge.service.test.ts`, `services/segment-evaluator.test.ts`,
  `routes/customers/service.test.ts`, `processors/customer.processor.test.ts`,
  `workers/journey-executor.worker.test.ts`, `lib/segments/condition-validator.test.ts`).
  ~11 test files. Per the update logs, ~100 tests pass across milestones.
- **What counts as a passing build:** there is no formal definition encoded (no CI).
  Practically: `pnpm type-check` (tsc `--noEmit`, strict, across packages) +
  `pnpm --filter @engageiq/api test` green + `pnpm build` succeeding.
  **Build ordering caveat:** `packages/db` (and `shared`) must be **built first**
  (`tsc → dist/`) because other packages import their compiled `dist` output via
  `exports`; Turbo's `^build` dependency handles this for `pnpm build`, but a bare
  `tsc --noEmit` in `apps/api` can fail if `@engageiq/db` hasn't been built.
- **No E2E / load tests** (Playwright, k6) exist yet — roadmapped for Phase 10.

### 10.2 Integration / git workflow

- **Branching:** single branch — `main` (local and `origin/main`). No feature
  branches currently in the repo.
- **Worktrees:** **none in use** (`git worktree list` shows only the main
  checkout). Note: the superpowers tooling *can* create worktrees, but none exist
  now.
- **PRs vs direct commits:** history is **direct commits to `main`**, one per
  milestone, following the `feat(phaseN.X): ...` / `chore(memory): ...`
  convention. CLAUDE.md says "never push directly to main without the full commit
  message format" — in practice committing to main with that format is the
  observed flow; there is no PR process or remote review gate.
- **Working-tree state at time of writing:** one untracked file
  (`docs/superpowers/plans/2026-06-02-milestone-3-3.md`).
- **No CI** anywhere (no `.github/`, no other pipeline config).

---

## 11. Parallel-Work Readiness (5–6 concurrent instances)

**Honest assessment: the codebase is *moderately* ready for parallel work, but
the database/schema layer is a serialization bottleneck that will bite hard if
ignored.** The module boundaries (queues, workers, route groups, services) are
clean and make feature-parallelism feasible; the shared schema, shared types, and
the handful of central registries are where concurrent edits collide. There is no
tooling today to make concurrent migrations safe.

### 11.1 Resources that WILL collide if edited concurrently

| Resource | Path(s) | Collision type |
|---|---|---|
| **Prisma schema** | `packages/db/prisma/schema.prisma` | Two streams adding models/fields → guaranteed merge conflict + migration-order drift. **The #1 hazard.** |
| **Migrations** | `packages/db/prisma/migrations/` | Independently-generated migrations have uncoordinated lexicographic order → Prisma drift / dev DB reset (§6). |
| **Env schema** | `packages/shared/src/env.ts` + `.env` + `.env.example` | Each new integration adds vars in all three. |
| **Shared types** | `packages/shared/src/types.ts` + `index.ts` barrel | All job payloads + cross-app interfaces in one file; barrel re-export edits overlap. |
| **Queue registry** | `packages/queue/src/queues.ts` (+ `index.ts`) | Every new queue edits the same file + `QueueName` union. |
| **Worker registry** | `apps/api/src/worker.ts` | Every new worker is wired here. |
| **Route registry** | `apps/api/src/index.ts` | Every new route group registered here. |
| **RBAC matrix** | `packages/shared/src/roles.ts` | New permissions edit shared sets. |
| **DB barrel** | `packages/db/src/index.ts` | New CH helpers re-exported here. |
| **Dev-server ports** | API **3001**, Web **3000** (Remix), Postgres 5432 / ClickHouse 8123+9000 / Redis 6379 | **Only one API and one web dev server can bind their port at a time.** Multiple instances doing `pnpm dev` simultaneously will get `EADDRINUSE`. Workers don't bind a port (safe to run many, but they share the *same* Redis queues — see below). |
| **Shared Redis/queues + DBs** | one local Postgres, one ClickHouse, one Redis | All instances pointed at the same local stack share state: BullMQ jobs, seeded data, ClickHouse events. Concurrent integration tests/workers can interfere (same queue names, same merchant rows). |

### 11.2 Safely parallelisable today

- **Net-new feature modules that own their own queue + worker + route group** and
  do **not** change `schema.prisma` — e.g. a WhatsApp/SMS/Email channel adapter
  built behind the existing `dispatchChannel` seam, an analytics route group
  reading existing ClickHouse data, the public REST API surface, outbound webhooks.
  Each adds its own files under `routes/<x>/`, `workers/<x>.worker.ts`,
  `services/`, and touches the central registries only at the *final integration
  commit*.
- **The storefront SDK** (`packages/sdk`) — isolated, standalone build.
- **Web dashboard pages** (`apps/web/app/routes/*`) — separate process, HTTP
  boundary; one stream can build UI against the existing API while another extends
  the API, as long as they agree on the response shape first (per CLAUDE.md's
  "define interfaces first" rule).
- **Pure-logic services with no schema change** — e.g. RFM scoring *logic*,
  funnel/cohort query builders over existing ClickHouse/Postgres data, the AI
  copywriter (Anthropic) which adds no tables.
- **Docs/specs/plans** under `docs/superpowers/` and `updates/` (different files
  per stream).

### 11.3 Must be serialised

- **Any schema change.** All `schema.prisma` + migration work should go through a
  **single owner / single queue**, one migration at a time, rebased before the next.
  Multiple analytics/AI/campaign features each want new columns or tables (RFM/AI
  scores already exist, but campaigns, messages, templates, courier events,
  products will need new tables) — **funnel these through one serialized DB stream.**
- **Edits to the central registries** (`worker.ts`, `index.ts` route registry,
  `queues.ts`, `env.ts`, `types.ts`/barrel, `roles.ts`). Better: have each parallel
  stream add its *own* files and leave a single short integration step (one person,
  one commit) that wires the registries — minimizes conflicts to a few well-known
  lines.
- **`@engageiq/shared` changes** — highest blast radius; coordinate and rebuild.

### 11.4 What is missing to make safe parallel work possible (hazard list, not a redesign)

- **No migration-coordination policy or tooling.** No CI check for migration
  drift, no enforced single-owner, no squash/rebase rule. Two streams generating
  migrations *will* drift. (Today it's managed by hand-picked timestamps.)
- **No CI at all** — nothing catches type errors, failing tests, lint, or migration
  drift before merge. With 5–6 concurrent streams committing to `main`, regressions
  will land silently.
- **No branch/PR isolation in use** — everything is direct-to-`main`. Concurrent
  instances on the same branch/worktree will clobber each other. Git worktrees (or
  per-instance branches) are **available but unused**; they'd be the obvious
  isolation mechanism.
- **Single shared local data stack** — one Postgres/ClickHouse/Redis. No per-instance
  DB/namespace or test-isolation. Concurrent workers consume each other's BullMQ
  jobs and mutate the same seeded merchant.
- **Fixed dev ports** — API `3001` / web `3000` are hard-defaulted; running more
  than one of each concurrently needs per-instance `PORT`/`WEB_PORT` overrides
  (the env schema supports both vars, so this is configurable).
- **No DLQs / no per-merchant send rate limiting yet** — relevant once multiple
  streams start exercising the queues under load.
- **Response-envelope/interface drift risk** — with no shared OpenAPI/contract and
  the envelope only described in prose, parallel API + web streams can diverge on
  response shapes unless interfaces are fixed in `packages/shared/src/types.ts`
  first (which itself is a contention point).

**Bottom line for the directing assistant:** parallelize along the **queue/worker/
route-group seams** and the **API↔web HTTP boundary**, give each stream its own new
files, and **serialize every database/schema change and every central-registry
edit through one owner**. Stand up at minimum a CI typecheck+test gate and a
migration-ownership rule before running 5–6 instances hot against `main`, or use
per-stream branches/worktrees with a single integrator.

---

*Document generated by reading the repository at commit `16cbd67` on branch
`main`. No code or non-doc files were modified. Where state could not be verified
from the repo (e.g. whether migrations were applied to any database), the
uncertainty is stated rather than resolved.*
