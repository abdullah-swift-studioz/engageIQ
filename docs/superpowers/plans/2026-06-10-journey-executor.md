# Journey Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 4.2 — a BullMQ-backed journey executor that enrolls customers into journeys via four trigger types, walks them through ACTION/CONDITION/DELAY steps, and exits them on completion or an explicit exit trigger.

**Architecture:** Single-job-per-step. Each step execution is an independent BullMQ job. When a step completes, the worker enqueues the next step's job. DELAY steps use BullMQ's native `delay` option. The worker is stateless — read from DB, execute, write result, enqueue next. Channel sends are stubs (log only) in this milestone.

**Tech Stack:** Fastify, Prisma, BullMQ, Zod, Vitest, Remix (React)

---

## File Map

```
packages/db/prisma/schema.prisma                              MODIFY — add exitTrigger to Journey model
packages/db/prisma/migrations/                                CREATE — add_exit_trigger_to_journeys

packages/shared/src/types.ts                                  MODIFY — JourneyExecutorJob, ActionStepConfig, ConditionStepConfig, DelayStepConfig, JOURNEY_EXECUTOR, JourneyTriggerType
packages/shared/src/index.ts                                  no change needed (already exports *)

apps/api/src/lib/channels/dispatcher.ts                       CREATE — dispatchChannel stub
apps/api/src/services/journey-entry.service.ts                CREATE — checkJourneyEntry (all 4 trigger types, re-entry rules)
apps/api/src/services/journey-entry.service.test.ts           CREATE
apps/api/src/services/journey-exit.service.ts                 CREATE — checkJourneyExit
apps/api/src/services/journey-exit.service.test.ts            CREATE
apps/api/src/workers/journey-executor.worker.ts               CREATE — handles enroll_customer, execute_step, scheduled_fire
apps/api/src/workers/journey-executor.worker.test.ts          CREATE
apps/api/src/worker.ts                                        MODIFY — wire journey-executor worker
apps/api/src/routes/journeys/schema.ts                        CREATE — Zod schemas
apps/api/src/routes/journeys/service.ts                       CREATE — DB operations
apps/api/src/routes/journeys/controller.ts                    CREATE — route handlers
apps/api/src/routes/journeys/index.ts                         CREATE — Fastify plugin
apps/api/src/index.ts                                         MODIFY — register journeysRoutes
apps/api/src/services/segment-evaluator.ts                    MODIFY — export buildProfileFromCustomer, wire segment_entered entry check
apps/api/src/processors/order.processor.ts                    MODIFY — wire order_placed entry + exit checks
apps/api/src/routes/events/service.ts                         MODIFY — wire custom_event entry check

apps/web/app/routes/journeys._index.tsx                       CREATE
apps/web/app/routes/journeys.new.tsx                          CREATE
apps/web/app/routes/journeys.$id.tsx                          CREATE
apps/web/app/routes/journeys.$id_.enrollments.tsx             CREATE
```

---

### Task 1: Prisma schema — add exitTrigger to Journey

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the field to the Journey model**

In `packages/db/prisma/schema.prisma`, find the Journey model. After the `reEntryRule` line, add:

```prisma
  exitTrigger  String?  @map("exit_trigger") // e.g. "order_placed" — single exit trigger per journey
```

The Journey model block should look like:

```prisma
model Journey {
  id            String       @id @default(cuid())
  merchantId    String       @map("merchant_id")
  name          String
  description   String?
  triggerType   String       @map("trigger_type")
  triggerConfig Json         @map("trigger_config")
  status        JourneyStatus @default(DRAFT)
  reEntryRule   ReEntryRule  @default(DISALLOW) @map("re_entry_rule")
  exitTrigger   String?      @map("exit_trigger")

  enrollmentCount  Int @default(0) @map("enrollment_count")
  completionCount  Int @default(0) @map("completion_count")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  merchant    Merchant          @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  steps       JourneyStep[]
  enrollments JourneyEnrollment[]

  @@index([merchantId])
  @@index([merchantId, status])
  @@map("journeys")
}
```

- [ ] **Step 2: Run migration**

```bash
cd packages/db && pnpm prisma migrate dev --name add_exit_trigger_to_journeys
```

Expected: new migration folder created, schema applied.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(phase4.2): add exitTrigger field to Journey model"
```

---

### Task 2: Shared types — JourneyExecutorJob and step configs

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Append new types to `packages/shared/src/types.ts`**

Add at the end of the file:

```typescript
// ─── Journey Executor ─────────────────────────────────────────────────────────

export const JOURNEY_EXECUTOR = 'journey-executor' as const

export type JourneyTriggerType = 'segment_entered' | 'order_placed' | 'custom_event' | 'scheduled'

export type JourneyExecutorJob =
  | { type: 'enroll_customer'; journeyId: string; customerId: string; merchantId: string }
  | { type: 'execute_step'; enrollmentId: string; stepId: string; merchantId: string }
  | { type: 'scheduled_fire'; journeyId: string; merchantId: string }

export interface ActionStepConfig {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'
  content: { body: string; subject?: string }
}

export interface ConditionStepConfig {
  field: string
  operator: ConditionOperator
  value: unknown
}

export interface DelayStepConfig {
  duration: number
  unit: 'minutes' | 'hours' | 'days'
}
```

- [ ] **Step 2: Verify build**

```bash
cd packages/shared && pnpm build
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(phase4.2): add JourneyExecutorJob types and step config interfaces"
```

---

### Task 3: Channel dispatcher stub

**Files:**
- Create: `apps/api/src/lib/channels/dispatcher.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/lib/channels/dispatcher.ts
import type { ActionStepConfig } from '@engageiq/shared'

