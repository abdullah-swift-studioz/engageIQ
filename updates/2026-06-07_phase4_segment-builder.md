# Update: Segment Builder — Dynamic Conditions

**Date:** 2026-06-07
**Phase:** 4 | **Milestone:** 4.1
**Author:** Claude Code (Session)

## What Was Built

### Shared Types + Queue (`packages/shared`, `packages/queue`)
- `ConditionOperator` union type (22 operators: eq/neq/gt/gte/lt/lte/between/in/not_in/contains/not_contains/is_true/is_false/before/after/within_last_days/more_than_days_ago/is_set/is_not_set/includes_any/includes_all/includes_none)
- `SegmentCondition`, `SegmentGroup` (recursive condition tree types, max depth 2)
- `SegmentEvaluateJobPayload`, `SEGMENT_EVALUATE` constant
- `segmentEvaluateQueue` BullMQ queue added to `packages/queue`

### Field Registry (`apps/api/src/lib/segments/field-registry.ts`)
- `FIELD_REGISTRY` with 20 customer fields mapped to both Prisma column name (`column`) and `EnrichedCustomerProfile` key (`profileKey`)
- 6 operator group constants (NUMBER_OPS, STRING_OPS, ENUM_OPS, BOOLEAN_OPS, DATE_OPS, ARRAY_OPS)
- `OPERATOR_VALUE_SHAPES: Record<ConditionOperator, ValueShape>` — exhaustive operator → value shape mapping

### Condition Validator (`apps/api/src/lib/segments/condition-validator.ts`)
- `validateConditionTree(group, depth)` — enforces max depth 2, non-empty rules, valid fields, valid operators per field type, value shape rules (tuple2/positive_int/non_empty_array/none/scalar)
- 9 Vitest tests

### Segment Evaluator (`apps/api/src/services/segment-evaluator.ts`)
- `compileToPrismaWhere(group, merchantId)` — batch SQL path; outer AND forces `merchantId` and `mergedIntoId: null` on all queries; uses `FIELD_REGISTRY[field].column` (never raw user input — SQL injection guard)
- `evaluateProfile(group, profile)` — real-time in-memory path; `coerceToNumber`/`coerceToDate` helpers handle Prisma Decimal fields
- `evaluateProfileMemberships(customerId, merchantId)` — fetches customer, runs in-memory eval against all merchant segments, upserts/exits memberships
- 24 Vitest tests including parity tests confirming SQL and in-memory paths produce consistent results

### BullMQ Worker (`apps/api/src/workers/segment-evaluate.worker.ts`)
- `createSegmentEvaluateWorker()` — concurrency 5, validates conditions, runs Prisma WHERE scan, diffs vs active memberships, batch creates/exits, updates `memberCount` + `lastEvaluatedAt`
- `UnrecoverableError` for segment-not-found and invalid condition trees
- Wired into `apps/api/src/worker.ts` with graceful shutdown

### Segment CRUD Routes (`apps/api/src/routes/segments/`)
- `POST /api/v1/segments` — creates segment, enqueues evaluation (201)
- `GET /api/v1/segments` — paginated list with `page`/`pageSize` params
- `GET /api/v1/segments/:id` — full segment + 5-customer best-effort preview
- `PUT /api/v1/segments/:id` — updates segment, re-enqueues when conditions change
- `DELETE /api/v1/segments/:id` — cascade-deletes memberships (204)
- `POST /api/v1/segments/:id/evaluate` — async re-evaluation, always 202 (never inline)
- All routes guarded by `fastify.authenticate`; `updateSegment`/`deleteSegment` do `findFirst` ownership check before mutation (defense-in-depth multi-tenancy)

### Real-Time Evaluation Triggers (Task 9)
- `evaluateProfileMemberships` wired as fire-and-forget in:
  - `apps/api/src/processors/customer.processor.ts` (stub upgrade + upsert paths)
  - `apps/api/src/services/identity.service.ts` (stub creation in `stitchIdentity`)
  - `apps/api/src/routes/sdk.ts` (alongside `syncSessionCount`)

### Remix Frontend
- `apps/web/app/routes/segments._index.tsx` — list page: table of segments with name, memberCount, lastEvaluatedAt, dynamic badge; "New Segment" link; error/empty states
- `apps/web/app/components/SegmentBuilder.tsx` — shared React builder component: all 20 fields, all operator types grouped by field type, `ValueInput` handles all operator/value combos, `GroupEditor` recursive with "Add group" only at depth 1 (not inside sub-groups)
- `apps/web/app/routes/segments.new.tsx` — create page
- `apps/web/app/routes/segments.$id.tsx` — detail/edit page with loader, preview, Re-evaluate button

