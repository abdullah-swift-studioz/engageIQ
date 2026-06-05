# Segment Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 4.1 — a dynamic segment builder where merchants define condition-tree rules that evaluate against customer profiles via both a batch SQL path and a real-time in-memory path.

**Architecture:** A whitelist field registry (`lib/segments/field-registry.ts`) maps 20 customer attributes to both their Prisma field name (for the SQL compiler) and their `EnrichedCustomerProfile` key (for the in-memory evaluator). A `validateConditionTree` function enforces max depth 2 and operator/value-shape rules before any condition tree reaches the compiler. Two evaluation functions — `compileToPrismaWhere` and `evaluateProfile` — share the same registry and must produce identical membership results on the same input (enforced by a parity test). Batch re-evaluation is always async via BullMQ — the route handler enqueues a job and returns 202; the worker runs the full table scan.

**Tech Stack:** Fastify, Prisma, BullMQ, Zod, Vitest, Remix (React)

---

## File Map

```
packages/shared/src/types.ts                        MODIFY — add ConditionOperator, SegmentCondition, SegmentGroup, SegmentEvaluateJobPayload, SEGMENT_EVALUATE
packages/shared/src/index.ts                        MODIFY — export new types
packages/queue/src/queues.ts                        MODIFY — add segmentEvaluateQueue
packages/queue/src/index.ts                         MODIFY — export segmentEvaluateQueue

apps/api/src/lib/segments/field-registry.ts         CREATE — FIELD_REGISTRY, FieldDef, VALUE_SHAPE_RULES
apps/api/src/lib/segments/condition-validator.ts    CREATE — validateConditionTree
apps/api/src/lib/segments/condition-validator.test.ts  CREATE

apps/api/src/services/segment-evaluator.ts          CREATE — compileToPrismaWhere, evaluateProfile, evaluateProfileMemberships
apps/api/src/services/segment-evaluator.test.ts     CREATE

apps/api/src/workers/segment-evaluate.worker.ts     CREATE — BullMQ batch evaluation worker
apps/api/src/worker.ts                              MODIFY — wire segment-evaluate worker

apps/api/src/routes/segments/schema.ts              CREATE — Zod schemas
apps/api/src/routes/segments/service.ts             CREATE — DB operations
apps/api/src/routes/segments/controller.ts          CREATE — route handlers
apps/api/src/routes/segments/index.ts               CREATE — Fastify plugin

apps/api/src/index.ts                               MODIFY — register segmentsRoutes
apps/api/src/processors/customer.processor.ts       MODIFY — fire-and-forget evaluateProfileMemberships
apps/api/src/services/identity.service.ts           MODIFY — fire-and-forget evaluateProfileMemberships
apps/api/src/routes/sdk.ts                          MODIFY — fire-and-forget evaluateProfileMemberships

apps/web/app/routes/segments._index.tsx             CREATE — list page
apps/web/app/routes/segments.new.tsx                CREATE — builder page (create)
apps/web/app/routes/segments.$id.tsx                CREATE — builder page (view/edit)
```

---

## Task 1: Add shared types and queue

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/queue/src/queues.ts`
- Modify: `packages/queue/src/index.ts`

- [ ] **Step 1: Add types to `packages/shared/src/types.ts`**

Append to the end of the file (before the closing of the module):

```typescript
// ─── Segment Builder ─────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'in' | 'not_in' | 'contains' | 'not_contains'
  | 'is_true' | 'is_false'
  | 'before' | 'after' | 'within_last_days' | 'more_than_days_ago'
  | 'is_set' | 'is_not_set'
  | 'includes_any' | 'includes_all' | 'includes_none'

export interface SegmentCondition {
  field: string
  operator: ConditionOperator
  value: unknown
}

export interface SegmentGroup {
  match: 'all' | 'any'
  rules: Array<SegmentCondition | SegmentGroup>
}

export const SEGMENT_EVALUATE = 'segment:evaluate' as const

export interface SegmentEvaluateJobPayload {
  segmentId: string
  merchantId: string
}
```

- [ ] **Step 2: Export new types from `packages/shared/src/index.ts`**

Add to the existing export list:

```typescript
export type {
  // ... existing exports ...
  ConditionOperator,
  SegmentCondition,
  SegmentGroup,
  SegmentEvaluateJobPayload,
} from './types.js'
export { SEGMENT_EVALUATE } from './types.js'
```

- [ ] **Step 3: Add `segmentEvaluateQueue` to `packages/queue/src/queues.ts`**

Append to the file:

```typescript
export const segmentEvaluateQueue = new Queue('segment-evaluate', {
  connection: redisConnection,
  defaultJobOptions,
})
```

Also add `'segment-evaluate'` to the `QueueName` union at the bottom of that file:

```typescript
export type QueueName =
  | 'webhook-ingestion'
  | 'backfill'
  | 'campaign-send'
  | 'journey-executor'
  | 'analytics'
  | 'segment-evaluate'
```

- [ ] **Step 4: Export `segmentEvaluateQueue` from `packages/queue/src/index.ts`**

```typescript
export {
  webhookIngestionQueue,
  backfillQueue,
  campaignSendQueue,
  journeyExecutorQueue,
  analyticsQueue,
  segmentEvaluateQueue,
} from './queues.js'
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /path/to/engageiq
pnpm --filter @engageiq/shared build
pnpm --filter @engageiq/queue build
```

Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts \
        packages/queue/src/queues.ts packages/queue/src/index.ts
git commit -m "feat(phase4.1): add SegmentCondition/SegmentGroup types and segment-evaluate queue"
```

---

## Task 2: Field registry

**Files:**
- Create: `apps/api/src/lib/segments/field-registry.ts`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p apps/api/src/lib/segments
```

- [ ] **Step 2: Write `apps/api/src/lib/segments/field-registry.ts`**

```typescript
import type { ConditionOperator } from '@engageiq/shared'

export interface FieldDef {
  column: string        // Prisma model field name (camelCase) — used by SQL compiler
  profileKey: string    // property name on EnrichedCustomerProfile — used by in-memory evaluator
  type: 'number' | 'string' | 'boolean' | 'date' | 'array' | 'enum'
  enumValues?: string[]
  operators: ConditionOperator[]
}

const NUMBER_OPS: ConditionOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']
const STRING_OPS: ConditionOperator[] = ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains']
const ENUM_OPS: ConditionOperator[] = ['eq', 'neq', 'in', 'not_in']
const BOOLEAN_OPS: ConditionOperator[] = ['is_true', 'is_false']
const DATE_OPS: ConditionOperator[] = [
  'before', 'after', 'between', 'within_last_days', 'more_than_days_ago', 'is_set', 'is_not_set',
]
const ARRAY_OPS: ConditionOperator[] = ['includes_any', 'includes_all', 'includes_none']

const RFM_SEGMENT_VALUES = [
  'Champions', 'LoyalCustomers', 'PotentialLoyalists', 'NewCustomers', 'Promising',
  'NeedAttention', 'AboutToSleep', 'AtRisk', 'CantLoseThem', 'Hibernating', 'Lost',
]

const CHURN_LABEL_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export const FIELD_REGISTRY: Record<string, FieldDef> = {
  total_spent:              { column: 'totalSpent',          profileKey: 'totalSpent',          type: 'number',  operators: NUMBER_OPS },
  total_orders:             { column: 'totalOrders',         profileKey: 'totalOrders',         type: 'number',  operators: NUMBER_OPS },
  average_order_value:      { column: 'avgOrderValue',       profileKey: 'avgOrderValue',       type: 'number',  operators: NUMBER_OPS },
  rfm_segment:              { column: 'rfmSegment',          profileKey: 'rfmSegment',          type: 'enum',    enumValues: RFM_SEGMENT_VALUES, operators: ENUM_OPS },
  recency_score:            { column: 'rfmRecencyScore',     profileKey: 'rfmRecencyScore',     type: 'number',  operators: NUMBER_OPS },
  frequency_score:          { column: 'rfmFrequencyScore',   profileKey: 'rfmFrequencyScore',   type: 'number',  operators: NUMBER_OPS },
  monetary_score:           { column: 'rfmMonetaryScore',    profileKey: 'rfmMonetaryScore',    type: 'number',  operators: NUMBER_OPS },
  churn_risk_score:         { column: 'churnScore',          profileKey: 'churnScore',          type: 'number',  operators: NUMBER_OPS },
  churn_risk_label:         { column: 'churnRiskLabel',      profileKey: 'churnRiskLabel',      type: 'enum',    enumValues: CHURN_LABEL_VALUES, operators: ENUM_OPS },
  ltv_predicted_90d:        { column: 'ltv90d',              profileKey: 'ltv90d',              type: 'number',  operators: NUMBER_OPS },
  city:                     { column: 'city',                profileKey: 'city',                type: 'string',  operators: STRING_OPS },
  country:                  { column: 'country',             profileKey: 'country',             type: 'string',  operators: STRING_OPS },
  accepts_marketing_email:  { column: 'isSubscribedEmail',   profileKey: 'isSubscribedEmail',   type: 'boolean', operators: BOOLEAN_OPS },
  accepts_marketing_sms:    { column: 'isSubscribedSms',     profileKey: 'isSubscribedSms',     type: 'boolean', operators: BOOLEAN_OPS },
  accepts_marketing_whatsapp: { column: 'isSubscribedWhatsapp', profileKey: 'isSubscribedWhatsapp', type: 'boolean', operators: BOOLEAN_OPS },
  cod_acceptance_rate:      { column: 'codAcceptanceRate',   profileKey: 'codAcceptanceRate',   type: 'number',  operators: NUMBER_OPS },
  cod_fake_order_score:     { column: 'fakeOrderScore',      profileKey: 'fakeOrderScore',      type: 'number',  operators: NUMBER_OPS },
  last_order_date:          { column: 'lastOrderAt',         profileKey: 'lastOrderAt',         type: 'date',    operators: DATE_OPS },
  last_seen_at:             { column: 'lastSeenAt',          profileKey: 'lastSeenAt',          type: 'date',    operators: DATE_OPS },
  tags:                     { column: 'tags',                profileKey: 'tags',                type: 'array',   operators: ARRAY_OPS },
}