export async function dispatchChannel(
  channel: ActionStepConfig['channel'],
  customerId: string,
  content: ActionStepConfig['content'],
  merchantId: string,
): Promise<void> {
  // Phase 4.2 stub — logs dispatch intent. Phase 5 replaces this body with
  // real Meta Cloud API / AWS SES / Twilio calls without touching callers.
  console.info(
    JSON.stringify({
      level: 'info',
      msg: '[channel-dispatch] stub',
      channel,
      customerId,
      merchantId,
      subject: content.subject ?? null,
      bodyLength: content.body.length,
    }),
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/channels/dispatcher.ts
git commit -m "feat(phase4.2): add channel dispatcher stub"
```

---

### Task 4: Journey entry service

**Files:**
- Create: `apps/api/src/services/journey-entry.service.ts`
- Create: `apps/api/src/services/journey-entry.service.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `apps/api/src/services/journey-entry.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journey: { findMany: vi.fn() },
    journeyEnrollment: { findMany: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  journeyExecutorQueue: { add: vi.fn() },
}))

import { checkJourneyEntry } from './journey-entry.service.js'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue } from '@engageiq/queue'

const mockPrisma = prisma as unknown as {
  journey: { findMany: ReturnType<typeof vi.fn> }
  journeyEnrollment: { findMany: ReturnType<typeof vi.fn> }
}
const mockQueue = journeyExecutorQueue as unknown as { add: ReturnType<typeof vi.fn> }

const MERCHANT = 'merchant_1'
const CUSTOMER = 'customer_1'
const JOURNEY_ID = 'journey_1'

const baseJourney = {
  id: JOURNEY_ID,
  reEntryRule: 'DISALLOW',
  triggerConfig: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.journey.findMany.mockResolvedValue([])
  mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])
  mockQueue.add.mockResolvedValue(undefined)
})

describe('checkJourneyEntry', () => {
  it('enqueues enroll_customer when customer has no prior enrollment and DISALLOW', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'DISALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'enroll_customer', journeyId: JOURNEY_ID, customerId: CUSTOMER }),
    )
  })

  it('skips enrollment when DISALLOW and prior enrollment exists', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'DISALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'COMPLETED' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('enqueues when ALLOW even if prior enrollment exists', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'ALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'COMPLETED' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).toHaveBeenCalled()
  })

  it('skips when ALLOW but customer is currently ACTIVE', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'ALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'ACTIVE' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('enqueues when RE_ENROLL_AFTER_EXIT and prior enrollment is EXITED', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'RE_ENROLL_AFTER_EXIT' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'EXITED' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).toHaveBeenCalled()
  })

  it('skips when RE_ENROLL_AFTER_EXIT but no prior enrollment exists', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'RE_ENROLL_AFTER_EXIT' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('filters segment_entered journeys by segmentId', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([
      { ...baseJourney, reEntryRule: 'ALLOW', triggerConfig: { segmentId: 'seg_a' } },
    ])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'segment_entered', { segmentId: 'seg_b' })

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('filters custom_event journeys by eventName', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([
      { ...baseJourney, reEntryRule: 'ALLOW', triggerConfig: { eventName: 'purchase_complete' } },
    ])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'custom_event', { eventName: 'page_view' })

    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/api && pnpm vitest run src/services/journey-entry.service.test.ts
```

Expected: FAIL — `journey-entry.service.ts` does not exist.

- [ ] **Step 3: Implement `journey-entry.service.ts`**

Create `apps/api/src/services/journey-entry.service.ts`:

```typescript
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue } from '@engageiq/queue'
import type { JourneyExecutorJob } from '@engageiq/shared'
import { JOURNEY_EXECUTOR } from '@engageiq/shared'

export async function checkJourneyEntry(
  customerId: string,
  merchantId: string,
  triggerType: string,
  triggerData: Record<string, unknown> = {},
): Promise<void> {
  const journeys = await prisma.journey.findMany({
    where: { merchantId, status: 'ACTIVE', triggerType },
    select: { id: true, reEntryRule: true, triggerConfig: true },
  })

  for (const journey of journeys) {
    const config = journey.triggerConfig as Record<string, unknown>

    if (triggerType === 'segment_entered' && config['segmentId'] !== triggerData['segmentId']) continue
    if (triggerType === 'custom_event' && config['eventName'] !== triggerData['eventName']) continue

    const existingEnrollments = await prisma.journeyEnrollment.findMany({
      where: { journeyId: journey.id, customerId },
      select: { id: true, status: true },
    })

    const hasActive = existingEnrollments.some((e) => e.status === 'ACTIVE')
    if (hasActive) continue

    if (journey.reEntryRule === 'DISALLOW' && existingEnrollments.length > 0) continue

    if (journey.reEntryRule === 'RE_ENROLL_AFTER_EXIT') {
      const hasExited = existingEnrollments.some(
        (e) => e.status === 'EXITED' || e.status === 'COMPLETED',
      )
      if (!hasExited) continue
    }

    await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
      type: 'enroll_customer',
      journeyId: journey.id,
      customerId,
      merchantId,
    } satisfies JourneyExecutorJob)
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/api && pnpm vitest run src/services/journey-entry.service.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/journey-entry.service.ts apps/api/src/services/journey-entry.service.test.ts
git commit -m "feat(phase4.2): journey entry service — checkJourneyEntry with all re-entry rules"
```

---

### Task 5: Journey exit service

**Files:**
- Create: `apps/api/src/services/journey-exit.service.ts`
- Create: `apps/api/src/services/journey-exit.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/journey-exit.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journeyEnrollment: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import { checkJourneyExit } from './journey-exit.service.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  journeyEnrollment: {
    findMany: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

const MERCHANT = 'merchant_1'
const CUSTOMER = 'customer_1'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])
  mockPrisma.journeyEnrollment.updateMany.mockResolvedValue({ count: 0 })
})

describe('checkJourneyExit', () => {
  it('exits enrollments whose journey exitTrigger matches', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: MERCHANT, exitTrigger: 'order_placed' },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['enroll_1'] } },
        data: expect.objectContaining({ status: 'EXITED' }),
      }),
    )
  })

  it('does not exit enrollments with a different exitTrigger', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: MERCHANT, exitTrigger: 'segment_entered' },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('does not exit enrollments with null exitTrigger', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: MERCHANT, exitTrigger: null },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('does not exit enrollments from a different merchant', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: 'other_merchant', exitTrigger: 'order_placed' },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing when no active enrollments exist', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/api && pnpm vitest run src/services/journey-exit.service.test.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement `journey-exit.service.ts`**

Create `apps/api/src/services/journey-exit.service.ts`:

```typescript
import { prisma } from '@engageiq/db'

export async function checkJourneyExit(
  customerId: string,
  merchantId: string,
  exitTriggerType: string,
): Promise<void> {
  const activeEnrollments = await prisma.journeyEnrollment.findMany({
    where: { customerId, status: 'ACTIVE' },
    select: { id: true, journey: { select: { merchantId: true, exitTrigger: true } } },
  })

  const toExit = activeEnrollments.filter(
    (e) =>
      e.journey.merchantId === merchantId &&
      e.journey.exitTrigger === exitTriggerType,
  )

  if (toExit.length === 0) return

  await prisma.journeyEnrollment.updateMany({
    where: { id: { in: toExit.map((e) => e.id) } },
    data: { status: 'EXITED', exitedAt: new Date() },
  })
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/api && pnpm vitest run src/services/journey-exit.service.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/journey-exit.service.ts apps/api/src/services/journey-exit.service.test.ts
git commit -m "feat(phase4.2): journey exit service — checkJourneyExit with exitTrigger matching"
```

---

### Task 6: Journey executor worker

**Files:**
- Create: `apps/api/src/workers/journey-executor.worker.ts`
- Create: `apps/api/src/workers/journey-executor.worker.test.ts`
- Modify: `apps/api/src/services/segment-evaluator.ts` — export `buildProfileFromCustomer`

- [ ] **Step 1: Export `buildProfileFromCustomer` from segment-evaluator**

In `apps/api/src/services/segment-evaluator.ts`, rename `prismaCustomerToProfileLike` to `buildProfileFromCustomer` and export it:

```typescript
// Change this:
function prismaCustomerToProfileLike(
  customer: Record<string, unknown>,
): EnrichedCustomerProfile {
```

```typescript
// To this:
export function buildProfileFromCustomer(
  customer: Record<string, unknown>,
): EnrichedCustomerProfile {
```

Also update the two call sites inside the same file (in `evaluateProfileMemberships`):

```typescript
// Line ~279: change
const profile = prismaCustomerToProfileLike(customer as unknown as Record<string, unknown>)
// to:
const profile = buildProfileFromCustomer(customer as unknown as Record<string, unknown>)
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/workers/journey-executor.worker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journey: { findFirst: vi.fn() },
    journeyStep: { findFirst: vi.fn(), findMany: vi.fn() },
    journeyEnrollment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    segmentMembership: { findMany: vi.fn() },
    customer: { findFirst: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  journeyExecutorQueue: { add: vi.fn() },
  redisConnection: {},
}))

vi.mock('../lib/channels/dispatcher.js', () => ({
  dispatchChannel: vi.fn(),
}))

import { processJourneyJob } from './journey-executor.worker.js'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue } from '@engageiq/queue'
import { dispatchChannel } from '../lib/channels/dispatcher.js'

const mockPrisma = prisma as unknown as {
  journey: { findFirst: ReturnType<typeof vi.fn> }
  journeyStep: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }
  journeyEnrollment: {
    create: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  segmentMembership: { findMany: ReturnType<typeof vi.fn> }
  customer: { findFirst: ReturnType<typeof vi.fn> }
}
const mockQueue = journeyExecutorQueue as unknown as { add: ReturnType<typeof vi.fn> }
const mockDispatch = dispatchChannel as ReturnType<typeof vi.fn>

const MERCHANT = 'merchant_1'
const JOURNEY_ID = 'journey_1'
const CUSTOMER_ID = 'customer_1'
const ENROLLMENT_ID = 'enroll_1'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.journeyEnrollment.create.mockResolvedValue({ id: ENROLLMENT_ID })
  mockPrisma.journeyEnrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID, status: 'ACTIVE', customerId: CUSTOMER_ID })
  mockPrisma.journeyEnrollment.update.mockResolvedValue({})
  mockPrisma.journeyEnrollment.updateMany.mockResolvedValue({ count: 0 })
  mockPrisma.journey.findFirst.mockResolvedValue({ id: JOURNEY_ID, merchantId: MERCHANT, status: 'ACTIVE', enrollmentCount: 0, triggerConfig: {} })
  mockPrisma.journeyStep.findMany.mockResolvedValue([])
  mockPrisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID, totalOrders: 5, totalSpent: '5000', avgOrderValue: '1000', ltv90d: null })
  mockQueue.add.mockResolvedValue(undefined)
  mockDispatch.mockResolvedValue(undefined)
})

