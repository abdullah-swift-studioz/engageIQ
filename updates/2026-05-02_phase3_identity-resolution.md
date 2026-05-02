# Update: Identity Resolution

**Date:** 2026-05-02
**Phase:** 3 | **Milestone:** 3.2
**Author:** Claude Code (Session)

## What Was Built

### Shared Types (`packages/shared/src/types.ts`)

Added `MergeResult` interface:
- `canonicalId` — the profile that survives
- `secondaryId` — the profile marked as merged
- `mergedAt` — ISO timestamp string
- `mergeReason` — e.g. `"manual_dashboard_merge"`, `"sdk_login_shopify_id_match"`

Exported from `packages/shared/src/index.ts`.

### Merge Service (`apps/api/src/services/merge.service.ts`)

`mergeCustomers(merchantId, id1, id2, mergeReason?)`:
- **Validation:** rejects same-ID merge, missing customers, already-merged customers
- **Canonical determination:** older `createdAt` wins; tie → `id1` is canonical
- **Single Prisma transaction:**
  1. Deduplicates `SegmentMembership` — deletes secondary's memberships that overlap with canonical's active memberships before migrating the rest
  2. Deduplicates `JourneyEnrollment` — same pattern for ACTIVE enrollments
  3. Migrates `Order`, `CodOrder`, `AbandonedCheckout` (simple updateMany, no conflict risk)
  4. Merges `anonIds` as a deduplicated union onto canonical
  5. Marks secondary: `mergedIntoId = canonicalId`, `mergedAt = now`
- **Structured log** after transaction: `{ event: "customer_merge", merge_reason, canonical_id, merged_id, merchant_id, timestamp }`
- Error strings: `MERGE_SAME_CUSTOMER`, `CUSTOMER_NOT_FOUND`, `CUSTOMER_ALREADY_MERGED`

### Merge API Route

- `apps/api/src/routes/customers/schema.ts` — Added `MergeCustomersBodySchema` (`customerId1`, `customerId2` both `.cuid()`) and `MergeCustomersBody` type
- `apps/api/src/routes/customers/controller.ts` — Added `mergeCustomersHandler`: parses body, calls `mergeCustomers`, maps error strings to 400/404/409, 500 for unknown
- `apps/api/src/routes/customers/index.ts` — Registered `POST /merge` before `GET /:id` to avoid param wildcard conflict

### Enhanced Identity Stitching (`apps/api/src/services/identity.service.ts`)

When `stitchIdentity` is called with a `shopify_customer_id` that resolves to profile B:
1. Queries Prisma for any other profile where `anonIds contains anon_id AND id != B.id AND mergedIntoId = null`
2. If a stub (profile A) is found, calls `mergeCustomers(merchant_id, A.id, B.id, 'sdk_login_shopify_id_match')`
3. Returns the canonical ID (whichever profile is older)
4. Merge errors are silently swallowed — the identify call falls through to the normal anon_id update path

Also exported `normalizePhone` as a named export (was previously private).

### Profile Service Update (`apps/api/src/routes/customers/service.ts`)

`fetchEventStats` now takes a fourth parameter `mergedFromIds: string[]`. When non-empty, the ClickHouse query adds `OR has({mergedFromIds:Array(String)}, customer_id)` to the WHERE clause — ensuring events stored under a secondary (merged) customer ID are included in the canonical profile's event stats.

In `getCustomerProfile`, before calling `fetchEventStats`:
```typescript
const mergedFromCustomers = await prisma.customer.findMany({
  where: { mergedIntoId: customerId, merchantId },
  select: { id: true },
})
const mergedFromIds = mergedFromCustomers.map(c => c.id)
```

### Remix Merge UI

**`apps/web/app/routes/customers.$id.tsx`** (modified):
- Shows a yellow-bordered "This profile has been merged into [canonical ID]" notice when `mergedIntoId !== null`
- Adds a "Merge with another profile" link near the header (suppressed if already merged)