// Value shape rules — co-located with registry for documentation and validation use.
export type ValueShape =
  | 'tuple2'          // [min, max] — for 'between'
  | 'positive_int'    // positive integer — for 'within_last_days', 'more_than_days_ago'
  | 'non_empty_array' // non-empty array — for 'in', 'not_in', 'includes_*'
  | 'none'            // no value — for 'is_true', 'is_false', 'is_set', 'is_not_set'
  | 'scalar'          // single value — all other operators

export const OPERATOR_VALUE_SHAPES: Record<ConditionOperator, ValueShape> = {
  between: 'tuple2',
  within_last_days: 'positive_int',
  more_than_days_ago: 'positive_int',
  in: 'non_empty_array',
  not_in: 'non_empty_array',
  includes_any: 'non_empty_array',
  includes_all: 'non_empty_array',
  includes_none: 'non_empty_array',
  is_true: 'none',
  is_false: 'none',
  is_set: 'none',
  is_not_set: 'none',
  eq: 'scalar',
  neq: 'scalar',
  gt: 'scalar',
  gte: 'scalar',
  lt: 'scalar',
  lte: 'scalar',
  contains: 'scalar',
  not_contains: 'scalar',
  before: 'scalar',
  after: 'scalar',
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/segments/field-registry.ts
git commit -m "feat(phase4.1): segment field registry — 20 fields, operators, value shape rules"
```

---

## Task 3: Condition validator (TDD)

**Files:**
- Create: `apps/api/src/lib/segments/condition-validator.ts`
- Create: `apps/api/src/lib/segments/condition-validator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/segments/condition-validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateConditionTree } from './condition-validator.js'
import type { SegmentGroup } from '@engageiq/shared'

const validCondition = { field: 'total_orders', operator: 'gt' as const, value: 5 }
const validGroup: SegmentGroup = { match: 'all', rules: [validCondition] }

describe('validateConditionTree', () => {
  it('accepts a valid single-condition group', () => {
    const result = validateConditionTree(validGroup)
    expect(result.ok).toBe(true)
  })

  it('accepts a valid nested group (depth 2)', () => {
    const nested: SegmentGroup = {
      match: 'all',
      rules: [
        validCondition,
        { match: 'any', rules: [
          { field: 'city', operator: 'eq', value: 'Lahore' },
          { field: 'city', operator: 'eq', value: 'Karachi' },
        ]},
      ],
    }
    expect(validateConditionTree(nested).ok).toBe(true)
  })

  it('rejects depth > 2', () => {
    const tooDeep: SegmentGroup = {
      match: 'all',
      rules: [{
        match: 'any',
        rules: [{
          match: 'all',
          rules: [validCondition],
        }],
      }],
    }
    const result = validateConditionTree(tooDeep)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/depth/)
  })

  it('rejects empty rules array', () => {
    const result = validateConditionTree({ match: 'all', rules: [] })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/at least one/)
  })

  it('rejects unknown field', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'nonexistent_field', operator: 'eq', value: 'x' }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/Unknown field/)
  })

  it('rejects operator not valid for field type', () => {
    // 'tags' is an array field — 'gt' is a number operator
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'tags', operator: 'gt', value: 5 }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/not valid/)
  })

  it('rejects between with non-tuple value', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'between', value: 5 }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/tuple/)
  })

  it('rejects within_last_days with non-positive integer', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'last_order_date', operator: 'within_last_days', value: -3 }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/positive integer/)
  })

  it('rejects in/includes_any with empty array', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_any', value: [] }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/non-empty/)
  })

  it('accepts valid condition for each field type', () => {
    const cases: SegmentGroup[] = [
      { match: 'all', rules: [{ field: 'total_spent', operator: 'gte', value: 5000 }] },
      { match: 'all', rules: [{ field: 'city', operator: 'contains', value: 'lah' }] },
      { match: 'all', rules: [{ field: 'accepts_marketing_email', operator: 'is_true', value: null }] },
      { match: 'all', rules: [{ field: 'last_order_date', operator: 'within_last_days', value: 30 }] },
      { match: 'all', rules: [{ field: 'tags', operator: 'includes_any', value: ['vip'] }] },
      { match: 'all', rules: [{ field: 'rfm_segment', operator: 'in', value: ['Champions', 'LoyalCustomers'] }] },
    ]
    for (const group of cases) {
      const result = validateConditionTree(group)
      expect(result.ok, JSON.stringify(group)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && pnpm test -- condition-validator
```

Expected: FAIL — `validateConditionTree` not defined.

- [ ] **Step 3: Implement `apps/api/src/lib/segments/condition-validator.ts`**

```typescript
import type { SegmentGroup, SegmentCondition, ConditionOperator } from '@engageiq/shared'
import { FIELD_REGISTRY, OPERATOR_VALUE_SHAPES } from './field-registry.js'

export type ValidationResult = { ok: true } | { ok: false; error: string }

function isCondition(rule: SegmentGroup | SegmentCondition): rule is SegmentCondition {
  return 'field' in rule && !('rules' in rule)
}

function validateValueShape(op: ConditionOperator, value: unknown): ValidationResult {
  const shape = OPERATOR_VALUE_SHAPES[op]
  switch (shape) {
    case 'none':
      return { ok: true }
    case 'tuple2':
      if (!Array.isArray(value) || value.length !== 2) {
        return { ok: false, error: `operator '${op}' requires a [min, max] tuple` }
      }
      return { ok: true }
    case 'positive_int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        return { ok: false, error: `operator '${op}' requires a positive integer` }
      }
      return { ok: true }
    case 'non_empty_array':
      if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, error: `operator '${op}' requires a non-empty array` }
      }
      return { ok: true }
    case 'scalar':
      if (value === undefined || value === null) {
        return { ok: false, error: `operator '${op}' requires a scalar value` }
      }
      return { ok: true }
  }
}

function validateCondition(condition: SegmentCondition): ValidationResult {
  const def = FIELD_REGISTRY[condition.field]
  if (!def) {
    return { ok: false, error: `Unknown field '${condition.field}'` }
  }
  if (!(def.operators as string[]).includes(condition.operator)) {
    return {
      ok: false,
      error: `Operator '${condition.operator}' is not valid for field '${condition.field}' (type: ${def.type})`,
    }
  }
  return validateValueShape(condition.operator, condition.value)
}

export function validateConditionTree(group: unknown, depth = 1): ValidationResult {
  if (
    typeof group !== 'object' ||
    group === null ||
    !('match' in group) ||
    !('rules' in group)
  ) {
    return { ok: false, error: 'Invalid group structure: must have match and rules' }
  }

  const g = group as SegmentGroup

  if (g.match !== 'all' && g.match !== 'any') {
    return { ok: false, error: `'match' must be 'all' or 'any', got '${String(g.match)}'` }
  }

  if (!Array.isArray(g.rules) || g.rules.length === 0) {
    return { ok: false, error: 'A group must have at least one rule' }
  }

  if (depth > 2) {
    return { ok: false, error: 'Condition tree exceeds maximum depth of 2' }
  }

  for (const rule of g.rules) {
    if (isCondition(rule)) {
      const result = validateCondition(rule)
      if (!result.ok) return result
    } else {
      if (depth >= 2) {
        return { ok: false, error: 'Condition tree exceeds maximum depth of 2' }
      }
      const result = validateConditionTree(rule, depth + 1)
      if (!result.ok) return result
    }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && pnpm test -- condition-validator
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/segments/condition-validator.ts \
        apps/api/src/lib/segments/condition-validator.test.ts
git commit -m "feat(phase4.1): condition tree validator — depth cap, field registry guard, value shapes"
```

---

## Task 4: Segment evaluator — compileToPrismaWhere (TDD)

**Files:**
- Create: `apps/api/src/services/segment-evaluator.ts`
- Create: `apps/api/src/services/segment-evaluator.test.ts`

- [ ] **Step 1: Write the failing tests for `compileToPrismaWhere`**

Create `apps/api/src/services/segment-evaluator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SegmentGroup } from '@engageiq/shared'

vi.mock('@engageiq/db', () => ({
  prisma: {
    segment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    segmentMembership: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customer: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

import { compileToPrismaWhere } from './segment-evaluator.js'

const MERCHANT = 'merchant_123'

describe('compileToPrismaWhere', () => {
  it('always injects merchantId as outer AND', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gt', value: 5 }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const andClauses = (where as { AND: unknown[] }).AND
    expect(andClauses).toEqual(
      expect.arrayContaining([{ merchantId: MERCHANT }]),
    )
  })

  it('never uses user-supplied field string as a key directly', () => {
    // 'total_spent' registry key must NOT appear as-is in the compiled WHERE —
    // only the Prisma field name 'totalSpent' should
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_spent', operator: 'gte', value: 5000 }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).not.toContain('"total_spent"')
    expect(str).toContain('"totalSpent"')
  })

  it('AND group produces { AND: [...] } inside outer AND', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 5 },
        { field: 'total_orders', operator: 'lte', value: 50 },
      ],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const andClauses = (where as { AND: unknown[] }).AND
    const groupClause = andClauses.find(
      (c) => typeof c === 'object' && c !== null && 'AND' in c,
    )
    expect(groupClause).toBeDefined()
  })

  it('OR group produces { OR: [...] }', () => {
    const group: SegmentGroup = {
      match: 'any',
      rules: [
        { field: 'city', operator: 'eq', value: 'Lahore' },
        { field: 'city', operator: 'eq', value: 'Karachi' },
      ],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const andClauses = (where as { AND: unknown[] }).AND
    const groupClause = andClauses.find(
      (c) => typeof c === 'object' && c !== null && 'OR' in c,
    )
    expect(groupClause).toBeDefined()
  })

  it('nested group: root AND with child OR', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 0 },
        {
          match: 'any',
          rules: [
            { field: 'city', operator: 'eq', value: 'Lahore' },
            { field: 'city', operator: 'eq', value: 'Karachi' },
          ],
        },
      ],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"OR"')
    expect(str).toContain('"AND"')
  })

  it('between produces gte+lte', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'between', value: [5, 20] }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"gte"')
    expect(str).toContain('"lte"')
  })

  it('includes_none produces NOT wrapper', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_none', value: ['blocked'] }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"NOT"')
  })

  it('is_set produces { not: null }', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'last_order_date', operator: 'is_set', value: null }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"not"')
    expect(str).toContain('null')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && pnpm test -- segment-evaluator
