# Journey Executor — Design Spec (Milestone 4.2)

**Date:** 2026-06-10
**Phase:** 4 | **Milestone:** 4.2
**Status:** Approved

---

## Overview

Build the Journey Executor: an event-driven, BullMQ-backed engine that enrolls customers into journeys, walks them step-by-step through action/condition/delay trees, and exits them on completion or an explicit exit trigger. Channel sends are stubs in this milestone (log + no-op); real channel integration is deferred to Phase 5.

---

## Architecture — Single-Job-Per-Step

Each step execution is an independent BullMQ job on the `journey-executor` queue. When a step completes, the worker enqueues the next step's job. `DELAY` steps enqueue the next job with BullMQ's native `delay` millisecond offset. The worker is fully stateless — it reads from DB, executes, writes result, enqueues next.

```
Trigger fires
    └─► enroll_customer job
            └─► execute_step(TRIGGER step)
                    └─► execute_step(ACTION step)  ← dispatch stub
                            └─► execute_step(DELAY step)  ← enqueued with delay:72h
                                    └─► execute_step(CONDITION step)  ← branch
                                           ├─► execute_step(ACTION step, true branch)
                                           └─► execute_step(ACTION step, false branch)
                                                    └─► enrollment → COMPLETED
```

---

## Job Payload Types

```typescript
type JourneyExecutorJob =
  | { type: 'enroll_customer';  journeyId: string; customerId: string; merchantId: string }
  | { type: 'execute_step';     enrollmentId: string; stepId: string; merchantId: string }
  | { type: 'scheduled_fire';   journeyId: string; merchantId: string }
```

All three types are handled by a single `journey-executor` queue worker with a `switch` on `type`.

---

## Trigger Types

| triggerType | triggerConfig shape | Fired from |
|---|---|---|
| `segment_entered` | `{ segmentId: string }` | `evaluateProfileMemberships` (segment evaluator hook) |
| `order_placed` | `{}` | `order.processor.ts` — after order upsert |
| `custom_event` | `{ eventName: string }` | `events/service.ts` — after ClickHouse insert |
| `scheduled` | `{ segmentId: string; fireAt: string }` | Enqueued at activation with BullMQ delay; `scheduled_fire` job fans out to all segment members |

---

## Step Config Shapes (JSON column)

```typescript
// TRIGGER — entry node, no execution logic
type TriggerStepConfig = { triggerType: string; triggerConfig: object }

// ACTION — channel dispatch (stub in 4.2)
type ActionStepConfig = {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'
  content: { body: string; subject?: string }
}

// CONDITION — branch on customer attribute
type ConditionStepConfig = {
  field: string           // from FIELD_REGISTRY
  operator: ConditionOperator
  value: unknown
  // child step IDs resolved at execution time via JourneyStep.parentStepId graph
}

// DELAY — wait before next step
type DelayStepConfig = {
  duration: number
  unit: 'minutes' | 'hours' | 'days'
}
```

---

## Components

### 1. Journey CRUD Routes (`apps/api/src/routes/journeys/`)

- `POST   /api/v1/journeys` — create (DRAFT status)
- `GET    /api/v1/journeys` — paginated list
- `GET    /api/v1/journeys/:id` — full journey + steps
- `PUT    /api/v1/journeys/:id` — update (DRAFT only)
- `DELETE /api/v1/journeys/:id` — cascade deletes steps + enrollments
- `POST   /api/v1/journeys/:id/activate` — DRAFT → ACTIVE; validates step tree; for `scheduled` trigger, enqueues `scheduled_fire` job with BullMQ delay
- `POST   /api/v1/journeys/:id/pause` — ACTIVE → PAUSED (no new enrollments; in-flight enrollments continue)
- `GET    /api/v1/journeys/:id/enrollments` — paginated enrollment list with status

### 2. Entry Service (`apps/api/src/services/journey-entry.service.ts`)

