# Update: Journey Executor — Entry / Exit Evaluation

**Date:** 2026-06-10
**Phase:** 4 | **Milestone:** 4.2
**Author:** Claude Code (Session)

## What Was Built

### Prisma Schema
- Added `exitTrigger String? @map("exit_trigger")` to the Journey model
- Migration `20260610110533_add_exit_trigger_to_journeys` created and applied
- Fix: removed an unrelated `DROP INDEX "customers_anon_ids_idx"` that Prisma auto-inserted due to schema drift (GIN index on customers.anon_ids is managed via raw SQL); index was recreated via psql

### Shared Types (`packages/shared`)
- `JOURNEY_EXECUTOR = 'journey-executor'` const
- `JourneyTriggerType` union type
- `JourneyExecutorJob` discriminated union: `enroll_customer | execute_step | scheduled_fire`
- `ActionStepConfig`, `ConditionStepConfig`, `DelayStepConfig` interfaces
- All exported from `packages/shared/src/index.ts`

### Channel Dispatcher Stub (`apps/api/src/lib/channels/dispatcher.ts`)
- `dispatchChannel(channel, customerId, content, merchantId)` — logs structured JSON, no real sends
- Clean interface for Phase 5 swap to real Meta / SES / Twilio calls

### Entry Service (`apps/api/src/services/journey-entry.service.ts`)
- `checkJourneyEntry(customerId, merchantId, triggerType, triggerData)` — finds ACTIVE journeys for trigger type, applies config filters (segmentId for segment_entered, eventName for custom_event), evaluates DISALLOW/ALLOW/RE_ENROLL_AFTER_EXIT re-entry rules, enqueues `enroll_customer` job
- 8 Vitest tests passing

### Exit Service (`apps/api/src/services/journey-exit.service.ts`)
- `checkJourneyExit(customerId, merchantId, exitTriggerType)` — finds ACTIVE enrollments, filters by `journey.exitTrigger` and `journey.merchantId`, bulk-updates to EXITED with `exitedAt`
- 5 Vitest tests passing

### Journey Executor Worker (`apps/api/src/workers/journey-executor.worker.ts`)
- `processJourneyJob(data: JourneyExecutorJob)` — handles all 3 job types:
  - `enroll_customer`: create JourneyEnrollment, increment enrollmentCount, enqueue execute_step for TRIGGER step
  - `execute_step`: load enrollment (no-op if not ACTIVE), load step, execute by type (TRIGGER → advance, ACTION → dispatchChannel + advance, DELAY → BullMQ native delay + advance, CONDITION → evaluateProfile via buildProfileFromCustomer + branch on true/false label)
  - `scheduled_fire`: load segment members, apply re-entry rules, fan out enroll_customer jobs
- `createJourneyExecutorWorker()` — concurrency 10, wired to `redisConnection`
- 7 Vitest tests passing
- `buildProfileFromCustomer` exported from `segment-evaluator.ts` (renamed from private `prismaCustomerToProfileLike`)

### Worker Process (`apps/api/src/worker.ts`)
- `journeyExecutorWorker` instantiated with completed/failed/error event listeners
- Added to graceful shutdown `Promise.all`
- Startup log updated

### Journey CRUD Routes (`apps/api/src/routes/journeys/`)
- `POST /api/v1/journeys` — create (DRAFT)
- `GET /api/v1/journeys` — paginated list
- `GET /api/v1/journeys/:id` — full journey + steps
- `PUT /api/v1/journeys/:id` — update (DRAFT only)
- `DELETE /api/v1/journeys/:id` — cascade delete
- `POST /api/v1/journeys/:id/activate` — DRAFT → ACTIVE; for scheduled triggers enqueues `scheduled_fire` with BullMQ delay to `fireAt`
- `POST /api/v1/journeys/:id/pause` — ACTIVE → PAUSED
- `GET /api/v1/journeys/:id/enrollments` — paginated enrollment list
- Registered in `apps/api/src/index.ts` at `/api/v1/journeys`
- All routes behind `fastify.authenticate`; all service calls include `merchantId`

### Trigger Hooks Wired (fire-and-forget)
- `segment-evaluator.ts`: `checkJourneyEntry` called after `segmentMembership.create` for `segment_entered`
- `order.processor.ts`: `checkJourneyEntry` + `checkJourneyExit` called at end of `processOrder` for `order_placed`
- `events/service.ts`: `checkJourneyEntry` called after `insertEvents` for `custom_event`
- Existing test files for these three updated to mock the new imports (prevents env validator process.exit in test environment)

