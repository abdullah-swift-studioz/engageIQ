# Segment Builder — Design Spec

**Date:** 2026-06-06
**Phase:** 4.1
**Status:** Approved

---

## Overview

The Segment Builder lets merchants define dynamic customer segments using a condition tree. Segments drive campaign targeting and journey entry/exit. The system has two evaluation paths — a batch SQL compiler and a real-time in-memory evaluator — both driven by the same condition tree definition and the same field registry.

---

## 1. Condition Tree Data Model

### Storage

`Segment.conditions` (already a `Json` column in Prisma) stores the condition tree. No schema migration is required. The column is treated as JSONB in Postgres.

### TypeScript Shape (in `packages/shared/src/types.ts`)

```typescript
export type ConditionOperator =
  // Number
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  // String / Enum
  | 'in' | 'not_in' | 'contains' | 'not_contains'
  // Boolean
  | 'is_true' | 'is_false'
  // Date
  | 'before' | 'after' | 'within_last_days' | 'more_than_days_ago'
  // Date nullability
  | 'is_set' | 'is_not_set'
  // Array
  | 'includes_any' | 'includes_all' | 'includes_none'

export interface SegmentCondition {
  field: string            // must be a key in FIELD_REGISTRY
  operator: ConditionOperator
  value: unknown           // shape validated against operator + field type at save time
}

export interface SegmentGroup {
  match: 'all' | 'any'    // 'all' = AND, 'any' = OR
  rules: Array<SegmentCondition | SegmentGroup>
}
```

### Depth Cap

Maximum nesting depth is **2 levels**:

- Level 1: the root `SegmentGroup`
- Level 2: `SegmentGroup` items inside the root's `rules` array

A `SegmentGroup` at depth 2 may only contain `SegmentCondition` items, never another `SegmentGroup`. The validator rejects any structure violating this before the tree reaches the compiler or evaluator.

---

## 2. Field Registry

### Location

`apps/api/src/lib/segments/field-registry.ts`

Both the SQL compiler and the in-memory evaluator import from this file. Nothing in `routes/` defines field mappings. Nothing in `services/` imports from `routes/`.

### FieldDef Interface

```typescript
export interface FieldDef {
  column: string           // actual Postgres column on the customers table (SQL compiler only)
  profileKey: string       // dot-path on EnrichedCustomerProfile (in-memory evaluator only)
  type: 'number' | 'string' | 'boolean' | 'date' | 'array' | 'enum'
  enumValues?: string[]    // required when type === 'enum'
  operators: ConditionOperator[]
}
```

The in-memory evaluator uses `profileKey` exclusively — never `column`. The SQL compiler uses `column` exclusively — never `profileKey`.

### Registry Entries (all 20 fields)

| Registry Key | `column` | `profileKey` | `type` |
|---|---|---|---|
| `total_spent` | `total_spent` | `totalSpent` | `number` |
| `total_orders` | `total_orders` | `totalOrders` | `number` |
| `average_order_value` | `avg_order_value` | `avgOrderValue` | `number` |
| `rfm_segment` | `rfm_segment` | `rfmSegment` | `enum` |
| `recency_score` | `rfm_recency_score` | `rfmRecencyScore` | `number` |
| `frequency_score` | `rfm_frequency_score` | `rfmFrequencyScore` | `number` |
| `monetary_score` | `rfm_monetary_score` | `rfmMonetaryScore` | `number` |
| `churn_risk_score` | `churn_score` | `churnScore` | `number` |
| `churn_risk_label` | `churn_risk_label` | `churnRiskLabel` | `enum` |
| `ltv_predicted_90d` | `ltv_90d` | `ltv90d` | `number` |
| `city` | `city` | `city` | `string` |
| `country` | `country` | `country` | `string` |
| `accepts_marketing_email` | `is_subscribed_email` | `isSubscribedEmail` | `boolean` |
| `accepts_marketing_sms` | `is_subscribed_sms` | `isSubscribedSms` | `boolean` |
| `accepts_marketing_whatsapp` | `is_subscribed_whatsapp` | `isSubscribedWhatsapp` | `boolean` |
| `cod_acceptance_rate` | `cod_acceptance_rate` | `codAcceptanceRate` | `number` |
| `cod_fake_order_score` | `fake_order_score` | `fakeOrderScore` | `number` |
| `last_order_date` | `last_order_at` | `lastOrderAt` | `date` |
| `last_seen_at` | `last_seen_at` | `lastSeenAt` | `date` |
| `tags` | `tags` | `tags` | `array` |

`rfm_segment` enum values: `Champions`, `LoyalCustomers`, `PotentialLoyalists`, `NewCustomers`, `Promising`, `NeedAttention`, `AboutToSleep`, `AtRisk`, `CantLoseThem`, `Hibernating`, `Lost`