describe('processJourneyJob — enroll_customer', () => {
  it('creates enrollment and enqueues execute_step for trigger step', async () => {
    const triggerStep = { id: 'step_trigger', stepType: 'TRIGGER', parentStepId: null, config: {} }
    mockPrisma.journeyStep.findFirst.mockResolvedValue(triggerStep)

    await processJourneyJob({
      type: 'enroll_customer',
      journeyId: JOURNEY_ID,
      customerId: CUSTOMER_ID,
      merchantId: MERCHANT,
    })

    expect(mockPrisma.journeyEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ journeyId: JOURNEY_ID, customerId: CUSTOMER_ID, status: 'ACTIVE' }),
      }),
    )
    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_trigger' }),
    )
  })
})

describe('processJourneyJob — execute_step ACTION', () => {
  it('calls dispatchChannel and advances to child step', async () => {
    const actionStep = {
      id: 'step_action',
      stepType: 'ACTION',
      config: { channel: 'WHATSAPP', content: { body: 'Hello {{firstName}}' } },
    }
    const childStep = { id: 'step_child', stepType: 'ACTION', config: { channel: 'EMAIL', content: { body: 'Follow up' } } }
    mockPrisma.journeyStep.findFirst
      .mockResolvedValueOnce(actionStep)   // load current step
      .mockResolvedValueOnce(childStep)    // find child step
    mockPrisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_action',
      merchantId: MERCHANT,
    })

    expect(mockDispatch).toHaveBeenCalledWith('WHATSAPP', CUSTOMER_ID, { body: 'Hello {{firstName}}' }, MERCHANT)
    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_child' }),
    )
  })
})

describe('processJourneyJob — execute_step DELAY', () => {
  it('enqueues child step with BullMQ delay in ms', async () => {
    const delayStep = {
      id: 'step_delay',
      stepType: 'DELAY',
      config: { duration: 2, unit: 'hours' },
    }
    const childStep = { id: 'step_after_delay', stepType: 'ACTION', config: { channel: 'SMS', content: { body: 'Hi' } } }
    mockPrisma.journeyStep.findFirst
      .mockResolvedValueOnce(delayStep)
      .mockResolvedValueOnce(childStep)

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_delay',
      merchantId: MERCHANT,
    })

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_after_delay' }),
      expect.objectContaining({ delay: 2 * 60 * 60 * 1000 }),
    )
  })
})

describe('processJourneyJob — execute_step CONDITION', () => {
  it('routes to true-branch child when condition is met', async () => {
    const conditionStep = {
      id: 'step_cond',
      stepType: 'CONDITION',
      config: { field: 'total_orders', operator: 'gt', value: 3 },
    }
    const trueBranch = { id: 'step_true', stepType: 'ACTION', config: { channel: 'WHATSAPP', content: { body: 'VIP' } }, label: 'true' }
    const falseBranch = { id: 'step_false', stepType: 'ACTION', config: { channel: 'SMS', content: { body: 'New' } }, label: 'false' }

    mockPrisma.journeyStep.findFirst.mockResolvedValueOnce(conditionStep)
    mockPrisma.journeyStep.findMany.mockResolvedValue([trueBranch, falseBranch])
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER_ID, totalOrders: 5, totalSpent: '5000', avgOrderValue: '1000', ltv90d: null,
    })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_cond',
      merchantId: MERCHANT,
    })

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_true' }),
    )
  })

  it('routes to false-branch child when condition is not met', async () => {
    const conditionStep = {
      id: 'step_cond',
      stepType: 'CONDITION',
      config: { field: 'total_orders', operator: 'gt', value: 10 },
    }
    const trueBranch = { id: 'step_true', stepType: 'ACTION', config: { channel: 'WHATSAPP', content: { body: 'VIP' } }, label: 'true' }
    const falseBranch = { id: 'step_false', stepType: 'ACTION', config: { channel: 'SMS', content: { body: 'New' } }, label: 'false' }

    mockPrisma.journeyStep.findFirst.mockResolvedValueOnce(conditionStep)
    mockPrisma.journeyStep.findMany.mockResolvedValue([trueBranch, falseBranch])
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER_ID, totalOrders: 5, totalSpent: '5000', avgOrderValue: '1000', ltv90d: null,
    })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_cond',
      merchantId: MERCHANT,
    })

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_false' }),
    )
  })
})

describe('processJourneyJob — execute_step completion', () => {
  it('marks enrollment COMPLETED and increments completionCount when no child step', async () => {
    const lastStep = { id: 'step_last', stepType: 'ACTION', config: { channel: 'EMAIL', content: { body: 'Done' } } }
    mockPrisma.journeyStep.findFirst
      .mockResolvedValueOnce(lastStep) // current step
      .mockResolvedValueOnce(null)     // no child
    mockPrisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_last',
      merchantId: MERCHANT,
    })

    expect(mockPrisma.journeyEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    )
  })
})

describe('processJourneyJob — execute_step no-ops', () => {
  it('no-ops when enrollment is not ACTIVE', async () => {
    mockPrisma.journeyEnrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID, status: 'EXITED', customerId: CUSTOMER_ID })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_1',
      merchantId: MERCHANT,
    })

    expect(mockPrisma.journeyStep.findFirst).not.toHaveBeenCalled()
    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd apps/api && pnpm vitest run src/workers/journey-executor.worker.test.ts
```

Expected: FAIL — `journey-executor.worker.ts` does not exist.

- [ ] **Step 4: Implement the worker**

Create `apps/api/src/workers/journey-executor.worker.ts`:

```typescript
import { Worker, UnrecoverableError } from 'bullmq'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue, redisConnection } from '@engageiq/queue'
import type { JourneyExecutorJob, ConditionStepConfig, DelayStepConfig, ActionStepConfig } from '@engageiq/shared'
import { JOURNEY_EXECUTOR } from '@engageiq/shared'
import type { SegmentGroup } from '@engageiq/shared'
import { evaluateProfile, buildProfileFromCustomer } from '../services/segment-evaluator.js'
import { dispatchChannel } from '../lib/channels/dispatcher.js'

function delayToMs(duration: number, unit: DelayStepConfig['unit']): number {
  const multipliers = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }
  return duration * multipliers[unit]
}

