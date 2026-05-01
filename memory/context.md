# EngageIQ — Project Context

> Last updated: 2026-04-29
> Current phase: Phase 2 — Shopify Integration & Data Ingestion (Complete)

## Project Summary

EngageIQ is a full-stack multi-tenant customer engagement platform for Shopify merchants in South Asia / MENA. Built by Swift Studioz, Lahore. Core differentiators: WhatsApp-first, COD-native, Urdu support, multi-store unified profiles, PKR pricing.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Node.js (Fastify) |
| Job Queue | BullMQ + Redis |
| Primary DB | PostgreSQL |
| Analytics DB | ClickHouse |
| Cache | Redis |
| Frontend | Remix (React) |
| Email | AWS SES |
| WhatsApp | Meta Cloud API |
| SMS | Twilio + local PK aggregator |
| Push | Web Push Protocol (self-hosted) |
| AI/ML | Python microservice (FastAPI) |
| LLM | Anthropic Claude API |
| Infra | AWS (ECS + RDS + ElastiCache) |
| IVR | Fixerr AI |

## Completed Milestones

- **1.1 — Project Scaffold & Monorepo Setup** (2026-04-27) — pnpm workspaces + Turborepo, all packages created, Docker Compose, env validation, ClickHouse abstraction layer
- **1.2 — Database Schema (PostgreSQL)** (2026-04-27) — full Prisma schema (11 models, 12 enums), seed script with test merchant + 5 customers
- **1.3 — ClickHouse Event Store Setup** (2026-04-27) — `engageiq.events` table, 2 materialized views (daily event counts, daily visitors), full query layer (counts/revenue/active visitors), round-trip verification PASSED
- **1.4 — Auth, RBAC & Multi-Tenancy** (2026-04-28) — JWT access+refresh tokens, bcrypt passwords, RBAC permission matrix, API key auth, auth routes, tenant enforcement middleware
- **2.1 — Shopify App Setup & OAuth** (2026-04-28) — OAuth install/callback flow, HMAC validation, 10 webhook topics registered on install, BullMQ webhook ingestion, App Embed stub
- **2.2 — Webhook Processing Pipeline** (2026-04-28) — BullMQ worker on `webhook-ingestion` queue; processors for all 10 webhook topics; Order + AbandonedCheckout models added; customer aggregates recalculated from DB; product/inventory cached in Redis
- **2.3 — Historical Backfill** (2026-04-29) — Shopify Admin REST client with rate limiting; BullMQ backfill worker (customers phase + orders phase + batch aggregate recalc); Redis progress tracking; `GET /backfill/status` + `POST /backfill/trigger` routes; auto-enqueued on OAuth install
- **2.4 — Storefront Event Tracking SDK** (2026-04-29) — Vanilla JS IIFE SDK (2.2 KB gzipped); tracks all 13 events; anon cookie + session storage; auto-init from `data-merchant-id`; `POST /v1/sdk/events` (ClickHouse ingestion); `POST /v1/sdk/identify` (identity stitching with stub customer creation); App Embed Block extension stub; Prisma migration for `customer.anonIds[]`

## Active Phase

Phase 3 — Unified Customer Profiles (Next)
- [ ] 3.1 Profile Aggregation & Real-Time Updates
- [ ] 3.2 Identity Resolution
- [ ] 3.3 Custom Event API & Multi-Store Unification

## Completed Phase

Phase 2 — Shopify Integration & Data Ingestion ✓
- [x] 2.1 Shopify App Setup & OAuth
- [x] 2.2 Webhook Processing Pipeline
- [x] 2.3 Historical Backfill
- [x] 2.4 Storefront Event Tracking SDK

## Key Decisions Made

- **`Order` table added in Phase 2.2** (not Phase 1.2 as originally planned) — required to implement "upsert order + update customer aggregates" per milestone spec
- **Customer aggregates recalculated from DB** — not incremented; avoids counter drift on cancellations/refunds
- **Product/inventory Redis-only** — no PostgreSQL products table until Phase 4.5 (Product-Level Retention Analytics)
- **`Prisma.DbNull` for nullable JSON fields** — Prisma 5 removed `null` from `InputJsonValue`; `DbNull` = SQL NULL
- **Separate worker process** (`apps/api/src/worker.ts`) — decoupled from HTTP server; `pnpm worker` or `pnpm worker:dev`
- **`bullmq` and `@prisma/client` added to `@engageiq/api`** — needed for Worker class and Prisma namespace

## Known Issues / Blockers