`churn_risk_label` enum values: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

### Operators by Field Type

| Type | Allowed Operators |
|---|---|
| `number` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between` |
| `string` | `eq`, `neq`, `in`, `not_in`, `contains`, `not_contains` |
| `enum` | `eq`, `neq`, `in`, `not_in` |
| `boolean` | `is_true`, `is_false` |
| `date` | `before`, `after`, `between`, `within_last_days`, `more_than_days_ago`, `is_set`, `is_not_set` |
| `array` | `includes_any`, `includes_all`, `includes_none` |

---

## 3. Value Shape Validation

The validator enforces value shapes **per operator** before the condition tree reaches the compiler. Shapes are documented in a co-located constant in `field-registry.ts`:

| Operator(s) | Required `value` shape |
|---|---|
| `between` | `[min, max]` — two-element tuple of the field's base type (both numbers for numeric fields, both ISO date strings for date fields) |
| `within_last_days`, `more_than_days_ago` | Positive integer (number of days) |
| `in`, `not_in`, `includes_any`, `includes_all`, `includes_none` | Non-empty array of the field's base type |
| `is_true`, `is_false`, `is_set`, `is_not_set` | `null` or `undefined` — no value needed |
| All other operators | Scalar matching the field's base type |

Validation is performed in `apps/api/src/lib/segments/condition-validator.ts`, called on every `POST /segments` and `PUT /segments/:id` request. Invalid conditions return `400` with the Zod-formatted error envelope before any DB write.

---

## 4. Evaluation Engine

### Location

`apps/api/src/services/segment-evaluator.ts`

### Batch Path (SQL Compiler)

`compileToPrismaWhere(group: SegmentGroup, merchantId: string): Prisma.CustomerWhereInput`

- Recursively walks the condition tree (max depth 2, guaranteed by prior validation)
- A `SegmentGroup` with `match: 'all'` maps to `{ AND: [...] }`; `match: 'any'` maps to `{ OR: [...] }`
- A `SegmentCondition` is resolved via the registry: `FIELD_REGISTRY[condition.field].column` → Prisma filter object
- `merchantId` is injected as the outermost `AND` clause by the compiler itself — the caller cannot omit or override it
- All values are passed as Prisma parameters — no string interpolation of user data

### In-Memory Path (Profile Evaluator)

`evaluateProfile(group: SegmentGroup, profile: EnrichedCustomerProfile): boolean`

- Same tree walk, same operator semantics
- Field values are read via `FIELD_REGISTRY[condition.field].profileKey` resolved as a dot-path on the profile object — never from `column`
- Returns `true` if the profile matches the group; `false` otherwise
- No DB access — pure function, runs synchronously

### SQL ↔ In-Memory Parity

A Vitest test in `segment-evaluator.test.ts` generates a fixed set of 10 synthetic `EnrichedCustomerProfile` objects, runs both paths against the same `SegmentGroup` definition, and asserts identical membership results for every profile. This test must pass before any PR touching the evaluator is merged.

### Real-Time Trigger Points (fire-and-forget)

After each of these existing processors completes, call `evaluateProfileMemberships(customerId, merchantId)` — a service function that loads all active segments for the merchant, runs `evaluateProfile` against the updated customer, and upserts `SegmentMembership` rows (sets `exitedAt` for exits, inserts for new entries):

- `apps/api/src/processors/customer.processor.ts` — after any Shopify customer webhook update
- `apps/api/src/services/identity.service.ts` — after merge or stitch
- `apps/api/src/routes/sdk.ts` / `syncSessionCount` — after session count sync

---

## 5. BullMQ Batch Evaluation Job

### Job Type (in `packages/queue/src/jobs.ts` or equivalent shared queue types file)

```typescript
export interface SegmentEvaluateJobPayload {
  segmentId: string
  merchantId: string
}

export const SEGMENT_EVALUATE = 'segment:evaluate'
```

### Worker (`apps/api/src/workers/segment-evaluate.worker.ts`)

1. Load the segment by `segmentId` (scoped by `merchantId` — never skip this check)
2. Parse and validate `conditions` into a `SegmentGroup`
3. Call `compileToPrismaWhere` to get the `CustomerWhereInput`
4. Query `customers` with that WHERE clause, selecting only `id`
5. Upsert `SegmentMembership` rows:
   - Insert new rows (set `enteredAt = now()`) for customers in the result set with no active membership
   - Set `exitedAt = now()` on active memberships for customers no longer in the result set
6. Update `segment.memberCount` and `segment.lastEvaluatedAt`

The worker must be idempotent — re-running the job produces the same final state.

---

## 6. API Routes

Route group: `apps/api/src/routes/segments/`

| Method | Path | Auth | Status | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/segments` | JWT | `201` | Create segment. Validates depth, field registry, value shapes. Enqueues initial evaluate job. |
| `GET` | `/api/v1/segments` | JWT | `200` | Paginated list. Returns `id, name, description, memberCount, lastEvaluatedAt, isDynamic, createdAt`. |
| `GET` | `/api/v1/segments/:id` | JWT | `200` | Full segment + first 5 matching customer names/IDs as a live preview (runs `compileToPrismaWhere` inline — small result set, acceptable). |
| `PUT` | `/api/v1/segments/:id` | JWT | `200` | Update name / description / conditions. Re-validates. Enqueues re-evaluate job. |
| `DELETE` | `/api/v1/segments/:id` | JWT | `204` | Hard delete. Prisma cascade removes `SegmentMembership` rows. |
| `POST` | `/api/v1/segments/:id/evaluate` | JWT | `202` | Enqueues `SEGMENT_EVALUATE` job. Returns immediately. Never runs batch query inline. |