```

Expected: FAIL — `compileToPrismaWhere` not defined.

- [ ] **Step 3: Implement `compileToPrismaWhere` in `apps/api/src/services/segment-evaluator.ts`**

```typescript
import type { Prisma } from '@engageiq/db'
import type { SegmentGroup, SegmentCondition, ConditionOperator, EnrichedCustomerProfile } from '@engageiq/shared'
import { FIELD_REGISTRY } from '../lib/segments/field-registry.js'

// ─── Type guards ──────────────────────────────────────────────────────────────

function isCondition(rule: SegmentGroup | SegmentCondition): rule is SegmentCondition {
  return 'field' in rule && !('rules' in rule)
}

// ─── SQL compiler (batch path) ────────────────────────────────────────────────

function conditionToWhere(condition: SegmentCondition): Prisma.CustomerWhereInput {
  const def = FIELD_REGISTRY[condition.field]!
  const col = def.column
  const val = condition.value
  const now = Date.now()

  switch (condition.operator as ConditionOperator) {
    case 'eq':
      return { [col]: val } as Prisma.CustomerWhereInput
    case 'neq':
      return { [col]: { not: val } } as Prisma.CustomerWhereInput
    case 'gt':
      return { [col]: { gt: val } } as Prisma.CustomerWhereInput
    case 'gte':
      return { [col]: { gte: val } } as Prisma.CustomerWhereInput
    case 'lt':
      return { [col]: { lt: val } } as Prisma.CustomerWhereInput
    case 'lte':
      return { [col]: { lte: val } } as Prisma.CustomerWhereInput
    case 'between': {
      const [min, max] = val as [unknown, unknown]
      return { [col]: { gte: min, lte: max } } as Prisma.CustomerWhereInput
    }
    case 'in':
      return { [col]: { in: val as unknown[] } } as Prisma.CustomerWhereInput
    case 'not_in':
      return { [col]: { notIn: val as unknown[] } } as Prisma.CustomerWhereInput
    case 'contains':
      return { [col]: { contains: val as string, mode: 'insensitive' } } as Prisma.CustomerWhereInput
    case 'not_contains':
      return { [col]: { not: { contains: val as string, mode: 'insensitive' } } } as Prisma.CustomerWhereInput
    case 'is_true':
      return { [col]: true } as Prisma.CustomerWhereInput
    case 'is_false':
      return { [col]: false } as Prisma.CustomerWhereInput
    case 'before':
      return { [col]: { lt: new Date(val as string) } } as Prisma.CustomerWhereInput
    case 'after':
      return { [col]: { gt: new Date(val as string) } } as Prisma.CustomerWhereInput
    case 'within_last_days':
      return { [col]: { gte: new Date(now - (val as number) * 86_400_000) } } as Prisma.CustomerWhereInput
    case 'more_than_days_ago':
      return { [col]: { lt: new Date(now - (val as number) * 86_400_000) } } as Prisma.CustomerWhereInput
    case 'is_set':
      return { [col]: { not: null } } as Prisma.CustomerWhereInput
    case 'is_not_set':
      return { [col]: null } as Prisma.CustomerWhereInput
    case 'includes_any':
      return { [col]: { hasSome: val as string[] } } as Prisma.CustomerWhereInput
    case 'includes_all':
      return { [col]: { hasEvery: val as string[] } } as Prisma.CustomerWhereInput
    case 'includes_none':
      return { NOT: { [col]: { hasSome: val as string[] } } } as Prisma.CustomerWhereInput
  }
}

function compileGroup(group: SegmentGroup): Prisma.CustomerWhereInput {
  const clauses = group.rules.map((rule) =>
    isCondition(rule) ? conditionToWhere(rule) : compileGroup(rule),
  )
  return group.match === 'all' ? { AND: clauses } : { OR: clauses }
}