export async function processJourneyJob(data: JourneyExecutorJob): Promise<void> {
  switch (data.type) {
    case 'enroll_customer': {
      const journey = await prisma.journey.findFirst({
        where: { id: data.journeyId, merchantId: data.merchantId },
        select: { id: true, status: true, enrollmentCount: true },
      })
      if (!journey || journey.status !== 'ACTIVE') return

      const enrollment = await prisma.journeyEnrollment.create({
        data: {
          journeyId: data.journeyId,
          customerId: data.customerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      })

      await prisma.journey.update({
        where: { id: data.journeyId },
        data: { enrollmentCount: { increment: 1 } },
      })

      const triggerStep = await prisma.journeyStep.findFirst({
        where: { journeyId: data.journeyId, parentStepId: null, stepType: 'TRIGGER' },
        select: { id: true },
      })
      if (!triggerStep) throw new UnrecoverableError(`Journey ${data.journeyId} has no TRIGGER step`)

      await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
        type: 'execute_step',
        enrollmentId: enrollment.id,
        stepId: triggerStep.id,
        merchantId: data.merchantId,
      } satisfies JourneyExecutorJob)
      break
    }

    case 'execute_step': {
      const enrollment = await prisma.journeyEnrollment.findFirst({
        where: { id: data.enrollmentId },
        select: { id: true, status: true, customerId: true, journeyId: true },
      })
      if (!enrollment || enrollment.status !== 'ACTIVE') return

      const step = await prisma.journeyStep.findFirst({
        where: { id: data.stepId },
        select: { id: true, stepType: true, config: true, journeyId: true },
      })
      if (!step) throw new UnrecoverableError(`Step ${data.stepId} not found`)

      await prisma.journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { currentStepId: step.id, lastStepAt: new Date() },
      })

      let nextStepId: string | null = null

      switch (step.stepType) {
        case 'TRIGGER': {
          const child = await prisma.journeyStep.findFirst({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true },
          })
          nextStepId = child?.id ?? null
          break
        }

        case 'ACTION': {
          const config = step.config as ActionStepConfig
          await dispatchChannel(config.channel, enrollment.customerId, config.content, data.merchantId)
          const child = await prisma.journeyStep.findFirst({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true },
          })
          nextStepId = child?.id ?? null
          break
        }

        case 'DELAY': {
          const config = step.config as DelayStepConfig
          const delayMs = delayToMs(config.duration, config.unit)
          const child = await prisma.journeyStep.findFirst({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true },
          })
          if (child) {
            await journeyExecutorQueue.add(
              JOURNEY_EXECUTOR,
              {
                type: 'execute_step',
                enrollmentId: enrollment.id,
                stepId: child.id,
                merchantId: data.merchantId,
              } satisfies JourneyExecutorJob,
              { delay: delayMs },
            )
          } else {
            await prisma.journeyEnrollment.update({
              where: { id: enrollment.id },
              data: { status: 'COMPLETED', completedAt: new Date() },
            })
            await prisma.journey.update({
              where: { id: enrollment.journeyId },
              data: { completionCount: { increment: 1 } },
            })
          }
          return
        }

        case 'CONDITION': {
          const config = step.config as ConditionStepConfig
          const customer = await prisma.customer.findFirst({
            where: { id: enrollment.customerId, merchantId: data.merchantId },
          })
          if (!customer) throw new UnrecoverableError(`Customer ${enrollment.customerId} not found`)

          const profile = buildProfileFromCustomer(customer as unknown as Record<string, unknown>)
          const group: SegmentGroup = {
            match: 'all',
            rules: [{ field: config.field, operator: config.operator, value: config.value }],
          }
          const conditionResult = evaluateProfile(group, profile)

          const children = await prisma.journeyStep.findMany({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true, label: true },
          })
          const targetLabel = conditionResult ? 'true' : 'false'
          const branch = children.find((c) => c.label === targetLabel) ?? children[0] ?? null
          nextStepId = branch?.id ?? null
          break
        }
      }

      if (nextStepId) {
        await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
          type: 'execute_step',
          enrollmentId: enrollment.id,
          stepId: nextStepId,
          merchantId: data.merchantId,
        } satisfies JourneyExecutorJob)
      } else {
        await prisma.journeyEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        })
        await prisma.journey.update({
          where: { id: enrollment.journeyId },
          data: { completionCount: { increment: 1 } },
        })
      }
      break
    }

    case 'scheduled_fire': {
      const journey = await prisma.journey.findFirst({
        where: { id: data.journeyId, merchantId: data.merchantId, status: 'ACTIVE' },
        select: { id: true, reEntryRule: true, triggerConfig: true },
      })
      if (!journey) return

      const config = journey.triggerConfig as Record<string, unknown>
      const segmentId = config['segmentId'] as string | undefined
      if (!segmentId) return

      const members = await prisma.segmentMembership.findMany({
        where: { segmentId, exitedAt: null },
        select: { customerId: true },
      })

      for (const { customerId } of members) {
        const existingEnrollments = await prisma.journeyEnrollment.findMany({
          where: { journeyId: journey.id, customerId },
          select: { id: true, status: true },
        })

        const hasActive = existingEnrollments.some((e) => e.status === 'ACTIVE')
        if (hasActive) continue
        if (journey.reEntryRule === 'DISALLOW' && existingEnrollments.length > 0) continue
        if (journey.reEntryRule === 'RE_ENROLL_AFTER_EXIT') {
          const hasExited = existingEnrollments.some(
            (e) => e.status === 'EXITED' || e.status === 'COMPLETED',
          )
          if (!hasExited) continue
        }

        await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
          type: 'enroll_customer',
          journeyId: journey.id,
          customerId,
          merchantId: data.merchantId,
        } satisfies JourneyExecutorJob)
      }
      break
    }
  }
}

export function createJourneyExecutorWorker() {
  return new Worker<JourneyExecutorJob>(
    'journey-executor',
    async (job) => {
      await processJourneyJob(job.data)
    },
    { connection: redisConnection, concurrency: 10 },
  )
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/api && pnpm vitest run src/workers/journey-executor.worker.test.ts
```

Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/journey-executor.worker.ts apps/api/src/workers/journey-executor.worker.test.ts apps/api/src/services/segment-evaluator.ts
git commit -m "feat(phase4.2): journey executor worker — enroll_customer, execute_step, scheduled_fire"
```

---

### Task 7: Wire executor worker in worker.ts

**Files:**
- Modify: `apps/api/src/worker.ts`

- [ ] **Step 1: Add the worker**

In `apps/api/src/worker.ts`, add the import and registration:

```typescript
// Add to imports at top:
import type { JourneyExecutorJob } from '@engageiq/shared'
import { createJourneyExecutorWorker } from './workers/journey-executor.worker.js'

// Add after the segmentEvaluateWorker line:
const journeyExecutorWorker = createJourneyExecutorWorker()

// Add event listeners after the segmentEvaluateWorker listeners:
journeyExecutorWorker.on('completed', (job: Job<JourneyExecutorJob>) => {
  console.info(`[journey-executor-worker] completed  job=${job.id} type=${job.data.type}`)
})

journeyExecutorWorker.on('failed', (job: Job<JourneyExecutorJob> | undefined, err: Error) => {
  console.error(`[journey-executor-worker] failed    job=${job?.id} type=${job?.data.type} error=${err.message}`)
})

journeyExecutorWorker.on('error', (err: Error) => {
  console.error('[journey-executor-worker] worker error:', err)
})
```

Update the shutdown function to include `journeyExecutorWorker.close()`:

```typescript
const shutdown = async (): Promise<void> => {
  console.info('[workers] shutting down...')
  await Promise.all([
    webhookWorker.close(),
    backfillWorker.close(),
    segmentEvaluateWorker.close(),
    journeyExecutorWorker.close(),
  ])
  process.exit(0)
}
```

Update the final log line:

```typescript
console.info('[workers] started — webhook-ingestion + backfill + segment-evaluate + journey-executor queues')
```

- [ ] **Step 2: Type-check**

```bash
cd apps/api && pnpm type-check
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/worker.ts
git commit -m "feat(phase4.2): wire journey-executor worker into worker process"
```

---

### Task 8: Journey CRUD routes

**Files:**
- Create: `apps/api/src/routes/journeys/schema.ts`
- Create: `apps/api/src/routes/journeys/service.ts`
- Create: `apps/api/src/routes/journeys/controller.ts`
- Create: `apps/api/src/routes/journeys/index.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create `schema.ts`**

```typescript
// apps/api/src/routes/journeys/schema.ts
import { z } from 'zod'

export const CreateStepSchema = z.object({
  stepType: z.enum(['TRIGGER', 'ACTION', 'CONDITION', 'DELAY']),
  parentStepId: z.string().cuid().nullable().default(null),
  label: z.string().max(100).nullable().default(null),
  config: z.unknown(),
  positionX: z.number().int().default(0),
  positionY: z.number().int().default(0),
})

export const CreateJourneyBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  triggerType: z.enum(['segment_entered', 'order_placed', 'custom_event', 'scheduled']),
  triggerConfig: z.unknown().default({}),
  reEntryRule: z.enum(['ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT']).default('DISALLOW'),
  exitTrigger: z.enum(['order_placed', 'segment_entered', 'custom_event']).nullable().optional(),
  steps: z.array(CreateStepSchema).default([]),
})

export const UpdateJourneyBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.enum(['segment_entered', 'order_placed', 'custom_event', 'scheduled']).optional(),
  triggerConfig: z.unknown().optional(),
  reEntryRule: z.enum(['ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT']).optional(),
  exitTrigger: z.enum(['order_placed', 'segment_entered', 'custom_event']).nullable().optional(),
  steps: z.array(CreateStepSchema).optional(),
})

export const JourneyParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListJourneysQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export const ListEnrollmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['ACTIVE', 'COMPLETED', 'EXITED', 'FAILED']).optional(),
})

export type CreateJourneyBody = z.infer<typeof CreateJourneyBodySchema>
export type UpdateJourneyBody = z.infer<typeof UpdateJourneyBodySchema>
export type JourneyParams = z.infer<typeof JourneyParamsSchema>
export type ListJourneysQuery = z.infer<typeof ListJourneysQuerySchema>
export type ListEnrollmentsQuery = z.infer<typeof ListEnrollmentsQuerySchema>
```

- [ ] **Step 2: Create `service.ts`**

```typescript
// apps/api/src/routes/journeys/service.ts
import { prisma } from '@engageiq/db'
import type { CreateJourneyBody, UpdateJourneyBody } from './schema.js'