### Remix Frontend
- `apps/web/app/routes/journeys._index.tsx` — list with status badge, enrollment/completion counts, links
- `apps/web/app/routes/journeys.new.tsx` — create form: name, description, triggerType, triggerConfig (JSON), reEntryRule, exitTrigger
- `apps/web/app/routes/journeys.$id.tsx` — detail page: Activate/Pause buttons (conditional on status), steps list, inline edit form (DRAFT only)
- `apps/web/app/routes/journeys.$id_.enrollments.tsx` — enrollment table with status badges, timestamps, customer links

## Files Created / Modified

- `packages/db/prisma/schema.prisma` — exitTrigger field on Journey model
- `packages/db/prisma/migrations/20260610110533_add_exit_trigger_to_journeys/` — migration
- `packages/shared/src/types.ts` — journey executor types
- `packages/shared/src/index.ts` — exports
- `apps/api/src/lib/channels/dispatcher.ts` — NEW
- `apps/api/src/services/journey-entry.service.ts` — NEW
- `apps/api/src/services/journey-entry.service.test.ts` — NEW (8 tests)
- `apps/api/src/services/journey-exit.service.ts` — NEW
- `apps/api/src/services/journey-exit.service.test.ts` — NEW (5 tests)
- `apps/api/src/services/segment-evaluator.ts` — export buildProfileFromCustomer, wire segment_entered hook
- `apps/api/src/services/segment-evaluator.test.ts` — mock journey-entry in tests
- `apps/api/src/workers/journey-executor.worker.ts` — NEW
- `apps/api/src/workers/journey-executor.worker.test.ts` — NEW (7 tests)
- `apps/api/src/worker.ts` — wire journey-executor worker
- `apps/api/src/routes/journeys/schema.ts` — NEW
- `apps/api/src/routes/journeys/service.ts` — NEW
- `apps/api/src/routes/journeys/controller.ts` — NEW
- `apps/api/src/routes/journeys/index.ts` — NEW
- `apps/api/src/index.ts` — register journeysRoutes
- `apps/api/src/processors/order.processor.ts` — wire order_placed hooks
- `apps/api/src/processors/customer.processor.test.ts` — mock journey-entry in tests
- `apps/api/src/routes/events/service.ts` — wire custom_event hook
- `apps/api/src/routes/events/service.test.ts` — mock journey-entry in tests
- `apps/web/app/routes/journeys._index.tsx` — NEW
- `apps/web/app/routes/journeys.new.tsx` — NEW
- `apps/web/app/routes/journeys.$id.tsx` — NEW
- `apps/web/app/routes/journeys.$id_.enrollments.tsx` — NEW

## Decisions Made This Session

- **No @@unique on JourneyEnrollment** — confirmed the schema has only `@@index([journeyId, customerId])`, not `@@unique`. Multiple enrollments per customer per journey are allowed (needed for ALLOW re-entry rule). Design spec note about `@@unique` was incorrect; actual schema is simpler.
- **Single-job-per-step architecture** — each BullMQ job processes exactly one step then enqueues the next. Worker is fully stateless: read DB → execute → write → enqueue next.
- **DELAY uses BullMQ native `delay` option** — no DB polling, no extra columns. Delay job wakes up exactly when needed.
- **CONDITION branching by `label`** — child JourneySteps with `label: 'true'` or `label: 'false'` determine branching. No schema change needed.
- **Channel dispatch as pure stub** — `dispatchChannel` logs structured JSON at info level. Body is the only thing Phase 5 replaces; callers are untouched.
- **`buildProfileFromCustomer` exported from segment-evaluator** — renamed from private `prismaCustomerToProfileLike` so the executor worker can reuse the profile-shaping logic for CONDITION step evaluation.
- **Fire-and-forget for all journey hooks** — `.catch()` logs the error, doesn't block or throw. Same pattern as `evaluateProfileMemberships`.
- **Mock additions in existing test files** — 3 test files needed `vi.mock` for the new journey-entry/exit service imports to prevent env validator `process.exit(1)` in test environment. Mocks are minimal no-op stubs that don't affect test assertions.

## Deviations from Roadmap

- None — all deliverables from Milestone 4.2 complete.

## Known Issues Left Open

- AB_SPLIT step type deferred entirely (per design decision — out of scope for 4.2)
- Client-side auth in Remix pages still uses `process.env['DEV_TOKEN']` (empty on client side) — deferred to Phase 5 auth hardening, same as segment pages
- Journey step creation UI is display-only (shows existing steps as JSON). Step creation via UI would require a separate form or drag-and-drop canvas — deferred to a future UI polish milestone
- `scheduled_fire` re-entry rule check in worker duplicates logic from `checkJourneyEntry` — could be extracted to a shared helper in a future refactor

## What to Do Next

Phase 5 — Campaign Execution & Channel Integration:
- 5.1: WhatsApp / Email / SMS real channel sends (replace dispatcher stub)
- 5.2: Campaign builder (one-time blasts, not journeys)
- 5.3: COD verification via Fixerr AI IVR