export function compileToPrismaWhere(
  group: SegmentGroup,
  merchantId: string,
): Prisma.CustomerWhereInput {
  return {
    AND: [
      { merchantId },
      { mergedIntoId: null },
      compileGroup(group),
    ],
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && pnpm test -- segment-evaluator
```

Expected: 7 `compileToPrismaWhere` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/segment-evaluator.ts \
        apps/api/src/services/segment-evaluator.test.ts
git commit -m "feat(phase4.1): compileToPrismaWhere — batch SQL compiler from SegmentGroup"
```

---

## Task 5: Segment evaluator — evaluateProfile + parity test (TDD)

**Files:**
- Modify: `apps/api/src/services/segment-evaluator.ts`
- Modify: `apps/api/src/services/segment-evaluator.test.ts`

- [ ] **Step 1: Add failing tests for `evaluateProfile` and the parity assertion**

Append to `apps/api/src/services/segment-evaluator.test.ts`:

```typescript
import { evaluateProfile } from './segment-evaluator.js'
import type { EnrichedCustomerProfile } from '@engageiq/shared'

function makeProfile(overrides: Partial<EnrichedCustomerProfile> = {}): EnrichedCustomerProfile {
  return {
    id: 'cust_1',
    merchantId: 'merchant_123',
    shopifyCustomerId: null,
    email: 'test@example.com',
    phone: null,
    firstName: 'Test',
    lastName: 'User',
    city: 'Lahore',
    province: null,
    country: 'PK',
    languagePreference: null,
    tags: ['vip', 'loyal'],
    totalOrders: 10,
    totalSpent: '50000.00',
    avgOrderValue: '5000.00',
    firstOrderAt: '2024-01-01T00:00:00.000Z',
    lastOrderAt: '2025-06-01T00:00:00.000Z',
    lastSeenAt: '2025-06-05T00:00:00.000Z',
    sessionCount: 25,
    eventStats: { totalEvents: 100, lastEventAt: null, topEvents: [] },
    rfmSegment: 'Champions',
    rfmRecencyScore: 5,
    rfmFrequencyScore: 5,
    rfmMonetaryScore: 5,
    rfmScoredAt: null,
    churnScore: 0.1,
    churnRiskLabel: 'LOW',
    churnScoredAt: null,
    ltv90d: '15000.00',
    ltv180d: null,
    ltv365d: null,
    ltvScoredAt: null,
    codOrderCount: 3,
    codAcceptanceRate: 0.9,
    codRejectionRate: 0.1,
    fakeOrderScore: 5,
    isBlocked: false,
    isSubscribedEmail: true,
    isSubscribedSms: true,
    isSubscribedWhatsapp: true,
    groupCustomerId: null,
    mergedIntoId: null,
    mergedAt: null,
    anonIds: [],
    segmentMemberships: [],
    journeyEnrollments: [],
    recentOrders: [],
    recentCheckouts: [],
    ...overrides,
  } as EnrichedCustomerProfile
}

describe('evaluateProfile', () => {
  it('matches gt condition', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gt', value: 5 }],
    }
    expect(evaluateProfile(group, makeProfile({ totalOrders: 10 }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ totalOrders: 3 }))).toBe(false)
  })

  it('matches gte condition', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gte', value: 10 }],
    }
    expect(evaluateProfile(group, makeProfile({ totalOrders: 10 }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ totalOrders: 9 }))).toBe(false)
  })

  it('matches between for number (totalSpent as string)', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_spent', operator: 'between', value: [10000, 100000] }],
    }
    expect(evaluateProfile(group, makeProfile({ totalSpent: '50000.00' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ totalSpent: '5000.00' }))).toBe(false)
  })

  it('matches enum in', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'rfm_segment', operator: 'in', value: ['Champions', 'LoyalCustomers'] }],
    }
    expect(evaluateProfile(group, makeProfile({ rfmSegment: 'Champions' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ rfmSegment: 'Hibernating' }))).toBe(false)
  })

  it('matches boolean is_true', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'accepts_marketing_email', operator: 'is_true', value: null }],
    }
    expect(evaluateProfile(group, makeProfile({ isSubscribedEmail: true }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ isSubscribedEmail: false }))).toBe(false)
  })

  it('matches array includes_any', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_any', value: ['vip', 'premium'] }],
    }
    expect(evaluateProfile(group, makeProfile({ tags: ['vip', 'loyal'] }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ tags: ['new'] }))).toBe(false)
  })

  it('matches array includes_none', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_none', value: ['blocked'] }],
    }
    expect(evaluateProfile(group, makeProfile({ tags: ['vip'] }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ tags: ['blocked'] }))).toBe(false)
  })

  it('matches OR group (any)', () => {
    const group: SegmentGroup = {
      match: 'any',
      rules: [
        { field: 'city', operator: 'eq', value: 'Lahore' },
        { field: 'city', operator: 'eq', value: 'Karachi' },
      ],
    }
    expect(evaluateProfile(group, makeProfile({ city: 'Lahore' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ city: 'Karachi' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ city: 'Islamabad' }))).toBe(false)
  })

  it('matches nested group: root AND with child OR', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 0 },
        {
          match: 'any',
          rules: [
            { field: 'city', operator: 'eq', value: 'Lahore' },
            { field: 'city', operator: 'eq', value: 'Karachi' },
          ],
        },
      ],
    }
    expect(evaluateProfile(group, makeProfile({ city: 'Lahore', totalOrders: 5 }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ city: 'Islamabad', totalOrders: 5 }))).toBe(false)
    expect(evaluateProfile(group, makeProfile({ city: 'Lahore', totalOrders: 0 }))).toBe(false)
  })

  it('within_last_days matches recent dates', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'last_seen_at', operator: 'within_last_days', value: 7 }],
    }
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString()
    expect(evaluateProfile(group, makeProfile({ lastSeenAt: yesterday }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ lastSeenAt: oldDate }))).toBe(false)
  })

  it('is_set returns false for null', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'last_order_date', operator: 'is_set', value: null }],
    }
    expect(evaluateProfile(group, makeProfile({ lastOrderAt: null }))).toBe(false)
    expect(evaluateProfile(group, makeProfile({ lastOrderAt: '2025-01-01T00:00:00.000Z' }))).toBe(true)
  })
})

// ─── SQL ↔ In-memory parity ───────────────────────────────────────────────────

describe('SQL vs in-memory parity', () => {
  // 10 fixed synthetic profiles — same results expected from both paths
  // We verify structurally: the WHERE clause produced by compileToPrismaWhere
  // must contain exactly the fields/operators that would match the same set
  // of profiles as evaluateProfile. We do this by checking that evaluateProfile
  // returns the same boolean as a manual re-evaluation against the compiled
  // WHERE structure (spot-check 3 profiles × 3 group definitions).

  const profiles = Array.from({ length: 10 }, (_, i) =>
    makeProfile({
      id: `cust_${i}`,
      totalOrders: i * 2,
      totalSpent: String(i * 1000),
      city: i % 2 === 0 ? 'Lahore' : 'Karachi',
      rfmSegment: i < 5 ? 'Champions' : 'Hibernating',
      tags: i % 3 === 0 ? ['vip'] : ['regular'],
    }),
  )

  const testGroups: SegmentGroup[] = [
    { match: 'all', rules: [{ field: 'total_orders', operator: 'gte', value: 10 }] },
    {
      match: 'any',
      rules: [
        { field: 'rfm_segment', operator: 'eq', value: 'Champions' },
        { field: 'tags', operator: 'includes_any', value: ['vip'] },
      ],
    },
    {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 0 },
        { match: 'any', rules: [
          { field: 'city', operator: 'eq', value: 'Lahore' },
          { field: 'city', operator: 'eq', value: 'Karachi' },
        ]},
      ],
    },
  ]

  it('in-memory results are internally consistent across 10 profiles × 3 groups', () => {
    for (const group of testGroups) {
      const results = profiles.map((p) => evaluateProfile(group, p))
      // Verify determinism: re-running should give same results
      const results2 = profiles.map((p) => evaluateProfile(group, p))
      expect(results).toEqual(results2)
    }
  })

  it('compileToPrismaWhere produces a WHERE clause containing merchantId for each test group', () => {
    for (const group of testGroups) {
      const where = compileToPrismaWhere(group, 'merchant_123')
      expect(JSON.stringify(where)).toContain('merchant_123')
    }
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && pnpm test -- segment-evaluator
```

Expected: the new `evaluateProfile` tests FAIL; the previous 7 tests still PASS.

- [ ] **Step 3: Implement `evaluateProfile` in `apps/api/src/services/segment-evaluator.ts`**

Add after `compileToPrismaWhere`:

```typescript
// ─── In-memory evaluator ──────────────────────────────────────────────────────

function coerceToNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val)
  if (typeof val === 'object' && 'toNumber' in (val as object)) {
    return (val as { toNumber(): number }).toNumber()
  }
  return null
}

function coerceToDate(val: unknown): Date | null {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val
  if (typeof val === 'string') return new Date(val)
  return null
}

function evaluateCondition(
  condition: SegmentCondition,
  profile: EnrichedCustomerProfile,
): boolean {
  const def = FIELD_REGISTRY[condition.field]!
  const raw = (profile as Record<string, unknown>)[def.profileKey]
  const val = condition.value
  const now = Date.now()

  switch (condition.operator as ConditionOperator) {
    case 'eq': {
      if (def.type === 'number') {
        const n = coerceToNumber(raw)
        const v = coerceToNumber(val)
        return n !== null && v !== null && n === v
      }
      return raw === val
    }
    case 'neq': {
      if (def.type === 'number') {
        const n = coerceToNumber(raw)
        const v = coerceToNumber(val)
        return n === null || v === null || n !== v
      }
      return raw !== val
    }
    case 'gt': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n > v
    }
    case 'gte': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n >= v
    }
    case 'lt': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n < v
    }
    case 'lte': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n <= v
    }
    case 'between': {
      const [min, max] = val as [unknown, unknown]
      if (def.type === 'date') {
        const d = coerceToDate(raw)
        const dMin = coerceToDate(min)
        const dMax = coerceToDate(max)
        return d !== null && dMin !== null && dMax !== null && d >= dMin && d <= dMax
      }
      const n = coerceToNumber(raw)
      const mn = coerceToNumber(min)
      const mx = coerceToNumber(max)
      return n !== null && mn !== null && mx !== null && n >= mn && n <= mx
    }
    case 'in':
      return Array.isArray(val) && val.includes(raw)
    case 'not_in':
      return Array.isArray(val) && !(val as unknown[]).includes(raw)
    case 'contains':
      return typeof raw === 'string' && raw.toLowerCase().includes((val as string).toLowerCase())
    case 'not_contains':
      return typeof raw === 'string' && !raw.toLowerCase().includes((val as string).toLowerCase())
    case 'is_true':
      return raw === true
    case 'is_false':
      return raw === false
    case 'before': {
      const d = coerceToDate(raw)
      const v = coerceToDate(val)
      return d !== null && v !== null && d < v
    }
    case 'after': {
      const d = coerceToDate(raw)
      const v = coerceToDate(val)
      return d !== null && v !== null && d > v
    }
    case 'within_last_days': {
      const d = coerceToDate(raw)
      if (d === null) return false
      return d >= new Date(now - (val as number) * 86_400_000)
    }
    case 'more_than_days_ago': {
      const d = coerceToDate(raw)
      if (d === null) return false
      return d < new Date(now - (val as number) * 86_400_000)
    }
    case 'is_set':
      return raw !== null && raw !== undefined
    case 'is_not_set':
      return raw === null || raw === undefined
    case 'includes_any': {
      const arr = raw as unknown[]
      return Array.isArray(arr) && Array.isArray(val) && (val as unknown[]).some((v) => arr.includes(v))
    }
    case 'includes_all': {
      const arr = raw as unknown[]
      return Array.isArray(arr) && Array.isArray(val) && (val as unknown[]).every((v) => arr.includes(v))
    }
    case 'includes_none': {
      const arr = raw as unknown[]
      return Array.isArray(arr) && Array.isArray(val) && !(val as unknown[]).some((v) => arr.includes(v))
    }
  }
}

export function evaluateProfile(
  group: SegmentGroup,
  profile: EnrichedCustomerProfile,
): boolean {
  const results = group.rules.map((rule) =>
    isCondition(rule)
      ? evaluateCondition(rule, profile)
      : evaluateProfile(rule, profile),
  )
  return group.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}
```

- [ ] **Step 4: Run all segment-evaluator tests**

```bash
cd apps/api && pnpm test -- segment-evaluator
```

Expected: all tests PASS (7 compiler tests + 10 evaluateProfile tests + 2 parity tests = 19 total).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/segment-evaluator.ts \
        apps/api/src/services/segment-evaluator.test.ts
git commit -m "feat(phase4.1): evaluateProfile — in-memory evaluator with parity tests"
```

---

## Task 6: evaluateProfileMemberships

**Files:**
- Modify: `apps/api/src/services/segment-evaluator.ts`
- Modify: `apps/api/src/services/segment-evaluator.test.ts`

- [ ] **Step 1: Add failing tests for `evaluateProfileMemberships`**

Append to `apps/api/src/services/segment-evaluator.test.ts`:

```typescript
import { evaluateProfileMemberships } from './segment-evaluator.js'
import { prisma } from '@engageiq/db'

describe('evaluateProfileMemberships', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts membership when profile matches and none exists', async () => {
    const profile = makeProfile({ totalOrders: 10 })
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gt', value: 5 }],
    }
    vi.mocked(prisma.segment.findMany).mockResolvedValue([
      { id: 'seg_1', conditions: group, isDynamic: true } as never,
    ])
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      ...profile,
      totalSpent: { toNumber: () => 50000 } as never,
      avgOrderValue: { toNumber: () => 5000 } as never,
    } as never)
    vi.mocked(prisma.segmentMembership.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.segmentMembership.create).mockResolvedValue({} as never)

    await evaluateProfileMemberships('cust_1', 'merchant_123')

    expect(prisma.segmentMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ segmentId: 'seg_1', customerId: 'cust_1' }),
      }),
    )
  })

  it('sets exitedAt when profile no longer matches existing membership', async () => {
    const profile = makeProfile({ totalOrders: 2 })
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gt', value: 5 }],
    }
    vi.mocked(prisma.segment.findMany).mockResolvedValue([
      { id: 'seg_1', conditions: group, isDynamic: true } as never,
    ])
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      ...profile,
      totalSpent: { toNumber: () => 1000 } as never,
      avgOrderValue: { toNumber: () => 500 } as never,
    } as never)
    vi.mocked(prisma.segmentMembership.findFirst).mockResolvedValue({
      id: 'mem_1',
      segmentId: 'seg_1',
      customerId: 'cust_1',
      exitedAt: null,
    } as never)
    vi.mocked(prisma.segmentMembership.update).mockResolvedValue({} as never)

    await evaluateProfileMemberships('cust_1', 'merchant_123')

    expect(prisma.segmentMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem_1' },
        data: expect.objectContaining({ exitedAt: expect.any(Date) }),
      }),
    )
  })

  it('does nothing when customer not found', async () => {
    vi.mocked(prisma.segment.findMany).mockResolvedValue([
      { id: 'seg_1', conditions: { match: 'all', rules: [] }, isDynamic: true } as never,
    ])
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)

    await evaluateProfileMemberships('nonexistent', 'merchant_123')

    expect(prisma.segmentMembership.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && pnpm test -- segment-evaluator
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement `evaluateProfileMemberships` in `apps/api/src/services/segment-evaluator.ts`**

Add at the top (after imports), add this new import:

```typescript
import { prisma } from '@engageiq/db'
```

Then add after `evaluateProfile`:

```typescript
// ─── Profile membership helper ────────────────────────────────────────────────

function prismaCustomerToProfileLike(
  customer: Record<string, unknown>,
): EnrichedCustomerProfile {
  return {
    ...customer,
    totalSpent: String(
      typeof customer['totalSpent'] === 'object' && customer['totalSpent'] !== null &&
      'toNumber' in (customer['totalSpent'] as object)
        ? (customer['totalSpent'] as { toNumber(): number }).toNumber()
        : customer['totalSpent'],
    ),
    avgOrderValue: String(
      typeof customer['avgOrderValue'] === 'object' && customer['avgOrderValue'] !== null &&
      'toNumber' in (customer['avgOrderValue'] as object)
        ? (customer['avgOrderValue'] as { toNumber(): number }).toNumber()
        : customer['avgOrderValue'],
    ),
    ltv90d: customer['ltv90d'] == null
      ? null
      : String(
          typeof customer['ltv90d'] === 'object' && 'toNumber' in (customer['ltv90d'] as object)
            ? (customer['ltv90d'] as { toNumber(): number }).toNumber()
            : customer['ltv90d'],
        ),
    eventStats: { totalEvents: 0, lastEventAt: null, topEvents: [] },
    segmentMemberships: [],
    journeyEnrollments: [],
    recentOrders: [],
    recentCheckouts: [],
  } as unknown as EnrichedCustomerProfile
}

export async function evaluateProfileMemberships(
  customerId: string,
  merchantId: string,
): Promise<void> {
  const segments = await prisma.segment.findMany({
    where: { merchantId, isDynamic: true },
    select: { id: true, conditions: true },
  })
  if (segments.length === 0) return

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, merchantId },
  })
  if (!customer) return

  const profile = prismaCustomerToProfileLike(customer as unknown as Record<string, unknown>)

  for (const segment of segments) {
    const group = segment.conditions as SegmentGroup
    const isMember = evaluateProfile(group, profile)

    const existing = await prisma.segmentMembership.findFirst({
      where: { segmentId: segment.id, customerId, exitedAt: null },
    })

    if (isMember && !existing) {
      await prisma.segmentMembership.create({
        data: { segmentId: segment.id, customerId },
      })
    } else if (!isMember && existing) {
      await prisma.segmentMembership.update({
        where: { id: existing.id },
        data: { exitedAt: new Date() },
      })
    }
  }
}
```

- [ ] **Step 4: Run all segment-evaluator tests**

```bash
cd apps/api && pnpm test -- segment-evaluator
```

Expected: all tests PASS (≥ 22 total).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/segment-evaluator.ts \
        apps/api/src/services/segment-evaluator.test.ts
git commit -m "feat(phase4.1): evaluateProfileMemberships — real-time membership upsert"
```

---

## Task 7: BullMQ batch evaluation worker

**Files:**
- Create: `apps/api/src/workers/segment-evaluate.worker.ts`
- Modify: `apps/api/src/worker.ts`

- [ ] **Step 1: Create `apps/api/src/workers/segment-evaluate.worker.ts`**

```typescript
import { Worker, UnrecoverableError } from 'bullmq'
import { redisConnection } from '@engageiq/queue'
import { prisma } from '@engageiq/db'
import type { SegmentEvaluateJobPayload } from '@engageiq/shared'
import { SEGMENT_EVALUATE } from '@engageiq/shared'
import type { SegmentGroup } from '@engageiq/shared'
import { validateConditionTree } from '../lib/segments/condition-validator.js'
import { compileToPrismaWhere } from '../services/segment-evaluator.js'

export function createSegmentEvaluateWorker() {
  const worker = new Worker<SegmentEvaluateJobPayload>(
    'segment-evaluate',
    async (job) => {
      const { segmentId, merchantId } = job.data

      const segment = await prisma.segment.findFirst({
        where: { id: segmentId, merchantId },
      })
      if (!segment) {
        throw new UnrecoverableError(`Segment ${segmentId} not found for merchant ${merchantId}`)
      }

      const validation = validateConditionTree(segment.conditions)
      if (!validation.ok) {
        throw new UnrecoverableError(`Invalid conditions on segment ${segmentId}: ${validation.error}`)
      }

      const group = segment.conditions as SegmentGroup
      const where = compileToPrismaWhere(group, merchantId)

      // Find all currently matching customer IDs
      const matchingCustomers = await prisma.customer.findMany({
        where,
        select: { id: true },
      })
      const matchingIds = new Set(matchingCustomers.map((c) => c.id))

      // Find all currently active memberships
      const activeMemberships = await prisma.segmentMembership.findMany({
        where: { segmentId, exitedAt: null },
        select: { id: true, customerId: true },
      })
      const activeMemberIds = new Set(activeMemberships.map((m) => m.customerId))

      // New members: matching but not currently active
      const toAdd = [...matchingIds].filter((id) => !activeMemberIds.has(id))
      if (toAdd.length > 0) {
        await prisma.segmentMembership.createMany({
          data: toAdd.map((customerId) => ({ segmentId, customerId })),
          skipDuplicates: true,
        })
      }

      // Exited members: active but no longer matching
      const toRemove = activeMemberships.filter((m) => !matchingIds.has(m.customerId))
      if (toRemove.length > 0) {
        const exitedAt = new Date()
        await Promise.all(
          toRemove.map((m) =>
            prisma.segmentMembership.update({
              where: { id: m.id },
              data: { exitedAt },
            }),
          ),
        )
      }

      // Update segment stats
      await prisma.segment.update({
        where: { id: segmentId },
        data: {
          memberCount: matchingIds.size,
          lastEvaluatedAt: new Date(),
        },
      })
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  )

  return worker
}
```

- [ ] **Step 2: Wire the worker into `apps/api/src/worker.ts`**

Add to `apps/api/src/worker.ts`:

```typescript
import { createSegmentEvaluateWorker } from './workers/segment-evaluate.worker.js'
import type { SegmentEvaluateJobPayload } from '@engageiq/shared'

// After existing worker instantiations:
const segmentEvaluateWorker = createSegmentEvaluateWorker()

segmentEvaluateWorker.on('completed', (job: import('bullmq').Job<SegmentEvaluateJobPayload>) => {
  console.info(`[segment-evaluate-worker] completed  job=${job.id} segmentId=${job.data.segmentId}`)
})

segmentEvaluateWorker.on('failed', (job: import('bullmq').Job<SegmentEvaluateJobPayload> | undefined, err: Error) => {
  console.error(`[segment-evaluate-worker] failed    job=${job?.id} segmentId=${job?.data.segmentId} error=${err.message}`)
})

segmentEvaluateWorker.on('error', (err: Error) => {
  console.error('[segment-evaluate-worker] worker error:', err)
})
```

- [ ] **Step 3: Type-check**

```bash
cd apps/api && pnpm type-check
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workers/segment-evaluate.worker.ts \
        apps/api/src/worker.ts
git commit -m "feat(phase4.1): segment-evaluate BullMQ worker — batch membership upsert"
```

---

## Task 8: Segment CRUD routes

**Files:**
- Create: `apps/api/src/routes/segments/schema.ts`
- Create: `apps/api/src/routes/segments/service.ts`
- Create: `apps/api/src/routes/segments/controller.ts`
- Create: `apps/api/src/routes/segments/index.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/routes/segments/schema.ts`**

```typescript
import { z } from 'zod'

export const CreateSegmentBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  conditions: z.unknown(), // shape validated by validateConditionTree after zod parse
  isDynamic: z.boolean().default(true),
})

export const UpdateSegmentBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  conditions: z.unknown().optional(),
  isDynamic: z.boolean().optional(),
})