- `pino-pretty` referenced in `apps/api/src/index.ts` but not yet in package.json — add before first `dev` run
- `prettier-plugin-tailwindcss` in `.prettierrc` but only in `apps/web/` devDeps — may need to be hoisted to root for monorepo-wide formatting
- Prisma migration not run yet (no live DB) — run `pnpm db:migrate` inside `packages/db` after `docker compose up -d`
- `@@unique([journeyId, customerId])` on `JourneyEnrollment` blocks re-enrollment — Phase 6 executor must delete old record before re-enrolling for ALLOW/RE_ENROLL journeys
- `@clickhouse/client` emits benign WARN logs for DDL `exec()` calls (socket closed before response fully read); suppress in production logger config
- `SENTRY_DSN=` empty value in `.env` fails Zod `url()` validation — commented out in `.env` (keep blank entries commented)
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES`, `SHOPIFY_APP_URL` are now **required** — app exits at startup without them; add stub values to `.env` for local dev without a live Shopify store
- `/dashboard` redirect from OAuth callback is a stub — no dashboard route exists yet (Phase frontend work)
- `registerWebhooks` uses Shopify Admin REST API `2024-01` version pin — upgrade when needed
- `AbandonedCheckout.recoveredAt` not yet set by webhook processor — requires `recovered_order_id` in Shopify `checkouts/update` payload; will be set by Phase 6 journey executor
- Product catalog is Redis-only cache; full `products` PostgreSQL table deferred to Phase 4.5
- Customer `languagePreference` not set by webhook processor (requires Shopify metafield access)
- Backfill `recalculating` phase shows 95% progress — no per-customer progress updates (may appear "stuck" for very large customer bases)
- Backfill count endpoints (`customers/count`, `orders/count`) may drift slightly from actual results if Shopify adds/removes records mid-backfill
- `checkout_step` tracking uses Shopify's `page:load` event — may not fire on headless Shopify implementations
- SDK `add_to_cart` AJAX button listener covers common patterns; theme-specific custom classes may need additional config
- Identity stitching: concurrent anon visitors providing the same email before webhook arrives can cause a `@@unique` conflict on stub customer create — deferred to Phase 3 identity resolution
- SDK is served by the API at `/sdk.js` — should be fronted by CDN in production for performance

## Key Decisions Made

- **SDK as IIFE (not ESM)** — must work as a `<script>` tag without bundler; universal browser compatibility
- **esbuild for SDK** — minimal config, fastest build; SDK is 2.2 KB gzipped (target was <5 KB)
- **`sendBeacon` for unload events** — `fetch` is unreliable on page navigation; `sendBeacon` guarantees delivery for `time_on_page` / page exit flush
- **Batch events (up to 10, 3s debounce)** — reduces HTTP requests; `keepalive: true` handles tab close mid-batch
- **Stub customer creation in `stitchIdentity`** — SDK events from email-captured visitors are attributed before Shopify webhook arrives; stub merges cleanly when webhook upserts by `shopifyCustomerId`
- **GIN index on `anon_ids`** — required for array `@>` containment queries; enables Phase 3 "find customer by anon_id" reverse lookup
- **`currentScript` captured synchronously in SDK IIFE** — `document.currentScript` is null after script execution; must capture before DOMContentLoaded fires
- **CORS `*` on SDK endpoints** — called cross-origin from any Shopify store domain; rate-limited to prevent abuse

- **pnpm workspaces + Turborepo** for monorepo tooling (over Nx)
- **Remix v2 + Vite** for frontend (over Next.js)
- **Prisma** for PostgreSQL ORM (over Drizzle)
- **Branded types** (`MerchantId`, `CustomerId`, `UserId`) in `packages/shared` for type-level tenant safety
- ClickHouse events table uses `TTL timestamp + INTERVAL 2 YEAR` to cap storage costs
- All env vars validated with Zod at startup; missing required vars cause `process.exit(1)`
- **Decimal(12,2)** for all PKR monetary fields; **Float** for scores (churn 0–1, fake order 0–100)
- **Json columns** for `conditions`, `triggerConfig`, `content`, `config` — flexible, owned by later phases
- **Soft-delete for segment membership** — `exitedAt` nullable preserves history for analytics
- **Agency self-relation** on `Merchant` — single table, `agencyId` FK points to parent merchant
- **ClickHouse ORDER BY uses `coalesce(customer_id, '')`** — MergeTree disallows `Nullable` sort keys without `allow_nullable_key`; coalescing to empty string preserves query performance
- **ClickHouse DateTime64 formatting** — params must strip trailing `Z`; results must append `Z` before `new Date()` parse to enforce UTC
- **`pingClickHouse()` uses a `default`-db bootstrap client** — avoids chicken-and-egg error on fresh server where `engageiq` db doesn't exist yet
- **`insertEvent` has `waitForInsert` option** — production uses async fire-and-forget; tests force synchronous flush via `{ waitForInsert: true }`
- **JWT access (1h) + refresh (7d)** using `@fastify/jwt`; refresh token uses separate secret via per-call `key` override — no extra `jose` dependency
- **bcryptjs for passwords and API keys** — rounds=12 balances security and latency
- **API keys format** `eiq_<randomBytes(32).hex>` (68 chars); first 12 chars stored as `keyPrefix` for indexed DB lookup before bcrypt compare
- **No Shopify SDK** — OAuth + webhooks implemented with Node.js `crypto` + native `fetch`; zero extra deps
- **`fastify-raw-body` with `encoding: false`, `global: false`** — webhook route opts in via `config: { rawBody: true }`; Buffer needed for HMAC; selective use saves memory
- **OAuth state in Redis, 10min TTL, one-time use** — standard CSRF protection; Redis already in stack
- **BullMQ `jobId = shopifyWebhookId`** — automatic deduplication when Shopify retries webhook delivery
- **`processOrderUpsert` extracted from `processOrder`** — writes Order + CodOrder to DB without recalculating aggregates; used by backfill to do batch aggregate recalc at the end; webhook pipeline uses `processOrder` unchanged
- **Backfill progress in Redis hash `backfill:progress:{merchantId}`** — 7-day TTL; `GET /backfill/status` falls back to DB `backfillCompletedAt` if key expired
- **Backfill job dedup via `jobId = merchantId`** — prevents duplicate jobs if OAuth callback is retried
- **Batch aggregate recalculation after backfill** — collects unique `customerId` set during orders phase, calls `recalculateCustomerAggregates` once per customer instead of once per order

---

> This file must be updated at the end of every milestone. See roadmap.md for instructions.
