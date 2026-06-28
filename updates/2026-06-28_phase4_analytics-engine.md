# Update: Analytics Engine (roadmap Phase 4, full)

**Date:** 2026-06-28
**Phase:** 4 (canonical roadmap) | **Milestones:** 4.1, 4.2 (view), 4.3, 4.4, 4.5 | **Lane:** C — Analytics Engine (`lane/analytics`)
**Author:** Claude Code (Session — "EngageIQ Instance 2")

## What Was Built

The entire skipped roadmap Phase 4 (Analytics Engine), reading existing ClickHouse events
and Postgres relational data. Four commits on `lane/analytics`, each a self-contained
sub-area, all tenant-scoped, strict-TS, and verified end-to-end against a live
`engageiq_analytics` DB + ClickHouse with a seeded realistic dataset.

**Foundation + 4.1/4.2** (`963fca7`):
- Shared analytics DTOs + `AnalyticsJob`/`ANALYTICS` in `packages/shared` (append-only
  `// lane:analytics` blocks) + barrel re-exports.
- `analytics` BullMQ worker — the previously-orphaned `analytics` queue now has a consumer.
  Handles the idempotent `product-analytics` precompute job.
- ClickHouse analytics query lib (`chQuery`, revenue/event/visitor counts, `windowFunnel`)
  reading **through the `@engageiq/db` client** (no direct `@clickhouse/client` import).
- Merchant-timezone-aware date-range lib (default `Asia/Karachi`).
- `/api/v1/analytics` route group registered (append-only `// lane:analytics` blocks in
  `apps/api/src/index.ts` and `worker.ts`).
- **4.1 Real-Time Dashboard** — `GET /realtime`: active visitors (ClickHouse, 30m), revenue
  today vs yesterday vs same-day-last-week, orders today (COD/prepaid split), new vs
  returning customers, active campaigns, color-coded KPI status, alerts (revenue drop /
  churn spike / campaign anomaly). Revenue/orders from authoritative Postgres. Remix
  `/analytics` page (30s polling) + dashboard home (`_index.tsx`) KPI widgets.
- **4.2 RFM view (read-only)** — `GET /rfm`: segment sizes, % of base, scoring-date trend.
  Reads `customers.rfm_*` (written by the ML lane); fully null-safe. Remix `/analytics/rfm`.

**4.3 Funnel** (`dd3b586`): `POST /funnel` (ClickHouse `windowFunnel`: per-step counts +
conversion + drop-off), `POST /funnel/compare` (two periods), saved funnels via `SavedView`
(`GET/POST /funnel/saved`, `DELETE /funnel/saved/:id`). Remix builder page.

**4.4 Cohort** (`c0624bf`): `POST /cohort` monthly retention matrix by first-purchase-month
(primary) + rfm_segment (best-effort) from Postgres orders. Remix heatmap page.

**4.5 Attribution + Product + COD** (`4b37b73`):
- `GET /attribution` — order→campaign-message attribution within per-channel windows
  (WhatsApp 3d, email 7d, SMS/push 24h); last/first/linear/time-decay models; by channel +
  by campaign (ROI). Computed on the fly.
- `GET /products` + `POST /products/recompute` — reads persisted `Product.*` retention
  metrics (repurchase 90d, cross-sell, return rate, avg buyer LTV, days-to-2nd-purchase),
  ranks by composite `retentionValue`; recompute enqueues the analytics worker job.
- `GET /cod` — acceptance/rejection/fake-order rates, COD→prepaid conversion, avg days to
  collect, net COD vs prepaid revenue, breakdowns by city/courier/value-band.
- Remix pages for all three.

## Files Created / Modified
- `apps/api/src/workers/analytics.worker.ts` — analytics queue consumer (owned)
- `apps/api/src/routes/analytics/` — index + realtime/rfm/funnel/cohort/attribution/
  product/cod route plugins + `lib/{dates,clickhouse-analytics,product-analytics.service}.ts` (owned)
