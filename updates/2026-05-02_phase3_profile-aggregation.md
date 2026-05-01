# Update: Profile Aggregation & Real-Time Updates

**Date:** 2026-05-02
**Phase:** 3 | **Milestone:** 3.1
**Author:** Claude Code (Session)

## What Was Built

### Shared Types (`packages/shared/src/types.ts`)

Added `EnrichedCustomerProfile` and supporting types:
- `CustomerSegmentMembership`, `CustomerJourneyEnrollment`, `CustomerRecentOrder`, `CustomerRecentCheckout`, `CustomerEventStats`
- All exported from `packages/shared/src/index.ts`

### Profile API (`apps/api/src/routes/customers/`)

- `schema.ts` — Zod schemas: `GetCustomerParamsSchema`, `GetCustomersQuerySchema`, `CustomerListItemSchema`
- `service.ts` — Two exported functions:
  - `getCustomerProfile(merchantId, customerId)` — fetches full customer from PostgreSQL (with segmentMemberships, journeyEnrollments, orders, abandonedCheckouts via Prisma include), queries ClickHouse for event stats (page_view/add_to_cart/checkout_started counts + distinct session_count by customer_id OR anon_ids array), assembles and returns `EnrichedCustomerProfile`. ClickHouse failure returns zero stats — never fails the full request.
  - `listCustomers(merchantId, opts)` — paginated list with optional case-insensitive OR search, using `prisma.$transaction([findMany, count])`
- `controller.ts` — Request/response handlers; maps `CUSTOMER_NOT_FOUND` → 404, all other errors → 500; standard `{ success, data, meta?, error }` envelope
- `index.ts` — Fastify plugin; `onRequest: fastify.authenticate` hook; GET `/` and GET `/:id`

### Route Registration

`apps/api/src/index.ts` — Added `customersRoutes` at prefix `/api/v1/customers`

### Real-time Profile Sync (`apps/api/src/services/profile-sync.service.ts`)

- `syncSessionCount(merchantId, customerId, anonIds)` — queries ClickHouse `uniqExact(session_id)`, updates `customers.session_count` in PostgreSQL; fire-and-forget (never throws)
- `recalculateCodProfile(merchantId, customerId)` — reads all `cod_orders` for customer, computes `codOrderCount`, `codAcceptanceRate` (DELIVERED/total), `codRejectionRate` ((RETURNED+CANCELLED)/total); fire-and-forget

### SDK Route Update (`apps/api/src/routes/sdk.ts`)

After the existing `lastSeenAt` update, added non-blocking loop: for each `customer_id` seen in the event batch, looks up `anonIds` from PostgreSQL and calls `syncSessionCount`.

### Order/Refund Processor Updates

- `apps/api/src/processors/order.processor.ts` — After `recalculateCustomerAggregates`, non-blocking `recalculateCodProfile` call when order is COD and customer is known
- `apps/api/src/processors/refund.processor.ts` — Same non-blocking `recalculateCodProfile` call after refund processing

### Remix Dashboard (`apps/web/app/routes/`)

- `customers._index.tsx` — Customer list page; fetches `GET /api/v1/customers`; table with 8 columns (name, email, phone, orders, spent, RFM segment, churn risk, last seen); empty/error states
- `customers.$id.tsx` — Full customer detail page; 11 sections covering every `EnrichedCustomerProfile` field: Header, Shopify Stats, Behavioral, RFM Scores, AI Scores, COD Profile, Channel Opt-ins, Segment Memberships, Journey Enrollments, Recent Orders, Abandoned Checkouts
- `apps/web/app/root.tsx` — Added nav bar with Customers link

### Tests

- `apps/api/src/routes/customers/service.test.ts` — 6 tests: full profile assembly, 404 on missing customer, ClickHouse fallback to zeros, Decimal serialization, paginated list, search filter
- `apps/api/src/services/profile-sync.service.test.ts` — 5 tests: COD rate calculation, null rates on empty, no-throw on DB error, session count update, no-throw on ClickHouse failure
- `apps/api/vitest.config.ts` — Vitest config created; `vitest` added to `apps/api` devDependencies
- **All 11 tests pass**

## Files Created / Modified

- `packages/shared/src/types.ts` — Added `EnrichedCustomerProfile` and 5 supporting types
- `packages/shared/src/index.ts` — Exported new types
- `apps/api/src/routes/customers/schema.ts` — NEW
- `apps/api/src/routes/customers/service.ts` — NEW
- `apps/api/src/routes/customers/controller.ts` — NEW
- `apps/api/src/routes/customers/index.ts` — NEW
- `apps/api/src/routes/customers/service.test.ts` — NEW
- `apps/api/src/services/profile-sync.service.ts` — NEW
- `apps/api/src/services/profile-sync.service.test.ts` — NEW
- `apps/api/vitest.config.ts` — NEW
- `apps/api/package.json` — Added `vitest` devDependency + test scripts
- `apps/api/src/index.ts` — Registered `customersRoutes` at `/api/v1/customers`
- `apps/api/src/routes/sdk.ts` — Added non-blocking `syncSessionCount` trigger
- `apps/api/src/processors/order.processor.ts` — Added non-blocking `recalculateCodProfile` trigger
- `apps/api/src/processors/refund.processor.ts` — Added non-blocking `recalculateCodProfile` trigger
- `apps/web/app/root.tsx` — Added nav bar
- `apps/web/app/routes/customers._index.tsx` — NEW
- `apps/web/app/routes/customers.$id.tsx` — NEW

## Decisions Made This Session

- **ClickHouse event stats merged into profile API response** (not a separate endpoint) — single round-trip for the dashboard; ClickHouse failure returns zeros rather than 500, keeping the profile page always available
- **`syncSessionCount` and `recalculateCodProfile` are fire-and-forget** — these update derived stats that can tolerate brief staleness; making them synchronous would add latency to every webhook and SDK event
- **`prisma.$transaction([findMany, count])`** for list pagination — single round-trip for data + count
- **`EnrichedCustomerProfile` uses string for Decimal fields** — JSON doesn't support arbitrary precision; `.toString()` on Prisma Decimal preserves exactness

## Deviations from Roadmap

- None — all deliverables from Milestone 3.1 spec are complete.

## Known Issues Left Open

- The Remix pages use `process.env.DEV_TOKEN` for auth — a real session/cookie-based auth flow for the dashboard is deferred (no milestone has specified it yet; Phase 3.2+ will need it for the merge UI)
- `syncSessionCount` makes a PostgreSQL `findFirst` on every SDK event batch to look up `anonIds` — this is a small N+1 for each distinct customer in the batch. Acceptable for current scale; can be batched in Phase 4 if needed.

## What to Do Next

Milestone 3.2 — Identity Resolution:
- Email match: anon session → known profile on email capture
- Phone match: normalized E.164
- Shopify `customer_id` match on login
- Explicit merge UI in dashboard
- Conflict resolution: older profile becomes canonical; all events/orders migrated; secondary marked `merged_into`