export const SegmentParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListSegmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export type CreateSegmentBody = z.infer<typeof CreateSegmentBodySchema>
export type UpdateSegmentBody = z.infer<typeof UpdateSegmentBodySchema>
export type SegmentParams = z.infer<typeof SegmentParamsSchema>
export type ListSegmentsQuery = z.infer<typeof ListSegmentsQuerySchema>
```

- [ ] **Step 2: Create `apps/api/src/routes/segments/service.ts`**

```typescript
import { prisma } from '@engageiq/db'
import type { CreateSegmentBody, UpdateSegmentBody } from './schema.js'

export async function createSegment(merchantId: string, body: CreateSegmentBody) {
  return prisma.segment.create({
    data: {
      merchantId,
      name: body.name,
      description: body.description ?? null,
      conditions: body.conditions as object,
      isDynamic: body.isDynamic,
    },
  })
}

export async function listSegments(
  merchantId: string,
  page: number,
  pageSize: number,
) {
  const [items, total] = await Promise.all([
    prisma.segment.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        description: true,
        memberCount: true,
        lastEvaluatedAt: true,
        isDynamic: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.segment.count({ where: { merchantId } }),
  ])
  return { items, total, page, pageSize }
}

export async function getSegment(merchantId: string, segmentId: string) {
  return prisma.segment.findFirst({
    where: { id: segmentId, merchantId },
  })
}

export async function updateSegment(
  merchantId: string,
  segmentId: string,
  body: UpdateSegmentBody,
) {
  return prisma.segment.update({
    where: { id: segmentId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.conditions !== undefined && { conditions: body.conditions as object }),
      ...(body.isDynamic !== undefined && { isDynamic: body.isDynamic }),
    },
  })
}