export async function createJourney(merchantId: string, body: CreateJourneyBody) {
  return prisma.journey.create({
    data: {
      merchantId,
      name: body.name,
      description: body.description ?? null,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig as object,
      reEntryRule: body.reEntryRule,
      exitTrigger: body.exitTrigger ?? null,
      steps: body.steps.length > 0
        ? {
            create: body.steps.map((s) => ({
              stepType: s.stepType,
              parentStepId: s.parentStepId,
              label: s.label,
              config: s.config as object,
              positionX: s.positionX,
              positionY: s.positionY,
            })),
          }
        : undefined,
    },
    include: { steps: true },
  })
}

export async function listJourneys(merchantId: string, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.journey.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        description: true,
        triggerType: true,
        status: true,
        reEntryRule: true,
        exitTrigger: true,
        enrollmentCount: true,
        completionCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.journey.count({ where: { merchantId } }),
  ])
  return { items, total, page, pageSize }
}

export async function getJourney(merchantId: string, journeyId: string) {
  return prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    include: { steps: { orderBy: { createdAt: 'asc' } } },
  })
}

export async function updateJourney(
  merchantId: string,
  journeyId: string,
  body: UpdateJourneyBody,
) {
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true, status: true },
  })
  if (!existing) return null

  return prisma.journey.update({
    where: { id: journeyId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.triggerType !== undefined && { triggerType: body.triggerType }),
      ...(body.triggerConfig !== undefined && { triggerConfig: body.triggerConfig as object }),
      ...(body.reEntryRule !== undefined && { reEntryRule: body.reEntryRule }),
      ...(body.exitTrigger !== undefined && { exitTrigger: body.exitTrigger }),
    },
    include: { steps: { orderBy: { createdAt: 'asc' } } },
  })
}

export async function deleteJourney(merchantId: string, journeyId: string) {
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true },
  })
  if (!existing) return null
  return prisma.journey.delete({ where: { id: journeyId } })
}

export async function activateJourney(merchantId: string, journeyId: string) {
  const journey = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    include: { steps: { select: { stepType: true } } },
  })
  if (!journey) return null

  const hasTrigger = journey.steps.some((s) => s.stepType === 'TRIGGER')
  if (!hasTrigger) throw new Error('MISSING_TRIGGER_STEP')

  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: 'ACTIVE' },
  })
}

export async function pauseJourney(merchantId: string, journeyId: string) {
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true, status: true },
  })
  if (!existing) return null

  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: 'PAUSED' },
  })
}

export async function listEnrollments(
  merchantId: string,
  journeyId: string,
  page: number,
  pageSize: number,
  status?: string,
) {
  const journey = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true },
  })
  if (!journey) return null

  const where = {
    journeyId,
    ...(status ? { status } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.journeyEnrollment.findMany({
      where,
      select: {
        id: true,
        customerId: true,
        status: true,
        enrolledAt: true,
        completedAt: true,
        exitedAt: true,
        lastStepAt: true,
        currentStepId: true,
      },
      orderBy: { enrolledAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.journeyEnrollment.count({ where }),
  ])
  return { items, total, page, pageSize }
}
```

- [ ] **Step 3: Create `controller.ts`**

```typescript
// apps/api/src/routes/journeys/controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { journeyExecutorQueue } from '@engageiq/queue'
import type { JourneyExecutorJob } from '@engageiq/shared'
import { JOURNEY_EXECUTOR } from '@engageiq/shared'
import {
  CreateJourneyBodySchema,
  UpdateJourneyBodySchema,
  JourneyParamsSchema,
  ListJourneysQuerySchema,
  ListEnrollmentsQuerySchema,
} from './schema.js'
import {
  createJourney,
  listJourneys,
  getJourney,
  updateJourney,
  deleteJourney,
  activateJourney,
  pauseJourney,
  listEnrollments,
} from './service.js'

function validationError(reply: FastifyReply, error: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: error } })
}

function notFound(reply: FastifyReply, entity = 'Journey') {
  return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `${entity} not found` } })
}

export async function createJourneyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = CreateJourneyBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const journey = await createJourney(request.user.merchantId, parsed.data)
  await reply.status(201).send({ success: true, data: journey })
}

export async function listJourneysHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ListJourneysQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listJourneys(request.user.merchantId, parsed.data.page, parsed.data.pageSize)
  await reply.send({ success: true, data: result.items, meta: { page: result.page, pageSize: result.pageSize, total: result.total } })
}

export async function getJourneyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) { await validationError(reply, 'Invalid journey ID'); return }
  const journey = await getJourney(request.user.merchantId, paramsParsed.data.id)
  if (!journey) { await notFound(reply); return }
  await reply.send({ success: true, data: journey })
}

export async function updateJourneyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) { await validationError(reply, 'Invalid journey ID'); return }
  const parsed = UpdateJourneyBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const updated = await updateJourney(request.user.merchantId, paramsParsed.data.id, parsed.data)
  if (!updated) { await notFound(reply); return }
  await reply.send({ success: true, data: updated })
}

export async function deleteJourneyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) { await validationError(reply, 'Invalid journey ID'); return }
  const deleted = await deleteJourney(request.user.merchantId, paramsParsed.data.id)
  if (!deleted) { await notFound(reply); return }
  await reply.status(204).send()
}

export async function activateJourneyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) { await validationError(reply, 'Invalid journey ID'); return }

  try {
    const journey = await activateJourney(request.user.merchantId, paramsParsed.data.id)
    if (!journey) { await notFound(reply); return }

    // If scheduled trigger, enqueue the scheduled_fire job with a delay to fireAt
    const config = journey.triggerConfig as Record<string, unknown>
    if (journey.triggerType === 'scheduled' && config['fireAt']) {
      const fireAt = new Date(config['fireAt'] as string)
      const delayMs = Math.max(0, fireAt.getTime() - Date.now())
      await journeyExecutorQueue.add(
        JOURNEY_EXECUTOR,
        { type: 'scheduled_fire', journeyId: journey.id, merchantId: request.user.merchantId } satisfies JourneyExecutorJob,
        { delay: delayMs, jobId: `scheduled-fire-${journey.id}` },
      )
    }

    await reply.send({ success: true, data: journey })
  } catch (err) {
    if (err instanceof Error && err.message === 'MISSING_TRIGGER_STEP') {
      await validationError(reply, 'Journey must have at least one TRIGGER step before activation')
      return
    }
    throw err
  }
}

export async function pauseJourneyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) { await validationError(reply, 'Invalid journey ID'); return }
  const journey = await pauseJourney(request.user.merchantId, paramsParsed.data.id)
  if (!journey) { await notFound(reply); return }
  await reply.send({ success: true, data: journey })
}

export async function listEnrollmentsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) { await validationError(reply, 'Invalid journey ID'); return }
  const parsed = ListEnrollmentsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listEnrollments(
    request.user.merchantId,
    paramsParsed.data.id,
    parsed.data.page,
    parsed.data.pageSize,
    parsed.data.status,
  )
  if (!result) { await notFound(reply); return }
  await reply.send({ success: true, data: result.items, meta: { page: result.page, pageSize: result.pageSize, total: result.total } })
}
```

- [ ] **Step 4: Create `index.ts`**

```typescript
// apps/api/src/routes/journeys/index.ts
import type { FastifyPluginAsync } from 'fastify'
import {
  createJourneyHandler,
  listJourneysHandler,
  getJourneyHandler,
  updateJourneyHandler,
  deleteJourneyHandler,
  activateJourneyHandler,
  pauseJourneyHandler,
  listEnrollmentsHandler,
} from './controller.js'

const journeysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createJourneyHandler)
  fastify.get('/', listJourneysHandler)

  // Specific sub-routes before param routes to avoid wildcard conflict
  fastify.post('/:id/activate', activateJourneyHandler)
  fastify.post('/:id/pause', pauseJourneyHandler)
  fastify.get('/:id/enrollments', listEnrollmentsHandler)

  fastify.get('/:id', getJourneyHandler)
  fastify.put('/:id', updateJourneyHandler)
  fastify.delete('/:id', deleteJourneyHandler)
}