All routes are tenant-scoped: `merchantId` comes from `request.merchant_id` (resolved by the tenant middleware), never from the request body.

---

## 7. Remix UI

### Routes

- `apps/web/app/routes/segments._index.tsx` — list page
- `apps/web/app/routes/segments.new.tsx` — create page
- `apps/web/app/routes/segments.$id.tsx` — view/edit page

### List Page

Table columns: Name, Member Count, Last Evaluated, Dynamic badge. "New Segment" button → `/segments/new`. Row click → `/segments/:id`.

### Builder Page (new + edit)

- Segment name + description inputs
- Root match selector: **Match ALL / Match ANY**
- Condition row: field dropdown (all 20 registry fields) → operator dropdown (filtered to field type) → value input (rendered by type: text, number, date picker, multi-select for enum/array)
- "Add condition" button adds a `SegmentCondition` to the root group
- "Add group" button adds a sub-`SegmentGroup` (match selector + its own condition rows). Limited to one level deep — the "Add group" button is hidden inside a sub-group.
- Save calls `POST /api/v1/segments` or `PUT /api/v1/segments/:id`. On success, shows member count returned from the API.
- On the view page, shows the current member count and last evaluated time, with a "Re-evaluate" button that calls `POST /api/v1/segments/:id/evaluate` and shows a "Evaluation queued" toast.

---

## 8. Test Coverage

`apps/api/src/lib/segments/condition-validator.test.ts`:
- Rejects depth > 2 (sub-group containing a sub-group)
- Rejects empty `rules` array
- Rejects unknown field name
- Rejects operator not valid for field type
- Rejects `between` with non-tuple value
- Rejects `within_last_days` with non-positive integer
- Rejects `in` / `includes_any` with empty array
- Accepts valid condition for each of the 5 field types

`apps/api/src/services/segment-evaluator.test.ts`:
- AND group: all conditions must match
- OR group: any condition must match
- Nested group: root AND with child OR sub-group
- `merchantId` always present in compiled WHERE clause (tenant scoping)
- `compileToPrismaWhere` never uses user-supplied `field` string as SQL column name
- SQL-vs-in-memory parity on 10 fixed synthetic profiles
- Each operator produces correct result for matching and non-matching values

---

## 9. File Map

```
packages/shared/src/types.ts                                  ← SegmentCondition, SegmentGroup, ConditionOperator
packages/queue/src/jobs.ts                                    ← SEGMENT_EVALUATE, SegmentEvaluateJobPayload

apps/api/src/lib/segments/
  field-registry.ts                                           ← FIELD_REGISTRY, FieldDef, VALUE_SHAPE_RULES
  condition-validator.ts                                      ← validateConditionTree(group, depth)
  condition-validator.test.ts

apps/api/src/services/
  segment-evaluator.ts                                        ← compileToPrismaWhere, evaluateProfile, evaluateProfileMemberships
  segment-evaluator.test.ts

apps/api/src/workers/
  segment-evaluate.worker.ts                                  ← BullMQ worker for SEGMENT_EVALUATE

apps/api/src/routes/segments/
  schema.ts                                                   ← Zod schemas for create/update request bodies
  service.ts                                                  ← DB operations (create, list, get, update, delete)
  controller.ts                                               ← Route handlers
  index.ts                                                    ← Fastify plugin, registers all 6 routes

apps/web/app/routes/
  segments._index.tsx
  segments.new.tsx
  segments.$id.tsx
```

---

## 10. Out of Scope for 4.1

- ClickHouse-backed conditions (e.g. "performed event X in last 30 days") — deferred to Phase 4.2 or later. All 4.1 conditions operate against the `customers` Postgres table only.
- Plan-based rate limiting on evaluate jobs
- Scheduled automatic re-evaluation (daily cron) — deferred; merchants use the "Re-evaluate" button for now
- Combined aggregate stats across group members (cross-store revenue totals)