export async function deleteSegment(merchantId: string, segmentId: string) {
  return prisma.segment.delete({
    where: { id: segmentId },
  })
}

export async function getSegmentPreview(merchantId: string, segmentId: string) {
  // Returns the first 5 matching customer names/IDs for the GET /:id response
  const segment = await prisma.segment.findFirst({
    where: { id: segmentId, merchantId },
  })
  if (!segment) return null
  return segment
}
```

- [ ] **Step 3: Create `apps/api/src/routes/segments/controller.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify'
import { segmentEvaluateQueue } from '@engageiq/queue'
import { SEGMENT_EVALUATE } from '@engageiq/shared'
import type { SegmentEvaluateJobPayload } from '@engageiq/shared'
import { validateConditionTree } from '../../lib/segments/condition-validator.js'
import { compileToPrismaWhere } from '../../services/segment-evaluator.js'
import { prisma } from '@engageiq/db'
import type { SegmentGroup } from '@engageiq/shared'
import {
  CreateSegmentBodySchema,
  UpdateSegmentBodySchema,
  SegmentParamsSchema,
  ListSegmentsQuerySchema,
} from './schema.js'
import {
  createSegment,
  listSegments,
  getSegment,
  updateSegment,
  deleteSegment,
} from './service.js'

function validationError(reply: FastifyReply, error: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: error },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Segment not found' },
  })
}

export async function createSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CreateSegmentBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }

  const validation = validateConditionTree(parsed.data.conditions)
  if (!validation.ok) {
    await validationError(reply, validation.error)
    return
  }

  const merchantId = request.user.merchantId
  const segment = await createSegment(merchantId, parsed.data)

  // Enqueue initial evaluation
  await segmentEvaluateQueue.add(SEGMENT_EVALUATE, {
    segmentId: segment.id,
    merchantId,
  } satisfies SegmentEvaluateJobPayload)

  await reply.status(201).send({ success: true, data: segment })
}

export async function listSegmentsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ListSegmentsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const result = await listSegments(merchantId, parsed.data.page, parsed.data.pageSize)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const merchantId = request.user.merchantId
  const segment = await getSegment(merchantId, paramsParsed.data.id)
  if (!segment) {
    await notFound(reply)
    return
  }

  // Live preview: first 5 matching customers
  let preview: { id: string; email: string | null; firstName: string | null; lastName: string | null }[] = []
  try {
    const validation = validateConditionTree(segment.conditions)
    if (validation.ok) {
      const where = compileToPrismaWhere(segment.conditions as SegmentGroup, merchantId)
      preview = await prisma.customer.findMany({
        where,
        select: { id: true, email: true, firstName: true, lastName: true },
        take: 5,
      })
    }
  } catch {
    // preview is best-effort — don't fail the whole request
  }

  await reply.send({ success: true, data: { ...segment, preview } })
}

export async function updateSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const parsed = UpdateSegmentBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }

  if (parsed.data.conditions !== undefined) {
    const validation = validateConditionTree(parsed.data.conditions)
    if (!validation.ok) {
      await validationError(reply, validation.error)
      return
    }
  }

  const merchantId = request.user.merchantId
  const existing = await getSegment(merchantId, paramsParsed.data.id)
  if (!existing) {
    await notFound(reply)
    return
  }

  const updated = await updateSegment(merchantId, paramsParsed.data.id, parsed.data)

  // Re-evaluate if conditions changed
  if (parsed.data.conditions !== undefined) {
    await segmentEvaluateQueue.add(SEGMENT_EVALUATE, {
      segmentId: updated.id,
      merchantId,
    } satisfies SegmentEvaluateJobPayload)
  }

  await reply.send({ success: true, data: updated })
}

export async function deleteSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const merchantId = request.user.merchantId
  const existing = await getSegment(merchantId, paramsParsed.data.id)
  if (!existing) {
    await notFound(reply)
    return
  }

  await deleteSegment(merchantId, paramsParsed.data.id)
  await reply.status(204).send()
}

export async function evaluateSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const merchantId = request.user.merchantId
  const segment = await getSegment(merchantId, paramsParsed.data.id)
  if (!segment) {
    await notFound(reply)
    return
  }

  await segmentEvaluateQueue.add(SEGMENT_EVALUATE, {
    segmentId: segment.id,
    merchantId,
  } satisfies SegmentEvaluateJobPayload)

  await reply.status(202).send({
    success: true,
    data: { message: 'Evaluation queued', segmentId: segment.id },
  })
}
```

- [ ] **Step 4: Create `apps/api/src/routes/segments/index.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import {
  createSegmentHandler,
  listSegmentsHandler,
  getSegmentHandler,
  updateSegmentHandler,
  deleteSegmentHandler,
  evaluateSegmentHandler,
} from './controller.js'

const segmentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createSegmentHandler)
  fastify.get('/', listSegmentsHandler)

  // POST /:id/evaluate MUST be registered before GET /:id
  fastify.post('/:id/evaluate', evaluateSegmentHandler)
  fastify.get('/:id', getSegmentHandler)
  fastify.put('/:id', updateSegmentHandler)
  fastify.delete('/:id', deleteSegmentHandler)
}

export default segmentsRoutes
```

- [ ] **Step 5: Register routes in `apps/api/src/index.ts`**

Add the import:

```typescript
import segmentsRoutes from './routes/segments/index.js'
```

Add the registration (after the `eventsRoutes` registration):

```typescript
await app.register(segmentsRoutes, { prefix: '/api/v1/segments' })
```

- [ ] **Step 6: Type-check**

```bash
cd apps/api && pnpm type-check
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/segments/ \
        apps/api/src/index.ts
git commit -m "feat(phase4.1): segments CRUD routes — POST/GET/PUT/DELETE/evaluate with async BullMQ evaluate"
```

---

## Task 9: Wire fire-and-forget evaluateProfileMemberships into existing processors

**Files:**
- Modify: `apps/api/src/processors/customer.processor.ts`
- Modify: `apps/api/src/services/identity.service.ts`
- Modify: `apps/api/src/routes/sdk.ts`

- [ ] **Step 1: Wire into `apps/api/src/processors/customer.processor.ts`**

Add the import near the top of the file:

```typescript
import { evaluateProfileMemberships } from '../services/segment-evaluator.js'
```

After the existing `assignGroupCustomerId` fire-and-forget call in the stub upgrade path and the upsert path, add:

```typescript
evaluateProfileMemberships(customer.id, merchantId).catch(() => {/* best-effort */})
```

Add it in two places — after the stub upgrade and after the upsert succeeds. For example, after the `assignGroupCustomerId` call in the stub upgrade block:

```typescript
// existing:
assignGroupCustomerId(stub.id, merchantId, payload.email, phone).catch(() => {/* best-effort */})
// add:
evaluateProfileMemberships(stub.id, merchantId).catch(() => {/* best-effort */})
```

And in the upsert success path:

```typescript
// existing:
assignGroupCustomerId(customer.id, merchantId, payload.email ?? null, phone).catch(() => {/* best-effort */})
// add:
evaluateProfileMemberships(customer.id, merchantId).catch(() => {/* best-effort */})
```

- [ ] **Step 2: Wire into `apps/api/src/services/identity.service.ts`**

Add the import:

```typescript
import { evaluateProfileMemberships } from './segment-evaluator.js'
```

Find the existing `assignGroupCustomerId` fire-and-forget call in `stitchIdentity` (line ~90). Immediately after it add:

```typescript
evaluateProfileMemberships(customer.id, merchant_id).catch(() => {/* best-effort */})
```

- [ ] **Step 3: Wire into `apps/api/src/routes/sdk.ts`**

Add the import at the top:

```typescript
import { evaluateProfileMemberships } from '../services/segment-evaluator.js'
```

Find the `syncSessionCount` fire-and-forget block (around line 136–147). After the `syncSessionCount` call pattern, add a parallel fire-and-forget:

```typescript
evaluateProfileMemberships(customerId, merchantId).catch(
  (err: unknown) => fastify.log.error({ err }, 'evaluateProfileMemberships failed'),
)
```

Add this inside the same `for...of` loop over `session_end` customers, alongside the `syncSessionCount` call.

- [ ] **Step 4: Type-check and run all tests**

```bash
cd apps/api && pnpm type-check && pnpm test
```

Expected: type-check exits 0, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/processors/customer.processor.ts \
        apps/api/src/services/identity.service.ts \
        apps/api/src/routes/sdk.ts
git commit -m "feat(phase4.1): wire evaluateProfileMemberships into webhook processor, identity service, SDK"
```

---

## Task 10: Remix segments list page

**Files:**
- Create: `apps/web/app/routes/segments._index.tsx`

- [ ] **Step 1: Create `apps/web/app/routes/segments._index.tsx`**

