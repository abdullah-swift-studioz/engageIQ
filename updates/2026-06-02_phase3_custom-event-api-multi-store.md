# Update: Custom Event API & Multi-Store Unification

**Date:** 2026-06-02
**Phase:** 3 | **Milestone:** 3.3
**Author:** Claude Code (Session)

## What Was Built

### P1 Bug Fix (`apps/api/src/processors/customer.processor.ts`)
Before the Prisma upsert, checks for a stub customer (email match, no shopifyCustomerId, not merged).
If found, upgrades the stub in place by setting shopifyCustomerId + all fields via prisma.customer.update. Returns the stub ID.
Prevents the @@unique([merchantId, email]) constraint violation that was silently swallowing errors.

### Custom Event API (`apps/api/src/routes/events/`)
- `POST /api/v1/events` — authenticated by merchant API key (existing authenticateApiKey plugin)
- Accepts: event_name, optional customer_id, optional anon_id, properties (any JSON), optional timestamp
- Validates customer_id ownership (returns 404 if not found for merchant)
- Ingests to ClickHouse via insertEvents() — same table as SDK events, queryable in segment builder
- Rate limit: 1000 requests/minute; HTTP 201 on success
- Plan-based rate limiting (1000 events/sec for Growth) deferred to Phase 4

### Multi-Store Unification (`apps/api/src/services/multi-store.service.ts`)
- `assignGroupCustomerId(customerId, merchantId, email, phone)` — walks the Merchant agency tree
  (agencyId self-relation), searches sibling stores for matching email/phone, assigns a shared
  groupCustomerId UUID to link cross-store profiles. No-op for standalone merchants.
- `getGroupMembers(groupCustomerId, requestingMerchantId)` — returns GroupMember[] scoped to
  merchants in the requesting merchant's agency group.
- Wired fire-and-forget into customer.processor.ts (stub upgrade path + upsert path) and
  identity.service.ts (stub creation).

### Group Profile API
- `GET /api/v1/customers/:id/group` — returns GroupMember[] for the customer's cross-store group.
  Returns [] if no groupCustomerId set. Protected by JWT auth.

### Remix UI
- Customer detail page: "Cross-Store Presence" section (Section 12) shows all group members with
  store name, order count, total spent, and link to their profile. Only renders when group exists.

## Files Created / Modified

- `apps/api/src/processors/customer.processor.ts` — P1 fix + assignGroupCustomerId fire-and-forget
- `apps/api/src/processors/customer.processor.test.ts` — NEW (3 tests)
- `apps/api/src/routes/events/schema.ts` — NEW
- `apps/api/src/routes/events/service.ts` — NEW
- `apps/api/src/routes/events/service.test.ts` — NEW (5 tests)
- `apps/api/src/routes/events/controller.ts` — NEW
- `apps/api/src/routes/events/index.ts` — NEW
- `apps/api/src/services/multi-store.service.ts` — NEW
- `apps/api/src/services/multi-store.service.test.ts` — NEW (7 tests)
- `apps/api/src/services/identity.service.ts` — assignGroupCustomerId wire on stub create
- `apps/api/src/routes/customers/schema.ts` — GetGroupParamsSchema added
- `apps/api/src/routes/customers/controller.ts` — getGroupHandler added, prisma static import added
- `apps/api/src/routes/customers/index.ts` — GET /:id/group registered before /:id
- `apps/api/src/index.ts` — eventsRoutes registered at /api/v1/events
- `packages/shared/src/types.ts` — CustomEventPayload, GroupMember
- `packages/shared/src/index.ts` — exports
- `apps/web/app/routes/customers.$id.tsx` — Cross-Store Presence section (Section 12)

## Decisions Made This Session

- **Stub upgrade vs merge for P1 fix** — upgrading in place (prisma.customer.update) is simpler and
  correct. The stub IS the customer — there is nothing to merge. No separate Shopify record exists yet
  at the time the processor runs.
- **Single-event Custom Event API (not batch)** — server-side callers send one event at a time;
  batching can be added in Phase 4 if needed.
- **HTTP 201 for POST /api/v1/events** — event ingestion creates a new resource; 201 is correct.
- **Agency-scoped group unification** — cross-store linking only within the same agency tree to
  prevent data leakage between unrelated merchants sharing a customer email.
- **No plan-based rate limiting yet** — 1000 events/sec Growth target deferred to Phase 4.

## Deviations from Roadmap

- None — all Milestone 3.3 deliverables complete.

## Known Issues Left Open

- Plan-based rate limiting (1000 events/sec for Growth) deferred to Phase 4.
- Group aggregate totals across all stores (combined revenue, combined orders) deferred to Phase 9 analytics.
- Remix web build has a pre-existing failure in root.tsx (tailwind.css?url Vite resolution) — not introduced by this milestone.

## What to Do Next

Phase 4.1 — Segment Builder:
- Dynamic segments with condition trees (RFM, behavioral, custom event properties)
- Segment evaluation engine
- GET /api/v1/segments CRUD