export default journeysRoutes
```

- [ ] **Step 5: Register in `apps/api/src/index.ts`**

Add the import after the segmentsRoutes import:

```typescript
import journeysRoutes from './routes/journeys/index.js'
```

Add the registration after the segmentsRoutes line:

```typescript
await app.register(journeysRoutes, { prefix: '/api/v1/journeys' })
```

- [ ] **Step 6: Type-check**

```bash
cd apps/api && pnpm type-check
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/journeys/ apps/api/src/index.ts
git commit -m "feat(phase4.2): journey CRUD routes — create, list, get, update, delete, activate, pause, enrollments"
```

---

### Task 9: Wire entry/exit trigger hooks

**Files:**
- Modify: `apps/api/src/services/segment-evaluator.ts`
- Modify: `apps/api/src/processors/order.processor.ts`
- Modify: `apps/api/src/routes/events/service.ts`

- [ ] **Step 1: Wire segment_entered in `segment-evaluator.ts`**

Add the import at the top of `apps/api/src/services/segment-evaluator.ts`:

```typescript
import { checkJourneyEntry } from './journey-entry.service.js'
```

Inside `evaluateProfileMemberships`, after the `prisma.segmentMembership.create` call (line ~290):

```typescript
    if (isMember && !existing) {
      await prisma.segmentMembership.create({
        data: { segmentId: segment.id, customerId },
      })
      // Fire-and-forget: enroll into any matching journeys
      checkJourneyEntry(customerId, merchantId, 'segment_entered', { segmentId: segment.id }).catch(
        (err: unknown) => console.error('[journey-entry] segment_entered hook failed', err),
      )
    }
```

- [ ] **Step 2: Wire order_placed in `order.processor.ts`**

Add imports at the top of `apps/api/src/processors/order.processor.ts`:

```typescript
import { checkJourneyEntry } from '../services/journey-entry.service.js'
import { checkJourneyExit } from '../services/journey-exit.service.js'
```

At the end of the `processOrder` function, after `recalculateCodProfile` block:

```typescript
  if (customerId) {
    // existing recalculate calls ...

    // Fire-and-forget journey hooks
    checkJourneyEntry(customerId, merchantId, 'order_placed', {}).catch(
      (err: unknown) => console.error('[journey-entry] order_placed hook failed', err),
    )
    checkJourneyExit(customerId, merchantId, 'order_placed').catch(
      (err: unknown) => console.error('[journey-exit] order_placed hook failed', err),
    )
  }
```

The full `processOrder` function should look like:

```typescript
export async function processOrder(
  merchantId: string,
  payload: ShopifyOrderPayload,
): Promise<void> {
  let customerId: string | null = null
  if (payload.customer) {
    customerId = await processCustomerUpsert(merchantId, {
      id: payload.customer.id,
      email: payload.customer.email,
      phone: payload.customer.phone,
      first_name: payload.customer.first_name,
      last_name: payload.customer.last_name,
      default_address: payload.customer.default_address,
      tags: payload.customer.tags ?? '',
      accepts_marketing: payload.customer.accepts_marketing ?? false,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
    })
  }

  const gateway = payload.payment_gateway || payload.gateway || ''
  const isCod = detectCod(gateway, payload.financial_status)

  await processOrderUpsert(merchantId, payload, customerId)

  if (customerId) {
    await recalculateCustomerAggregates(merchantId, customerId)

    if (isCod) {
      recalculateCodProfile(merchantId, customerId).catch((err: unknown) =>
        console.error('recalculateCodProfile failed', err),
      )
    }

    checkJourneyEntry(customerId, merchantId, 'order_placed', {}).catch(
      (err: unknown) => console.error('[journey-entry] order_placed hook failed', err),
    )
    checkJourneyExit(customerId, merchantId, 'order_placed').catch(
      (err: unknown) => console.error('[journey-exit] order_placed hook failed', err),
    )
  }
}
```

- [ ] **Step 3: Wire custom_event in `events/service.ts`**

Add the import at the top of `apps/api/src/routes/events/service.ts`:

```typescript
import { checkJourneyEntry } from '../../services/journey-entry.service.js'
```

At the end of `ingestCustomEvent`, after `await insertEvents([event])`:

```typescript
  await insertEvents([event])

  if (body.customer_id) {
    checkJourneyEntry(body.customer_id, merchantId, 'custom_event', { eventName: body.event_name }).catch(
      (err: unknown) => console.error('[journey-entry] custom_event hook failed', err),
    )
  }

  return { event_id }
```

- [ ] **Step 4: Type-check and run all tests**

```bash
cd apps/api && pnpm type-check && pnpm vitest run
```

Expected: all tests pass, type-check exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/segment-evaluator.ts apps/api/src/processors/order.processor.ts apps/api/src/routes/events/service.ts
git commit -m "feat(phase4.2): wire journey entry/exit hooks into segment evaluator, order processor, events service"
```

---

### Task 10: Remix — Journey list page

**Files:**
- Create: `apps/web/app/routes/journeys._index.tsx`

- [ ] **Step 1: Create the file**

```typescript
// apps/web/app/routes/journeys._index.tsx
import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Journeys — EngageIQ' }]

interface JourneyListItem {
  id: string
  name: string
  description: string | null
  triggerType: string
  status: string
  reEntryRule: string
  exitTrigger: string | null
  enrollmentCount: number
  completionCount: number
  createdAt: string
}

interface LoaderData {
  journeys: JourneyListItem[]
  total: number
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/journeys?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journeys: [], total: 0, error: 'Failed to load journeys' })
    const body = await res.json() as { data: JourneyListItem[]; meta: { total: number } }
    return json<LoaderData>({ journeys: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ journeys: [], total: 0, error: 'Network error' })
  }
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6b7280',
  ACTIVE: '#16a34a',
  PAUSED: '#d97706',
  ARCHIVED: '#9ca3af',
}

export default function JourneysPage() {
  const { journeys, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Journeys ({total})</h1>
        <Link
          to="/journeys/new"
          style={{ background: '#2563eb', color: '#fff', padding: '0.5rem 1rem', borderRadius: '4px', textDecoration: 'none' }}
        >
          + New Journey
        </Link>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {journeys.length === 0 && !error && (
        <p style={{ color: '#6b7280' }}>No journeys yet. Create your first journey to get started.</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem 1rem' }}>Name</th>
            <th style={{ padding: '0.5rem 1rem' }}>Trigger</th>
            <th style={{ padding: '0.5rem 1rem' }}>Status</th>
            <th style={{ padding: '0.5rem 1rem' }}>Enrolled</th>
            <th style={{ padding: '0.5rem 1rem' }}>Completed</th>
            <th style={{ padding: '0.5rem 1rem' }}>Exit Trigger</th>
            <th style={{ padding: '0.5rem 1rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {journeys.map((j) => (
            <tr key={j.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '0.5rem 1rem' }}>
                <Link to={`/journeys/${j.id}`} style={{ color: '#2563eb' }}>{j.name}</Link>
                {j.description && <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{j.description}</div>}
              </td>
              <td style={{ padding: '0.5rem 1rem' }}>{j.triggerType}</td>
              <td style={{ padding: '0.5rem 1rem' }}>
                <span style={{
                  background: STATUS_COLORS[j.status] ?? '#6b7280',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                }}>
                  {j.status}
                </span>
              </td>
              <td style={{ padding: '0.5rem 1rem' }}>{j.enrollmentCount}</td>
              <td style={{ padding: '0.5rem 1rem' }}>{j.completionCount}</td>
              <td style={{ padding: '0.5rem 1rem' }}>{j.exitTrigger ?? '—'}</td>
              <td style={{ padding: '0.5rem 1rem' }}>
                <Link to={`/journeys/${j.id}/enrollments`} style={{ color: '#2563eb', marginRight: '0.75rem' }}>
                  Enrollments
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/routes/journeys._index.tsx
git commit -m "feat(phase4.2): Remix journey list page"
```

---

### Task 11: Remix — Journey create/edit page

**Files:**
- Create: `apps/web/app/routes/journeys.new.tsx`
- Create: `apps/web/app/routes/journeys.$id.tsx`

- [ ] **Step 1: Create `journeys.new.tsx`**