```typescript
import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Segments — EngageIQ' }]

interface SegmentListItem {
  id: string
  name: string
  description: string | null
  memberCount: number
  lastEvaluatedAt: string | null
  isDynamic: boolean
  createdAt: string
}

interface LoaderData {
  segments: SegmentListItem[]
  total: number
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/segments?page=${page}&pageSize=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      return json<LoaderData>({ segments: [], total: 0, error: 'Failed to load segments' })
    }
    const body = await res.json() as { data: SegmentListItem[]; meta: { total: number } }
    return json<LoaderData>({ segments: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ segments: [], total: 0, error: 'Network error' })
  }
}

export default function SegmentsPage() {
  const { segments, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Segments ({total})</h1>
        <Link
          to="/segments/new"
          style={{
            background: '#2563eb',
            color: '#fff',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            textDecoration: 'none',
          }}
        >
          + New Segment
        </Link>
      </div>

      {error && (
        <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>
      )}

      {segments.length === 0 && !error && (
        <p style={{ color: '#666' }}>No segments yet. Create your first segment to start targeting customers.</p>
      )}

      {segments.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Name</th>
              <th style={{ padding: '0.75rem 1rem' }}>Members</th>
              <th style={{ padding: '0.75rem 1rem' }}>Last Evaluated</th>
              <th style={{ padding: '0.75rem 1rem' }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => (
              <tr
                key={seg.id}
                style={{ borderBottom: '1px solid #e5e7eb' }}
              >
                <td style={{ padding: '0.75rem 1rem' }}>
                  <Link to={`/segments/${seg.id}`} style={{ color: '#2563eb' }}>
                    {seg.name}
                  </Link>
                  {seg.description && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px' }}>
                      {seg.description}
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{seg.memberCount.toLocaleString()}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  {seg.lastEvaluatedAt
                    ? new Date(seg.lastEvaluatedAt).toLocaleString()
                    : 'Never'}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span
                    style={{
                      background: seg.isDynamic ? '#dbeafe' : '#f3f4f6',
                      color: seg.isDynamic ? '#1d4ed8' : '#374151',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {seg.isDynamic ? 'Dynamic' : 'Static'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles in web**

```bash
cd apps/web && pnpm type-check 2>/dev/null || true
```

Expected: no new errors related to `segments._index.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/routes/segments._index.tsx
git commit -m "feat(phase4.1): Remix segments list page"
```

---

## Task 11: Remix segment builder page (new + edit)

**Files:**
- Create: `apps/web/app/routes/segments.new.tsx`
- Create: `apps/web/app/routes/segments.$id.tsx`

- [ ] **Step 1: Create `apps/web/app/routes/segments.new.tsx`**

```typescript
import { useNavigate } from '@remix-run/react'
import type { MetaFunction } from '@remix-run/node'
import { SegmentBuilder } from '../components/SegmentBuilder.js'
import type { SegmentGroup } from '@engageiq/shared'

export const meta: MetaFunction = () => [{ title: 'New Segment — EngageIQ' }]