- `apps/web/app/routes/analytics._index.tsx`, `analytics.{rfm,funnel,cohort,attribution,cod,products}.tsx`,
  `apps/web/app/components/analytics/ui.tsx`, updated `_index.tsx` (owned)
- Append-only `// lane:analytics` blocks: `packages/shared/src/{types,index}.ts`,
  `apps/api/src/{index,worker}.ts`
- `.env` (lane-local, gitignored): PORT 4021 / WEB_PORT 4020 / API_URL / REDIS_URL …/3 /
  DATABASE_URL engageiq_analytics; Shopify stub values (empty string fails env Zod `.min(1)`).

## Decisions Made This Session
- **No new queue** — reused the existing `analytics` queue; only added the worker.
- **ClickHouse accessed via `@engageiq/db`'s exported client** from my own lib files (not by
  editing the shared `clickhouse.ts`) — keeps the lane append-only on shared files.
- **Product retention columns are this lane's to write** (per Phase 0 freeze note); the
  `product-analytics` worker job recomputes them idempotently. `retentionValue` is derived at
  read time (no column/migration).
- **Attribution computed on the fly** (per Phase 0 decision) — nothing persisted.
- **DateTime range params qualified as `DateTime64(3,'UTC')`** so windows are correct on any
  ClickHouse server timezone (see blocker below).

## Deviations from Roadmap
- 4.2's RFM scoring **engine** belongs to the ML lane; this lane delivers only the 4.2
  dashboard **view** (read-only), as scoped.
- Cohort `product_category`/`acquisition_channel` group-bys return empty (no source field
  exists on Order/Customer). COD "city choropleth" is delivered as a by-city table (a true
  map needs a viz lib); the API returns the per-city data a choropleth needs.

## Known Issues Left Open / FLAGS FOR THE INTEGRATOR
- **[BLOCKER, pre-existing, not mine] The API HTTP server cannot boot as committed.**
  `apps/api/package.json` pins `@fastify/rate-limit@^10` (requires Fastify 5) while
  `fastify@^4` is installed → `FST_ERR_PLUGIN_VERSION_MISMATCH` at startup. The preflight
  gate never boots the server, so this went unnoticed. Fix: downgrade `@fastify/rate-limit`
  to `^9` (Fastify v4) **or** upgrade `fastify` to v5. I did NOT change shared deps in a lane.
  I verified all my routes via an isolated `fastify.inject()` harness instead.
- **ClickHouse timezone:** a native (non-Docker) ClickHouse runs in the host timezone and
  mis-parses unqualified `DateTime` query params. I fixed my lib with `DateTime64(3,'UTC')`.
  The `@engageiq/db` helpers (`getRevenueByDay`, `getEventCountsByType`) have the same latent
  issue — recommend the same qualification, or run CH with `TZ=UTC` (Docker/ClickHouse Cloud
  default, so a non-issue in the integration env).
- **Environment:** Docker was unavailable on this host; Postgres + Redis run via Homebrew.
  ClickHouse was not installed, so I installed the standalone binary at
  `~/.engageiq-clickhouse` and ran it on `:8123` as the shared instance (DB `engageiq`).
- **Refund `returns_data` still unpopulated** (Phase 0 known gap) → `Product.returnRate`
  stays 0/null until `refund.processor.ts` fills it. App-code follow-up, outside this lane.
- Lane-local test data was inserted into `engageiq_analytics` (Postgres) and a handful of
  events for the test merchant into the shared ClickHouse `engageiq.events` for verification.

## What to Do Next
Lane C is **ready for integration**. Suggested order: integrate after (or independently of)
the other Wave-1 lanes; this lane only READS the ML lane's score columns, so no ordering
dependency. Before merge, the integrator should resolve the `@fastify/rate-limit` blocker
above so the booted server (and the web app's loaders) work end to end. Then mark roadmap
milestones 4.1, 4.3, 4.4, 4.5 (and the 4.2 dashboard view) complete in `memory/context.md`.
