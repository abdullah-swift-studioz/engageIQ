# Phase 2 — Milestone 2.3: Historical Backfill

**Date:** 2026-04-29
**Status:** Complete

## What Was Built

### Files Created

- `apps/api/src/services/shopify-admin.service.ts` — Shopify Admin REST API client:
  - `fetchCustomerCount` and `fetchOrderCount` — count endpoints for progress calculation
  - `fetchAllCustomers` and `fetchAllOrders` — cursor-paginated, callback per page
  - Rate-limit-aware: reads `X-Shopify-Shop-Api-Call-Limit` header, sleeps 500ms when bucket is ≥80% full; auto-retries with `Retry-After` delay on 429 responses
  - Pagination via Shopify `Link` header `page_info` cursor (not page numbers — Shopify deprecated those)

- `apps/api/src/workers/backfill.worker.ts` — BullMQ Worker on `backfill` queue:
  - Phase 1: Count + fetch all customers (calls `processCustomerUpsert` per customer)
  - Phase 2: Count + fetch all orders back 2 years (calls `processCustomerUpsert` for embedded customer + `processOrderUpsert` without aggregate recalc)
  - Phase 3: Batch `recalculateCustomerAggregates` for all unique customer IDs touched during orders phase — avoids N² DB queries compared to per-order recalculation
  - Progress tracked in Redis hash `backfill:progress:{merchantId}` with 7-day TTL
  - BullMQ `job.updateProgress()` called per page for dashboard polling
  - Sets `merchant.backfillCompletedAt` on success; idempotent (skips if already set)
  - Error state written to Redis on failure for dashboard display

- `apps/api/src/routes/backfill.ts` — Two routes:
  - `GET /backfill/status` (JWT auth) — returns `BackfillProgress` from Redis, falls back to DB `backfillCompletedAt` if Redis key expired, returns `pending` if store connected but never started
  - `POST /backfill/trigger` (OWNER/ADMIN only) — resets `backfillCompletedAt`, clears Redis key, re-enqueues; useful for retries and testing

### Files Modified

- `apps/api/src/processors/order.processor.ts` — Extracted `processOrderUpsert(merchantId, payload, customerId)` from `processOrder`. The new function writes Order + CodOrder records without recalculating aggregates. `processOrder` now calls `processOrderUpsert` then `recalculateCustomerAggregates` (behaviour unchanged for webhook pipeline).

- `packages/shared/src/types.ts` — Added `BackfillJobData`, `BackfillStatus`, `BackfillProgress` types.

- `packages/shared/src/index.ts` — Exported the three new types.

- `apps/api/src/routes/shopify.ts` — OAuth callback now imports `backfillQueue` and enqueues a backfill job (`jobId = merchantId`) immediately after `registerWebhooks`, only if `merchant.backfillCompletedAt` is null. The `upsert` now selects `id` and `backfillCompletedAt` to enable this check.

- `apps/api/src/worker.ts` — Added `createBackfillWorker()` alongside webhook worker; logs `completed`, `failed`, `error`, and `progress` events; graceful shutdown closes both workers.

- `apps/api/src/index.ts` — Registered `backfillRoutes` at prefix `/backfill`.

## Decisions Made

| Decision | Rationale |
|---|---|
| Batch aggregate recalculation (not per-order) | Per-order recalculation = N × 4 DB queries; for a 50K-order merchant that's 200K queries. Collecting unique customerIds and recalculating once each reduces this to C × 4 queries (C = distinct customers, typically much smaller than N) |
| `processOrderUpsert` extracted from `processOrder` | Enables backfill to skip per-order aggregate calc without duplicating DB logic; webhook pipeline behaviour unchanged |
| Redis for progress tracking (not a new DB table) | Progress is ephemeral and high-write — updating a hash field per page is trivial in Redis, would be heavy in PostgreSQL. TTL of 7 days provides plenty of time for the dashboard to read it |
| `backfillQueue.add(..., { jobId: merchantId })` | BullMQ deduplicates by jobId — prevents duplicate jobs if OAuth callback is retried or trigger endpoint called multiple times |
| `POST /backfill/trigger` resets `backfillCompletedAt` | Makes it possible to re-run backfill (e.g., after a data loss event or failed run) without needing direct DB access |
| 2-year lookback for orders | Per milestone spec; `created_at_min` computed at job start time |
| API version pin `2024-01` | Consistent with existing `shopify.service.ts` webhook registration |
| Rate limit threshold 80% of bucket | Leaves 20% headroom for concurrent webhook traffic; avoids hitting the ceiling during backfill |

## Known Issues / Deviations

- `fetchAllCustomers` uses the basic `customers.json?limit=250` without `updated_at_min` — fetches all customers regardless of when they were created. Appropriate for initial backfill; a future incremental sync could add a `created_at_min` filter.
- `fetchOrderCount` and `fetchAllOrders` use `status=any` — includes cancelled orders. Cancelled orders are correctly handled by `processOrderUpsert` (the `cancelledAt` field is set) and excluded from aggregate calculations in `recalculateCustomerAggregates` (where clause: `cancelledAt: null`).
- Progress `customersTotal` / `ordersTotal` from the count endpoints may drift slightly from actual page results if Shopify adds/removes records during the backfill window (this is an inherent limitation of the paginated approach, not a bug).
- The `recalculating` phase progress is reported as 95% — there is no per-customer progress update during this phase to keep it simple. For merchants with very large customer bases this phase may appear "stuck" at 95% for a while.

## Next Milestone

2.4 — Storefront Event Tracking SDK