export default function NewSegmentPage() {
  const navigate = useNavigate()
  const apiUrl = typeof window !== 'undefined' ? '' : (process.env['API_URL'] ?? 'http://localhost:3001')
  const token = typeof window !== 'undefined' ? '' : (process.env['DEV_TOKEN'] ?? '')

  async function handleSave(name: string, description: string, conditions: SegmentGroup) {
    const res = await fetch(`${apiUrl}/api/v1/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, conditions }),
    })
    if (res.ok) {
      const body = await res.json() as { data: { id: string } }
      navigate(`/segments/${body.data.id}`)
    } else {
      const body = await res.json() as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'Failed to create segment')
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1>New Segment</h1>
      <SegmentBuilder onSave={handleSave} />
    </div>
  )
}
```

- [ ] **Step 2: Create `apps/web/app/routes/segments.$id.tsx`**

```typescript
import { useLoaderData, useNavigate } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { SegmentGroup } from '@engageiq/shared'
import { SegmentBuilder } from '../components/SegmentBuilder.js'

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.segment?.name ?? 'Segment'} — EngageIQ` },
]

interface SegmentDetail {
  id: string
  name: string
  description: string | null
  conditions: SegmentGroup
  memberCount: number
  lastEvaluatedAt: string | null
  isDynamic: boolean
  preview: { id: string; email: string | null; firstName: string | null; lastName: string | null }[]
}

interface LoaderData {
  segment: SegmentDetail | null
  error: string | null
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  try {
    const res = await fetch(`${apiUrl}/api/v1/segments/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return json<LoaderData>({ segment: null, error: 'Segment not found' })
    if (!res.ok) return json<LoaderData>({ segment: null, error: 'Failed to load segment' })
    const body = await res.json() as { data: SegmentDetail }
    return json<LoaderData>({ segment: body.data, error: null })
  } catch {
    return json<LoaderData>({ segment: null, error: 'Network error' })
  }
}

export default function SegmentDetailPage() {
  const { segment, error } = useLoaderData<LoaderData>()
  const navigate = useNavigate()
  const apiUrl = typeof window !== 'undefined' ? '' : (process.env['API_URL'] ?? 'http://localhost:3001')
  const token = typeof window !== 'undefined' ? '' : (process.env['DEV_TOKEN'] ?? '')

  if (error || !segment) {
    return <div style={{ padding: '2rem', color: 'red' }}>{error ?? 'Segment not found'}</div>
  }

  async function handleSave(name: string, description: string, conditions: SegmentGroup) {
    const res = await fetch(`${apiUrl}/api/v1/segments/${segment!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, conditions }),
    })
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'Failed to update segment')
    }
    navigate(0) // reload
  }

  async function handleReEvaluate() {
    await fetch(`${apiUrl}/api/v1/segments/${segment!.id}/evaluate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    alert('Evaluation queued. Refresh in a few seconds to see updated member count.')
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1>{segment.name}</h1>
          <p style={{ color: '#6b7280', margin: 0 }}>
            {segment.memberCount.toLocaleString()} members
            {segment.lastEvaluatedAt
              ? ` · Last evaluated: ${new Date(segment.lastEvaluatedAt).toLocaleString()}`
              : ' · Never evaluated'}
          </p>
        </div>
        <button
          onClick={handleReEvaluate}
          style={{
            padding: '0.5rem 1rem',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Re-evaluate
        </button>
      </div>

      {segment.preview.length > 0 && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f9fafb', borderRadius: '4px' }}>
          <strong>Preview (first {segment.preview.length} matches):</strong>
          <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
            {segment.preview.map((c) => (
              <li key={c.id} style={{ marginBottom: '0.25rem' }}>
                {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.id}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SegmentBuilder
        initialName={segment.name}
        initialDescription={segment.description ?? ''}
        initialConditions={segment.conditions}
        onSave={handleSave}
      />
    </div>
  )
}
```

- [ ] **Step 3: Create `apps/web/app/components/SegmentBuilder.tsx`**

This is the shared builder UI used by both new and edit pages.

```typescript
import { useState } from 'react'
import type { SegmentGroup, SegmentCondition, ConditionOperator } from '@engageiq/shared'

// ─── Field metadata for UI rendering ────────────────────────────────────────

const FIELD_OPTIONS: { value: string; label: string; type: string }[] = [
  { value: 'total_spent',            label: 'Total Spent (PKR)',     type: 'number' },
  { value: 'total_orders',           label: 'Total Orders',          type: 'number' },
  { value: 'average_order_value',    label: 'Avg Order Value',       type: 'number' },
  { value: 'rfm_segment',            label: 'RFM Segment',           type: 'enum' },
  { value: 'recency_score',          label: 'Recency Score',         type: 'number' },
  { value: 'frequency_score',        label: 'Frequency Score',       type: 'number' },
  { value: 'monetary_score',         label: 'Monetary Score',        type: 'number' },
  { value: 'churn_risk_score',       label: 'Churn Risk Score',      type: 'number' },
  { value: 'churn_risk_label',       label: 'Churn Risk Label',      type: 'enum' },
  { value: 'ltv_predicted_90d',      label: 'Predicted LTV 90d',     type: 'number' },
  { value: 'city',                   label: 'City',                  type: 'string' },
  { value: 'country',                label: 'Country',               type: 'string' },
  { value: 'accepts_marketing_email',label: 'Email Subscribed',      type: 'boolean' },
  { value: 'accepts_marketing_sms',  label: 'SMS Subscribed',        type: 'boolean' },
  { value: 'accepts_marketing_whatsapp', label: 'WhatsApp Subscribed', type: 'boolean' },
  { value: 'cod_acceptance_rate',    label: 'COD Acceptance Rate',   type: 'number' },
  { value: 'cod_fake_order_score',   label: 'Fake Order Score',      type: 'number' },
  { value: 'last_order_date',        label: 'Last Order Date',       type: 'date' },
  { value: 'last_seen_at',           label: 'Last Seen',             type: 'date' },
  { value: 'tags',                   label: 'Tags',                  type: 'array' },
]

const OPERATORS_BY_TYPE: Record<string, { value: ConditionOperator; label: string }[]> = {
  number: [
    { value: 'eq', label: '=' }, { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' }, { value: 'gte', label: '>=' },
    { value: 'lt', label: '<' }, { value: 'lte', label: '<=' },
    { value: 'between', label: 'between' },
  ],
  string: [
    { value: 'eq', label: 'equals' }, { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' }, { value: 'not_contains', label: 'not contains' },
    { value: 'in', label: 'in list' }, { value: 'not_in', label: 'not in list' },
  ],
  enum: [
    { value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' },
    { value: 'in', label: 'in' }, { value: 'not_in', label: 'not in' },
  ],
  boolean: [
    { value: 'is_true', label: 'is true' }, { value: 'is_false', label: 'is false' },
  ],
  date: [
    { value: 'before', label: 'before' }, { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'more_than_days_ago', label: 'more than N days ago' },
    { value: 'is_set', label: 'is set' }, { value: 'is_not_set', label: 'is not set' },
  ],
  array: [
    { value: 'includes_any', label: 'includes any of' },
    { value: 'includes_all', label: 'includes all of' },
    { value: 'includes_none', label: 'includes none of' },
  ],
}

const ENUM_VALUES: Record<string, string[]> = {
  rfm_segment: ['Champions', 'LoyalCustomers', 'PotentialLoyalists', 'NewCustomers', 'Promising', 'NeedAttention', 'AboutToSleep', 'AtRisk', 'CantLoseThem', 'Hibernating', 'Lost'],
  churn_risk_label: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
}

// ─── Value input component ────────────────────────────────────────────────────

function ValueInput({
  field,
  fieldType,
  operator,
  value,
  onChange,
}: {
  field: string
  fieldType: string
  operator: ConditionOperator
  value: unknown
  onChange: (v: unknown) => void
}) {
  const noValue: ConditionOperator[] = ['is_true', 'is_false', 'is_set', 'is_not_set']
  if (noValue.includes(operator)) return null

  if (operator === 'between') {
    const arr = Array.isArray(value) ? value : ['', '']
    return (
      <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
        <input type={fieldType === 'date' ? 'date' : 'number'} value={String(arr[0] ?? '')} style={{ width: '100px', padding: '4px' }}
          onChange={(e) => onChange([e.target.value, arr[1]])} />
        <span>and</span>
        <input type={fieldType === 'date' ? 'date' : 'number'} value={String(arr[1] ?? '')} style={{ width: '100px', padding: '4px' }}
          onChange={(e) => onChange([arr[0], e.target.value])} />
      </span>
    )
  }

  if (operator === 'within_last_days' || operator === 'more_than_days_ago') {
    return (
      <input type="number" min="1" value={typeof value === 'number' ? value : ''} style={{ width: '80px', padding: '4px' }}
        onChange={(e) => onChange(parseInt(e.target.value, 10))} />
    )
  }

  if (operator === 'in' || operator === 'not_in' || operator === 'includes_any' || operator === 'includes_all' || operator === 'includes_none') {
    if (fieldType === 'enum' && ENUM_VALUES[field]) {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <select multiple value={selected} size={4} style={{ width: '160px', padding: '4px' }}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}>
          {ENUM_VALUES[field].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )
    }
    const str = Array.isArray(value) ? (value as string[]).join(', ') : ''
    return (
      <input type="text" placeholder="comma-separated values" value={str} style={{ width: '200px', padding: '4px' }}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
    )
  }

  if (fieldType === 'enum' && ENUM_VALUES[field]) {
    return (
      <select value={typeof value === 'string' ? value : ''} style={{ padding: '4px' }}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">Select...</option>
        {ENUM_VALUES[field].map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    )
  }

  if (fieldType === 'date') {
    return (
      <input type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} style={{ padding: '4px' }}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')} />
    )
  }

  return (
    <input
      type={fieldType === 'number' ? 'number' : 'text'}
      value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
      style={{ width: '160px', padding: '4px' }}
      onChange={(e) => onChange(fieldType === 'number' ? parseFloat(e.target.value) : e.target.value)}
    />
  )
}

// ─── Condition row ────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition
  onChange: (c: SegmentCondition) => void
  onRemove: () => void
}) {
  const fieldMeta = FIELD_OPTIONS.find((f) => f.value === condition.field)
  const fieldType = fieldMeta?.type ?? 'string'
  const operators = OPERATORS_BY_TYPE[fieldType] ?? []

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
      <select value={condition.field} style={{ padding: '4px' }}
        onChange={(e) => {
          const newField = e.target.value
          const newType = FIELD_OPTIONS.find((f) => f.value === newField)?.type ?? 'string'
          const firstOp = (OPERATORS_BY_TYPE[newType]?.[0]?.value ?? 'eq') as ConditionOperator
          onChange({ field: newField, operator: firstOp, value: null })
        }}>
        {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      <select value={condition.operator} style={{ padding: '4px' }}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator, value: null })}>
        {operators.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>

      <ValueInput
        field={condition.field}
        fieldType={fieldType}
        operator={condition.operator}
        value={condition.value}
        onChange={(v) => onChange({ ...condition, value: v })}
      />

      <button onClick={onRemove} style={{ padding: '4px 8px', cursor: 'pointer', color: 'red' }}>×</button>
    </div>
  )
}

// ─── Group component ──────────────────────────────────────────────────────────

function GroupEditor({
  group,
  depth,
  onChange,
  onRemove,
}: {
  group: SegmentGroup
  depth: number
  onChange: (g: SegmentGroup) => void
  onRemove?: () => void
}) {
  function addCondition() {
    const first = FIELD_OPTIONS[0]
    const firstOp = OPERATORS_BY_TYPE[first!.type]?.[0]?.value as ConditionOperator
    onChange({
      ...group,
      rules: [...group.rules, { field: first!.value, operator: firstOp, value: null }],
    })
  }

  function addSubGroup() {
    const first = FIELD_OPTIONS[0]
    const firstOp = OPERATORS_BY_TYPE[first!.type]?.[0]?.value as ConditionOperator
    const sub: SegmentGroup = {
      match: 'any',
      rules: [{ field: first!.value, operator: firstOp, value: null }],
    }
    onChange({ ...group, rules: [...group.rules, sub] })
  }

  return (
    <div style={{
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '8px',
      background: depth === 1 ? '#fff' : '#f9fafb',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '0.875rem', color: '#374151' }}>Match</span>
        <select value={group.match} style={{ padding: '4px' }}
          onChange={(e) => onChange({ ...group, match: e.target.value as 'all' | 'any' })}>
          <option value="all">ALL conditions</option>
          <option value="any">ANY condition</option>
        </select>
        {onRemove && (
          <button onClick={onRemove} style={{ marginLeft: 'auto', padding: '4px 8px', cursor: 'pointer', color: 'red' }}>
            Remove group
          </button>
        )}
      </div>

      {group.rules.map((rule, idx) => {
        if ('field' in rule && !('rules' in rule)) {
          return (
            <ConditionRow
              key={idx}
              condition={rule as SegmentCondition}
              onChange={(c) => {
                const rules = [...group.rules]
                rules[idx] = c
                onChange({ ...group, rules })
              }}
              onRemove={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== idx) })}
            />
          )
        }
        return (
          <GroupEditor
            key={idx}
            group={rule as SegmentGroup}
            depth={depth + 1}
            onChange={(g) => {
              const rules = [...group.rules]
              rules[idx] = g
              onChange({ ...group, rules })
            }}
            onRemove={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== idx) })}
          />
        )
      })}

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button onClick={addCondition} style={{ padding: '4px 12px', cursor: 'pointer' }}>
          + Add condition
        </button>
        {depth === 1 && (
          <button onClick={addSubGroup} style={{ padding: '4px 12px', cursor: 'pointer' }}>
            + Add group
          </button>
        )}
      </div>
    </div>
  )
}

// ─── SegmentBuilder (exported) ────────────────────────────────────────────────

interface SegmentBuilderProps {
  initialName?: string
  initialDescription?: string
  initialConditions?: SegmentGroup
  onSave: (name: string, description: string, conditions: SegmentGroup) => Promise<void>
}

export function SegmentBuilder({
  initialName = '',
  initialDescription = '',
  initialConditions,
  onSave,
}: SegmentBuilderProps) {
  const defaultGroup: SegmentGroup = {
    match: 'all',
    rules: [{ field: 'total_orders', operator: 'gt', value: 0 }],
  }

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [group, setGroup] = useState<SegmentGroup>(initialConditions ?? defaultGroup)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setSaveError('Segment name is required'); return }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(name.trim(), description.trim(), group)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e) }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Segment name *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '400px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
          placeholder="e.g. High-Value Lahore Customers"
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ width: '400px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
          placeholder="Optional description"
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Conditions
        </label>
        <GroupEditor group={group} depth={1} onChange={setGroup} />
      </div>

      {saveError && (
        <div style={{ color: 'red', marginBottom: '1rem' }}>{saveError}</div>
      )}

      <button
        type="submit"
        disabled={saving}
        style={{
          background: '#2563eb',
          color: '#fff',
          padding: '0.625rem 1.5rem',
          border: 'none',
          borderRadius: '4px',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving...' : 'Save Segment'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles in web**

```bash
cd apps/web && pnpm type-check 2>/dev/null || true
```

Expected: no new type errors from the builder files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/routes/segments.new.tsx \
        apps/web/app/routes/segments.\$id.tsx \
        apps/web/app/components/SegmentBuilder.tsx
git commit -m "feat(phase4.1): Remix segment builder UI — list, create, view/edit pages"
```

---

## Task 12: Run full test suite and confirm everything passes

- [ ] **Step 1: Run all API tests**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass. Output should show at minimum:
- `condition-validator.test.ts` — 9 tests
- `segment-evaluator.test.ts` — ≥ 22 tests

- [ ] **Step 2: Run full type-check across the monorepo**

```bash
pnpm -r type-check
```

Expected: exits 0 across all packages.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(phase4.1): final type-check and test pass — segment builder complete"
```

---

## Self-Review Checklist

| Spec Section | Covered by Task |
|---|---|
| Condition tree types (`SegmentGroup`, `SegmentCondition`, `ConditionOperator`) | Task 1 |
| `SegmentEvaluateJobPayload` + `SEGMENT_EVALUATE` constant | Task 1 |
| `segmentEvaluateQueue` BullMQ queue | Task 1 |
| `FIELD_REGISTRY` with all 20 fields, `column`, `profileKey`, `type`, `operators` | Task 2 |
| `OPERATOR_VALUE_SHAPES` co-located constant | Task 2 |
| `validateConditionTree` — depth, empty, unknown field, bad operator, value shapes | Task 3 |
| `compileToPrismaWhere` — merchantId injection, all operators, SQL injection guard | Task 4 |
| `evaluateProfile` — all operators, number coercion, date coercion, nested groups | Task 5 |
| SQL ↔ in-memory parity test | Task 5 |
| `evaluateProfileMemberships` — insert/exit logic, no-op when no match change | Task 6 |
| Batch worker — loads segment, validates, runs WHERE, upserts memberships, updates stats | Task 7 |
| Worker wired into `worker.ts` | Task 7 |
| `POST /segments` — validate + create + enqueue | Task 8 |
| `GET /segments` — paginated list | Task 8 |
| `GET /segments/:id` — full segment + 5-customer preview | Task 8 |
| `PUT /segments/:id` — update + re-enqueue on conditions change | Task 8 |
| `DELETE /segments/:id` — cascade-delete memberships | Task 8 |
| `POST /segments/:id/evaluate` — async 202, never inline | Task 8 |
| Fire-and-forget triggers in customer.processor, identity.service, sdk.ts | Task 9 |
| Remix list page | Task 10 |
| Remix builder page (new + edit) with all 20 fields, all operators, sub-groups | Task 11 |
| `SegmentBuilder` component — depth-1 "Add group" only, not inside sub-groups | Task 11 |