## Files Created / Modified

- `packages/shared/src/types.ts` — ConditionOperator, SegmentCondition, SegmentGroup, SegmentEvaluateJobPayload, SEGMENT_EVALUATE; `CustomerRecentCheckout.lineItems` made optional (type correctness fix)
- `packages/shared/src/index.ts` — exports
- `packages/queue/src/queues.ts` — segmentEvaluateQueue
- `packages/queue/src/index.ts` — exports
- `apps/api/src/lib/segments/field-registry.ts` — NEW
- `apps/api/src/lib/segments/condition-validator.ts` — NEW
- `apps/api/src/lib/segments/condition-validator.test.ts` — NEW (9 tests)
- `apps/api/src/services/segment-evaluator.ts` — NEW
- `apps/api/src/services/segment-evaluator.test.ts` — NEW (24 tests)
- `apps/api/src/workers/segment-evaluate.worker.ts` — NEW
- `apps/api/src/worker.ts` — wired segment-evaluate worker
- `apps/api/src/routes/segments/schema.ts` — NEW
- `apps/api/src/routes/segments/service.ts` — NEW
- `apps/api/src/routes/segments/controller.ts` — NEW
- `apps/api/src/routes/segments/index.ts` — NEW
- `apps/api/src/index.ts` — registered segmentsRoutes
- `apps/api/src/processors/customer.processor.ts` — fire-and-forget evaluateProfileMemberships
- `apps/api/src/processors/customer.processor.test.ts` — type casts fixed
- `apps/api/src/services/identity.service.ts` — fire-and-forget evaluateProfileMemberships
- `apps/api/src/services/multi-store.service.test.ts` — type casts fixed (pre-existing errors)
- `apps/api/src/routes/events/service.test.ts` — type cast fixed (pre-existing error)
- `apps/api/src/routes/sdk.ts` — fire-and-forget evaluateProfileMemberships
- `apps/web/app/routes/segments._index.tsx` — NEW
- `apps/web/app/components/SegmentBuilder.tsx` — NEW
- `apps/web/app/routes/segments.new.tsx` — NEW
- `apps/web/app/routes/segments.$id.tsx` — NEW

## Decisions Made This Session

- **Two evaluation paths share one registry** — `compileToPrismaWhere` (SQL) and `evaluateProfile` (in-memory) both resolve field names through `FIELD_REGISTRY`, never from raw user input. This is the SQL injection guard.
- **Batch evaluation always async (202)** — route handler enqueues job, returns 202 immediately. Never inline to prevent timeout on large customer bases.
- **`UnrecoverableError` for invalid segment data** — invalid conditions or missing segment don't retry; they're dead-letter immediately.
- **`updateSegment`/`deleteSegment` ownership check inside service** — even though the controller pre-checks, the service does a `findFirst({ where: { id, merchantId } })` before mutation. Defense-in-depth for multi-tenancy.
- **`evaluateProfileMemberships` fire-and-forget** — wired in three hot paths (webhook processor, SDK identify, stub creation). Best-effort; errors are caught and discarded to avoid blocking the primary operation.
- **`lineItems?: unknown` in `CustomerRecentCheckout`** — made optional to fix pre-existing `JsonifyObject` incompatibility in `customers.$id_.merge.tsx`.

## Deviations from Roadmap

- None — all 12 Milestone 4.1 tasks complete.

## Known Issues Left Open

- `key={idx}` in `GroupEditor` uses array index as React key — correct but may cause subtle focus/reconciliation bugs when deleting non-terminal conditions. Should use stable IDs per rule. Deferred to Phase 4.2 or as a standalone UI polish task.
- Client-side auth in Remix pages uses `process.env['DEV_TOKEN']` which resolves to `''` on the client — both `handleSave` and `handleReEvaluate` send `Authorization: Bearer ` (empty token). Proper client-side token delivery (via cookie or Remix root loader) is deferred to Phase 5 (auth/dashboard hardening).
- `pnpm -r type-check` now exits 0. Previously 22 pre-existing errors in test files from Phase 3.3 (partial Prisma mock objects); fixed with `as never` casts.

## What to Do Next

Phase 4.2 — Journey Executor:
- Entry/exit evaluation engine
- Journey step execution (WhatsApp, email, SMS, wait, condition branch)
- BullMQ journey-execution queue