`checkJourneyEntry(customerId, merchantId, triggerType, triggerData)`:
1. Find all `ACTIVE` journeys for merchant with matching `triggerType`
2. For `segment_entered`: filter by `triggerConfig.segmentId === triggerData.segmentId`
3. For `custom_event`: filter by `triggerConfig.eventName === triggerData.eventName`
4. For each eligible journey, apply re-entry rule:
   - `DISALLOW`: skip if any enrollment (ACTIVE, COMPLETED, EXITED) exists
   - `ALLOW`: enroll regardless
   - `RE_ENROLL_AFTER_EXIT`: skip if ACTIVE; enroll if COMPLETED or EXITED (delete old record first per existing schema constraint `@@unique([journeyId, customerId])`)
5. Enqueue `enroll_customer` job for each eligible journey

### 3. Exit Service (`apps/api/src/services/journey-exit.service.ts`)

`checkJourneyExit(customerId, merchantId, exitTriggerType)`:
1. Find all ACTIVE enrollments for this customer
2. Load parent journey; check if `exitTrigger` matches `exitTriggerType`
3. Exit matching enrollments: set `status = EXITED`, `exitedAt = now()`
4. No job cancellation needed — the execute_step job checks enrollment status on start and no-ops if EXITED

### 4. Journey Executor Worker (`apps/api/src/workers/journey-executor.worker.ts`)

Single worker, concurrency 10, handles all three job types:

**`enroll_customer`:**
- Create `JourneyEnrollment` (status ACTIVE, `currentStepId = null`)
- Find TRIGGER step (the root step with no `parentStepId`)
- Enqueue `execute_step` for the TRIGGER step

**`execute_step`:**
- Load enrollment; if status ≠ ACTIVE → no-op (customer was exited)
- Load step by `stepId`
- Execute by stepType:
  - `TRIGGER`: find child step(s), enqueue `execute_step` for first child
  - `ACTION`: call `dispatchChannel(...)` stub, advance to child step
  - `CONDITION`: call `evaluateCondition(config, profile)` (re-use evaluateCondition from segment-evaluator), find true/false branch child, enqueue that child
  - `DELAY`: compute delay ms, enqueue child step's job with `{ delay: ms }`
- Update `enrollment.currentStepId` and `enrollment.lastStepAt`
- If no child step exists → mark enrollment COMPLETED, increment `journey.completionCount`

**`scheduled_fire`:**
- Load journey; get `triggerConfig.segmentId`
- Find all current segment members via `prisma.segmentMembership.findMany`
- Fan out `enroll_customer` jobs for each member (respects re-entry rules inside entry service)

### 5. Channel Dispatcher (`apps/api/src/lib/channels/dispatcher.ts`)

```typescript
export async function dispatchChannel(
  channel: string,
  customerId: string,
  content: ActionStepConfig['content'],
  merchantId: string,
): Promise<void>
```

Stub implementation: log via `pino` at `info` level — `[channel-dispatch] channel=WHATSAPP customerId=xxx`. No external calls. Returns immediately. Phase 5 replaces the body with real Meta / SES / Twilio calls without touching the caller.

### 6. Journey Schema Additions

No new Prisma models needed. One new field on `Journey`:

```prisma
exitTrigger String? @map("exit_trigger")  // e.g. "order_placed" — nullable, single value
```

This requires a new migration: `add_exit_trigger_to_journeys`.

---

## Wiring Entry / Exit Triggers

| Trigger | Where wired |
|---|---|
| `segment_entered` | `segment-evaluator.ts` → `evaluateProfileMemberships` — after upsert adds a new membership, call `checkJourneyEntry` |
| `order_placed` | `order.processor.ts` → after `processOrder` completes, call `checkJourneyEntry` AND `checkJourneyExit` |
| `custom_event` | `events/service.ts` → after ClickHouse insert, call `checkJourneyEntry` |
| `scheduled` | Activation route → enqueue `scheduled_fire` job with BullMQ delay to `fireAt` timestamp |

All calls are **fire-and-forget** (same pattern as `evaluateProfileMemberships`).

---