```typescript
// apps/web/app/routes/journeys.new.tsx
import { useState } from 'react'
import { useNavigate } from '@remix-run/react'
import type { MetaFunction } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'New Journey — EngageIQ' }]

const TRIGGER_TYPES = ['segment_entered', 'order_placed', 'custom_event', 'scheduled'] as const
const RE_ENTRY_RULES = ['DISALLOW', 'ALLOW', 'RE_ENROLL_AFTER_EXIT'] as const
const EXIT_TRIGGERS = ['order_placed', 'segment_entered', 'custom_event'] as const
const STEP_TYPES = ['TRIGGER', 'ACTION', 'CONDITION', 'DELAY'] as const
const CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS', 'PUSH'] as const

interface StepDraft {
  key: number
  stepType: typeof STEP_TYPES[number]
  label: string
  parentStepKey: number | null
  config: Record<string, unknown>
}

export default function NewJourneyPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState<typeof TRIGGER_TYPES[number]>('segment_entered')
  const [triggerSegmentId, setTriggerSegmentId] = useState('')
  const [triggerEventName, setTriggerEventName] = useState('')
  const [triggerFireAt, setTriggerFireAt] = useState('')
  const [reEntryRule, setReEntryRule] = useState<typeof RE_ENTRY_RULES[number]>('DISALLOW')
  const [exitTrigger, setExitTrigger] = useState<string>('')
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [nextKey, setNextKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const apiUrl = typeof window !== 'undefined' ? '' : (process.env['API_URL'] ?? 'http://localhost:3001')
  const token = typeof window !== 'undefined' ? '' : (process.env['DEV_TOKEN'] ?? '')

  function addStep(type: typeof STEP_TYPES[number]) {
    setSteps((prev) => [
      ...prev,
      { key: nextKey, stepType: type, label: type === 'CONDITION' ? '' : '', parentStepKey: null, config: {} },
    ])
    setNextKey((k) => k + 1)
  }

  function updateStepConfig(key: number, config: Record<string, unknown>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, config } : s)))
  }

  function updateStepLabel(key: number, label: string) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, label } : s)))
  }

  function removeStep(key: number) {
    setSteps((prev) => prev.filter((s) => s.key !== key))
  }

  function buildTriggerConfig(): Record<string, unknown> {
    if (triggerType === 'segment_entered') return { segmentId: triggerSegmentId }
    if (triggerType === 'custom_event') return { eventName: triggerEventName }
    if (triggerType === 'scheduled') return { segmentId: triggerSegmentId, fireAt: triggerFireAt }
    return {}
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/v1/journeys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          triggerType,
          triggerConfig: buildTriggerConfig(),
          reEntryRule,
          exitTrigger: exitTrigger || null,
          steps: steps.map((s, idx) => ({
            stepType: s.stepType,
            label: s.label || null,
            parentStepId: null,
            config: s.config,
            positionX: 0,
            positionY: idx * 100,
          })),
        }),
      })
      if (res.ok) {
        const body = await res.json() as { data: { id: string } }
        navigate(`/journeys/${body.data.id}`)
      } else {
        const body = await res.json() as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to create journey')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '800px' }}>
      <h1>New Journey</h1>

      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
        <label>
          Name *
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
        </label>

        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace', height: '4rem' }} />
        </label>

        <label>
          Trigger Type
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as typeof TRIGGER_TYPES[number])} style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }}>
            {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        {(triggerType === 'segment_entered' || triggerType === 'scheduled') && (
          <label>
            Segment ID
            <input value={triggerSegmentId} onChange={(e) => setTriggerSegmentId(e.target.value)} style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
          </label>
        )}

        {triggerType === 'custom_event' && (
          <label>
            Event Name
            <input value={triggerEventName} onChange={(e) => setTriggerEventName(e.target.value)} style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
          </label>
        )}

        {triggerType === 'scheduled' && (
          <label>
            Fire At (ISO datetime)
            <input type="datetime-local" value={triggerFireAt} onChange={(e) => setTriggerFireAt(e.target.value)} style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
          </label>
        )}

        <label>
          Re-entry Rule
          <select value={reEntryRule} onChange={(e) => setReEntryRule(e.target.value as typeof RE_ENTRY_RULES[number])} style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }}>
            {RE_ENTRY_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <label>
          Exit Trigger (optional)
          <select value={exitTrigger} onChange={(e) => setExitTrigger(e.target.value)} style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem', fontFamily: 'monospace' }}>
            <option value="">None</option>
            {EXIT_TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>Steps</h2>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STEP_TYPES.map((t) => (
          <button key={t} onClick={() => addStep(t)} style={{ padding: '0.4rem 0.8rem', fontFamily: 'monospace', cursor: 'pointer' }}>
            + {t}
          </button>
        ))}
      </div>

      {steps.map((step, idx) => (
        <div key={step.key} style={{ border: '1px solid #e5e7eb', borderRadius: '4px', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong>Step {idx + 1}: {step.stepType}</strong>
            <button onClick={() => removeStep(step.key)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>

          {step.stepType === 'CONDITION' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label>Label (true/false for branch steps)
                <input value={step.label} onChange={(e) => updateStepLabel(step.key, e.target.value)} placeholder="e.g. true or false" style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
              </label>
              <label>Field
                <input value={(step.config['field'] as string) ?? ''} onChange={(e) => updateStepConfig(step.key, { ...step.config, field: e.target.value })} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
              </label>
              <label>Operator
                <input value={(step.config['operator'] as string) ?? ''} onChange={(e) => updateStepConfig(step.key, { ...step.config, operator: e.target.value })} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
              </label>
              <label>Value
                <input value={(step.config['value'] as string) ?? ''} onChange={(e) => updateStepConfig(step.key, { ...step.config, value: e.target.value })} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace' }} />
              </label>
            </div>
          )}

          {step.stepType === 'ACTION' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label>Channel
                <select value={(step.config['channel'] as string) ?? 'WHATSAPP'} onChange={(e) => updateStepConfig(step.key, { ...step.config, channel: e.target.value, content: step.config['content'] ?? { body: '' } })} style={{ display: 'block', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace' }}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Body
                <textarea value={((step.config['content'] as Record<string, unknown>)?.['body'] as string) ?? ''} onChange={(e) => updateStepConfig(step.key, { ...step.config, content: { ...(step.config['content'] as Record<string, unknown> ?? {}), body: e.target.value } })} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace', height: '4rem' }} />
              </label>
            </div>
          )}

          {step.stepType === 'DELAY' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label>Duration
                <input type="number" min={1} value={(step.config['duration'] as number) ?? 1} onChange={(e) => updateStepConfig(step.key, { ...step.config, duration: Number(e.target.value) })} style={{ display: 'block', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace', width: '80px' }} />
              </label>
              <label>Unit
                <select value={(step.config['unit'] as string) ?? 'hours'} onChange={(e) => updateStepConfig(step.key, { ...step.config, unit: e.target.value })} style={{ display: 'block', padding: '0.4rem', marginTop: '0.25rem', fontFamily: 'monospace' }}>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </label>
            </div>
          )}

          {step.stepType === 'TRIGGER' && (
            <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: 0 }}>Entry point — no configuration needed.</p>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
        <button onClick={handleSave} disabled={saving} style={{ background: '#2563eb', color: '#fff', padding: '0.5rem 1.5rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}>
          {saving ? 'Saving…' : 'Create Journey'}
        </button>
        <button onClick={() => navigate('/journeys')} style={{ background: 'none', border: '1px solid #e5e7eb', padding: '0.5rem 1.5rem', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `journeys.$id.tsx`**

```typescript
// apps/web/app/routes/journeys.$id.tsx
import { useLoaderData, Link } from '@remix-run/react'
import { useState } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Journey — EngageIQ' }]

interface JourneyStep {
  id: string
  stepType: string
  label: string | null
  config: unknown
  parentStepId: string | null
  positionX: number
  positionY: number
  createdAt: string
}

interface JourneyDetail {
  id: string
  name: string
  description: string | null
  triggerType: string
  triggerConfig: unknown
  status: string
  reEntryRule: string
  exitTrigger: string | null
  enrollmentCount: number
  completionCount: number
  steps: JourneyStep[]
  createdAt: string
}