**`apps/web/app/routes/customers.$id_.merge.tsx`** (new):
- Standalone route at `/customers/:id/merge` (no layout inheritance — `_` escape)
- **Loader:** reads `?search=` and `?targetId=` URL params; fetches base customer, search results (filtered to exclude base), selected target
- **Action:** POSTs `{ customerId1, customerId2 }` to `POST /api/v1/customers/merge`; redirects to `/customers/[canonicalId]` on success
- **Three UI states (no client JS):** Search → Confirm (side-by-side profile comparison + canonical determination preview) → Error

### Tests

- `apps/api/src/services/merge.service.test.ts` — 10 new tests: canonical determination, relation migration, anonId dedup, secondary marking, MergeResult shape, all three error cases, SegmentMembership conflict dedup
- `apps/api/src/routes/customers/service.test.ts` — Fixed 3 existing tests that broke because `getCustomerProfile` now calls `prisma.customer.findMany` (merged-from lookup) — added `mockResolvedValue([])` default in `beforeEach`
- **21/21 tests passing**

## Files Created / Modified

- `packages/shared/src/types.ts` — Added `MergeResult` interface
- `packages/shared/src/index.ts` — Exported `MergeResult`
- `apps/api/src/services/merge.service.ts` — NEW
- `apps/api/src/services/merge.service.test.ts` — NEW
- `apps/api/src/services/identity.service.ts` — Auto-merge on SDK login + exported `normalizePhone`
- `apps/api/src/routes/customers/schema.ts` — Added `MergeCustomersBodySchema`
- `apps/api/src/routes/customers/controller.ts` — Added `mergeCustomersHandler`
- `apps/api/src/routes/customers/index.ts` — Registered `POST /merge`
- `apps/api/src/routes/customers/service.ts` — `fetchEventStats` extended with `mergedFromIds`; `getCustomerProfile` does merged-from lookup
- `apps/api/src/routes/customers/service.test.ts` — Fixed 3 existing tests
- `apps/web/app/routes/customers.$id.tsx` — Merge button + merged-status notice
- `apps/web/app/routes/customers.$id_.merge.tsx` — NEW merge workflow page

## Decisions Made This Session

- **Auto-merge confirmed by Abdullah** — when `stitchIdentity` detects `shopify_customer_id → profile B` and `anon_id → stub profile A`, merge immediately. Reasoning: 100% certainty of same person at login; split profiles break RFM/segments for the most engaged customers.
- **Reverse lookup for ClickHouse merged-from IDs** — instead of adding a `mergedFromIds String[]` field to the Customer model (schema change + migration), do `prisma.customer.findMany({ where: { mergedIntoId: canonicalId } })` at profile fetch time. No migration needed.
- **Merge errors silent in stitchIdentity** — merge failures don't fail the identify call; the anon_id is still linked via the normal update path. Avoids breaking SDK identify on transient DB errors.
- **POST /merge registered before GET /:id** — Fastify would otherwise route `/merge` as a `:id` param match.

## Deviations from Roadmap

- None — all deliverables from Milestone 3.2 spec are complete.

## Known Issues Left Open

- **Webhook processor doesn't auto-merge stubs** — when Shopify `customers/create` webhook arrives for a customer whose email already exists as a stub, the upsert-by-shopifyCustomerId creates a second record (which then fails the `@@unique([merchantId, email])` constraint). The `stitchIdentity` path covers the SDK login case; the webhook path requires a similar merge check in `customer.processor.ts`. Deferred to Phase 3.3 or a follow-up fix.
- **Merge history not surfaced in dashboard** — the merge log is written to stdout (structured JSON). A dedicated merge history view on the customer profile (showing all merge events with timestamps and reasons) is not yet built. The data is available by querying `mergedIntoId` / log aggregation.
- **No un-merge capability** — the dashboard UI does not yet support un-merging. The secondary record is preserved (soft merge) so un-merge is possible via a future admin action.

## What to Do Next

Milestone 3.3 — Custom Event API & Multi-Store Unification:
- `POST /api/v1/events` authenticated by merchant API key
- Accept any JSON properties; queryable in segment builder
- Rate limit: 1,000 events/sec on Growth plan
- Multi-store: match customers across stores by email + phone; `group_customer_id` assignment; group-level analytics views