## Re-Entry Rule: @@unique Constraint Handling

The schema has `@@unique([journeyId, customerId])` on `JourneyEnrollment`. For `RE_ENROLL_AFTER_EXIT`: delete the old EXITED enrollment record before creating the new one inside a Prisma transaction.

---

## Remix UI

### Routes
- `apps/web/app/routes/journeys._index.tsx` — list: name, status, enrollmentCount, completionCount, trigger type, actions (activate/pause/delete)
- `apps/web/app/routes/journeys.new.tsx` — create form: name, description, trigger type + config, re-entry rule, exit trigger (optional)
- `apps/web/app/routes/journeys.$id.tsx` — detail/edit: journey metadata + ordered step list; "Add Step" button; each step shows type + config inline edit form; "Activate" / "Pause" buttons
- `apps/web/app/routes/journeys.$id_.enrollments.tsx` — enrollment table: customerId, status, enrolledAt, currentStepId, completedAt/exitedAt

### Step Editor
Form-based. Steps ordered by a `position` derived from parent-child links. Each step row shows: step type selector + config fields for that type. CONDITION step shows field/operator/value (re-use SegmentBuilder value input). DELAY step shows duration + unit dropdowns. ACTION step shows channel selector + body textarea.

---

## Error Handling

- `UnrecoverableError` for: journey not found, enrollment not found, invalid step config
- Retryable error (standard): transient DB errors, Redis connection drops
- Executor checks enrollment status at job start — EXITED/COMPLETED enrollments are no-ops, not errors
- Activation route validates: at least one TRIGGER step exists, all CONDITION steps have exactly two child steps

---

## Testing

- `journey-entry.service.test.ts` — all 4 trigger types, all 3 re-entry rules (unit, Prisma mocked)
- `journey-exit.service.test.ts` — exit trigger matching, no-match, already-exited (unit)
- `journey-executor.worker.test.ts` — execute_step for each step type, DELAY ms calculation, CONDITION branching, completion detection (unit)
- `journeys/service.test.ts` — CRUD + activate validation (unit)

---

## File Map

```
packages/shared/src/types.ts                              MODIFY — JourneyExecutorJob union type
packages/shared/src/index.ts                              MODIFY — export new types

apps/api/src/lib/channels/dispatcher.ts                   CREATE — dispatchChannel stub
apps/api/src/services/journey-entry.service.ts            CREATE — checkJourneyEntry
apps/api/src/services/journey-entry.service.test.ts       CREATE
apps/api/src/services/journey-exit.service.ts             CREATE — checkJourneyExit
apps/api/src/services/journey-exit.service.test.ts        CREATE
apps/api/src/workers/journey-executor.worker.ts           CREATE — handles all 3 job types
apps/api/src/workers/journey-executor.worker.test.ts      CREATE
apps/api/src/worker.ts                                    MODIFY — wire journey-executor worker
apps/api/src/routes/journeys/schema.ts                    CREATE — Zod schemas
apps/api/src/routes/journeys/service.ts                   CREATE — DB operations
apps/api/src/routes/journeys/controller.ts                CREATE — route handlers
apps/api/src/routes/journeys/index.ts                     CREATE — Fastify plugin
apps/api/src/index.ts                                     MODIFY — register journeysRoutes
apps/api/src/services/segment-evaluator.ts                MODIFY — wire segment_entered entry check
apps/api/src/processors/order.processor.ts                MODIFY — wire order_placed entry + exit check
apps/api/src/routes/events/service.ts                     MODIFY — wire custom_event entry check

packages/db/prisma/schema.prisma                          MODIFY — add exitTrigger field to Journey
packages/db/prisma/migrations/                            CREATE — add_exit_trigger_to_journeys

apps/web/app/routes/journeys._index.tsx                   CREATE
apps/web/app/routes/journeys.new.tsx                      CREATE
apps/web/app/routes/journeys.$id.tsx                      CREATE
apps/web/app/routes/journeys.$id_.enrollments.tsx         CREATE
```