interface LoaderData {
  journey: JourneyDetail | null
  error: string | null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  try {
    const res = await fetch(`${apiUrl}/api/v1/journeys/${params['id']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journey: null, error: 'Journey not found' })
    const body = await res.json() as { data: JourneyDetail }
    return json<LoaderData>({ journey: body.data, error: null })
  } catch {
    return json<LoaderData>({ journey: null, error: 'Network error' })
  }
}

export default function JourneyDetailPage() {
  const { journey, error } = useLoaderData<LoaderData>()
  const [actionError, setActionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const apiUrl = typeof window !== 'undefined' ? '' : (process.env['API_URL'] ?? 'http://localhost:3001')
  const token = typeof window !== 'undefined' ? '' : (process.env['DEV_TOKEN'] ?? '')

  if (error || !journey) return <div style={{ padding: '2rem', fontFamily: 'monospace' }}><p style={{ color: 'red' }}>{error ?? 'Not found'}</p></div>

  async function handleActivate() {
    setLoading(true); setActionError(null)
    try {
      const res = await fetch(`${apiUrl}/api/v1/journeys/${journey!.id}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } }
        setActionError(body.error?.message ?? 'Failed to activate')
      } else {
        window.location.reload()
      }
    } catch { setActionError('Network error') }
    finally { setLoading(false) }
  }

  async function handlePause() {
    setLoading(true); setActionError(null)
    try {
      const res = await fetch(`${apiUrl}/api/v1/journeys/${journey!.id}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } }
        setActionError(body.error?.message ?? 'Failed to pause')
      } else {
        window.location.reload()
      }
    } catch { setActionError('Network error') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <Link to="/journeys" style={{ color: '#6b7280', textDecoration: 'none', fontSize: '0.85rem' }}>← Journeys</Link>
          <h1 style={{ margin: '0.25rem 0' }}>{journey.name}</h1>
          {journey.description && <p style={{ color: '#6b7280', margin: 0 }}>{journey.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ padding: '4px 12px', borderRadius: '9999px', background: journey.status === 'ACTIVE' ? '#16a34a' : journey.status === 'PAUSED' ? '#d97706' : '#6b7280', color: '#fff', fontSize: '0.8rem' }}>
            {journey.status}
          </span>
          {journey.status === 'DRAFT' && (
            <button onClick={handleActivate} disabled={loading} style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}>
              Activate
            </button>
          )}
          {journey.status === 'ACTIVE' && (
            <button onClick={handlePause} disabled={loading} style={{ background: '#d97706', color: '#fff', border: 'none', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}>
              Pause
            </button>
          )}
          <Link to={`/journeys/${journey.id}/enrollments`} style={{ color: '#2563eb', fontSize: '0.9rem' }}>
            View Enrollments →
          </Link>
        </div>
      </div>

      {actionError && <p style={{ color: 'red', marginBottom: '1rem' }}>{actionError}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', background: '#f9fafb', padding: '1rem', borderRadius: '4px' }}>
        <div><strong>Trigger:</strong> {journey.triggerType}</div>
        <div><strong>Re-entry:</strong> {journey.reEntryRule}</div>
        <div><strong>Exit Trigger:</strong> {journey.exitTrigger ?? '—'}</div>
        <div><strong>Enrolled:</strong> {journey.enrollmentCount} | <strong>Completed:</strong> {journey.completionCount}</div>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>Steps ({journey.steps.length})</h2>
      {journey.steps.length === 0 && <p style={{ color: '#6b7280' }}>No steps yet.</p>}
      {journey.steps.map((step, idx) => (
        <div key={step.id} style={{ border: '1px solid #e5e7eb', borderRadius: '4px', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong>Step {idx + 1}: {step.stepType}</strong>
            {step.label && <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>label: {step.label}</span>}
          </div>
          <pre style={{ margin: 0, fontSize: '0.8rem', background: '#f3f4f6', padding: '0.5rem', borderRadius: '4px', overflow: 'auto' }}>
            {JSON.stringify(step.config, null, 2)}
          </pre>
          {step.parentStepId && <div style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: '0.25rem' }}>parent: {step.parentStepId}</div>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/routes/journeys.new.tsx apps/web/app/routes/journeys.\$id.tsx
git commit -m "feat(phase4.2): Remix journey create and detail pages"
```

---

### Task 12: Remix — Journey enrollments page

**Files:**
- Create: `apps/web/app/routes/journeys.$id_.enrollments.tsx`

- [ ] **Step 1: Create the file**

```typescript
// apps/web/app/routes/journeys.$id_.enrollments.tsx
import { useLoaderData, Link, useSearchParams } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Journey Enrollments — EngageIQ' }]

interface EnrollmentItem {
  id: string
  customerId: string
  status: string
  enrolledAt: string
  completedAt: string | null
  exitedAt: string | null
  lastStepAt: string | null
  currentStepId: string | null
}

interface LoaderData {
  enrollments: EnrollmentItem[]
  total: number
  journeyId: string
  error: string | null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'
  const status = url.searchParams.get('status') ?? ''
  const journeyId = params['id'] ?? ''

  try {
    const qs = new URLSearchParams({ page, pageSize: '20', ...(status ? { status } : {}) })
    const res = await fetch(`${apiUrl}/api/v1/journeys/${journeyId}/enrollments?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ enrollments: [], total: 0, journeyId, error: 'Failed to load enrollments' })
    const body = await res.json() as { data: EnrollmentItem[]; meta: { total: number } }
    return json<LoaderData>({ enrollments: body.data, total: body.meta.total, journeyId, error: null })
  } catch {
    return json<LoaderData>({ enrollments: [], total: 0, journeyId, error: 'Network error' })
  }
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#2563eb',
  COMPLETED: '#16a34a',
  EXITED: '#d97706',
  FAILED: '#dc2626',
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function JourneyEnrollmentsPage() {
  const { enrollments, total, journeyId, error } = useLoaderData<LoaderData>()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentStatus = searchParams.get('status') ?? ''

  const STATUSES = ['', 'ACTIVE', 'COMPLETED', 'EXITED', 'FAILED']

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link to={`/journeys/${journeyId}`} style={{ color: '#6b7280', textDecoration: 'none', fontSize: '0.85rem' }}>
          ← Back to Journey
        </Link>
        <h1 style={{ margin: '0.25rem 0' }}>Enrollments ({total})</h1>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setSearchParams(s ? { status: s } : {})}
            style={{
              padding: '0.3rem 0.8rem',
              fontFamily: 'monospace',
              cursor: 'pointer',
              background: currentStatus === s ? '#2563eb' : '#f3f4f6',
              color: currentStatus === s ? '#fff' : '#374151',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {enrollments.length === 0 && !error && (
        <p style={{ color: '#6b7280' }}>No enrollments found.</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem' }}>Customer ID</th>
            <th style={{ padding: '0.5rem' }}>Status</th>
            <th style={{ padding: '0.5rem' }}>Enrolled At</th>
            <th style={{ padding: '0.5rem' }}>Last Step At</th>
            <th style={{ padding: '0.5rem' }}>Completed At</th>
            <th style={{ padding: '0.5rem' }}>Exited At</th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '0.5rem' }}>
                <Link to={`/customers/${e.customerId}`} style={{ color: '#2563eb' }}>
                  {e.customerId.slice(0, 12)}…
                </Link>
              </td>
              <td style={{ padding: '0.5rem' }}>
                <span style={{ background: STATUS_COLORS[e.status] ?? '#6b7280', color: '#fff', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem' }}>
                  {e.status}
                </span>
              </td>
              <td style={{ padding: '0.5rem' }}>{fmt(e.enrolledAt)}</td>
              <td style={{ padding: '0.5rem' }}>{fmt(e.lastStepAt)}</td>
              <td style={{ padding: '0.5rem' }}>{fmt(e.completedAt)}</td>
              <td style={{ padding: '0.5rem' }}>{fmt(e.exitedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Run full type-check**

```bash
pnpm -r type-check
```

Expected: exits 0.

- [ ] **Step 3: Run all tests**

```bash
cd apps/api && pnpm vitest run
```

Expected: all existing tests still pass + new journey tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/routes/journeys.\$id_.enrollments.tsx
git commit -m "feat(phase4.2): Remix journey enrollments page"
```

---

### Task 13: Session close

- [ ] **Step 1: Write update file**

Create `updates/2026-06-10_phase4_journey-executor.md` with what was built (executor worker, entry/exit services, CRUD routes, Remix pages, trigger hooks).

- [ ] **Step 2: Update `memory/context.md`**

Mark milestone 4.2 complete. Update "What Was Just Built". Move to "In Progress: Phase 5".

- [ ] **Step 3: Final commit**

```bash
git add updates/ memory/context.md
git commit -m "chore(memory): update context.md and write update file after milestone 4.2"
```
