import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '@engageiq/db'
import type { CohortGroupBy, CohortRow, CohortResult } from '@engageiq/shared'

// 4.4 Cohort Retention Analysis.
//
// Authoritative source for retention is the Postgres `orders` table (cancelled orders excluded).
// retention[i] = fraction (0–1) of a cohort that placed an order in the calendar period that is
// i months after their cohort start. retention[0] is 1.0 by construction (everyone ordered in
// month 0 — that is what defines the cohort). Cells whose period has not yet elapsed (relative to
// "now") are null rather than 0, so the heatmap can distinguish "no retention" from "no data yet".

const MAX_PERIODS = 12
const MAX_COHORTS = 24 // bound output to the most recent 24 monthly cohorts

const bodySchema = z.object({
  groupBy: z
    .enum(['first_purchase_month', 'product_category', 'acquisition_channel', 'rfm_segment'])
    .default('first_purchase_month'),
  periods: z.number().int().min(1).max(MAX_PERIODS).default(MAX_PERIODS),
})

// ── month-arithmetic helpers (all UTC) ───────────────────────────────────────

/** Calendar month index: years*12 + month (0-based). Monotonic, so differences = month deltas. */
function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

/** 'YYYY-MM' label for a month index. */
function indexToKey(index: number): string {
  const year = Math.floor(index / 12)
  const month = index % 12
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// ── primary: cohort by first-purchase month ──────────────────────────────────

async function buildFirstPurchaseMonthCohorts(merchantId: string, periods: number): Promise<CohortRow[]> {
  const orders = await prisma.order.findMany({
    where: { merchantId, cancelledAt: null, customerId: { not: null } },
    select: { customerId: true, placedAt: true },
  })

  // customerId → { firstIndex, set of active month indices }
  const perCustomer = new Map<string, { firstIndex: number; activeMonths: Set<number> }>()
  for (const o of orders) {
    if (o.customerId == null) continue
    const idx = monthIndex(o.placedAt)
    const existing = perCustomer.get(o.customerId)
    if (existing) {
      existing.activeMonths.add(idx)
      if (idx < existing.firstIndex) existing.firstIndex = idx
    } else {
      perCustomer.set(o.customerId, { firstIndex: idx, activeMonths: new Set([idx]) })
    }
  }

  // cohort month index → { size, active counts per offset }
  const cohorts = new Map<number, { size: number; active: number[] }>()
  for (const { firstIndex, activeMonths } of perCustomer.values()) {
    let cohort = cohorts.get(firstIndex)
    if (!cohort) {
      cohort = { size: 0, active: new Array<number>(periods).fill(0) }
      cohorts.set(firstIndex, cohort)
    }
    cohort.size += 1
    for (let i = 0; i < periods; i++) {
      if (activeMonths.has(firstIndex + i)) cohort.active[i] = (cohort.active[i] ?? 0) + 1
    }
  }

  const nowIndex = monthIndex(new Date())

  const rows: CohortRow[] = [...cohorts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cohortIndex, { size, active }]) => {
      const retention: Array<number | null> = []
      for (let i = 0; i < periods; i++) {
        if (cohortIndex + i > nowIndex) {
          retention.push(null) // period has not elapsed yet
        } else if (i === 0) {
          retention.push(1.0)
        } else {
          retention.push(size > 0 ? (active[i] ?? 0) / size : 0)
        }
      }
      return { cohort: indexToKey(cohortIndex), cohortSize: size, retention }
    })

  // Keep only the most recent MAX_COHORTS cohorts (still ascending).
  return rows.slice(-MAX_COHORTS)
}

// ── secondary: cohort by RFM segment ─────────────────────────────────────────

async function buildRfmSegmentCohorts(merchantId: string, periods: number): Promise<CohortRow[]> {
  const customers = await prisma.customer.findMany({
    where: { merchantId, rfmSegment: { not: null }, firstOrderAt: { not: null } },
    select: { id: true, rfmSegment: true, firstOrderAt: true },
  })
  if (customers.length === 0) return []

  const firstIndexById = new Map<string, number>()
  const segmentById = new Map<string, string>()
  const customerIds: string[] = []
  for (const c of customers) {
    if (c.rfmSegment == null || c.firstOrderAt == null) continue
    firstIndexById.set(c.id, monthIndex(c.firstOrderAt))
    segmentById.set(c.id, c.rfmSegment)
    customerIds.push(c.id)
  }
  if (customerIds.length === 0) return []

  // Activity months for those customers (non-cancelled orders only).
  const orders = await prisma.order.findMany({
    where: { merchantId, cancelledAt: null, customerId: { in: customerIds } },
    select: { customerId: true, placedAt: true },
  })
  const activeById = new Map<string, Set<number>>()
  for (const o of orders) {
    if (o.customerId == null) continue
    let set = activeById.get(o.customerId)
    if (!set) {
      set = new Set<number>()
      activeById.set(o.customerId, set)
    }
    set.add(monthIndex(o.placedAt))
  }

  // segment → { size, active counts per offset, earliest cohort index }
  const segments = new Map<string, { size: number; active: number[]; minFirstIndex: number }>()
  for (const id of customerIds) {
    const segment = segmentById.get(id)!
    const firstIndex = firstIndexById.get(id)!
    const activeMonths = activeById.get(id) ?? new Set<number>([firstIndex])
    let seg = segments.get(segment)
    if (!seg) {
      seg = { size: 0, active: new Array<number>(periods).fill(0), minFirstIndex: firstIndex }
      segments.set(segment, seg)
    }
    seg.size += 1
    if (firstIndex < seg.minFirstIndex) seg.minFirstIndex = firstIndex
    for (let i = 0; i < periods; i++) {
      if (activeMonths.has(firstIndex + i)) seg.active[i] = (seg.active[i] ?? 0) + 1
    }
  }

  const nowIndex = monthIndex(new Date())

  return [...segments.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([segment, { size, active, minFirstIndex }]) => {
      const retention: Array<number | null> = []
      for (let i = 0; i < periods; i++) {
        // Null only when not a single customer in the segment has reached period i yet.
        if (minFirstIndex + i > nowIndex) {
          retention.push(null)
        } else if (i === 0) {
          retention.push(1.0)
        } else {
          retention.push(size > 0 ? (active[i] ?? 0) / size : 0)
        }
      }
      return { cohort: segment, cohortSize: size, retention }
    })
}

// ── handler ──────────────────────────────────────────────────────────────────

async function cohortHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = bodySchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await reply.status(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid cohort request', details: parsed.error.flatten() },
    })
    return
  }

  const { groupBy, periods } = parsed.data
  const merchantId = request.user.merchantId

  try {
    let rows: CohortRow[]
    switch (groupBy) {
      case 'first_purchase_month':
        rows = await buildFirstPurchaseMonthCohorts(merchantId, periods)
        break
      case 'rfm_segment':
        rows = await buildRfmSegmentCohorts(merchantId, periods)
        break
      // product_category / acquisition_channel: no reliable source field exists on Order/Customer,
      // so we return no rows rather than invent data.
      case 'product_category':
      case 'acquisition_channel':
      default:
        rows = []
        break
    }

    const result: CohortResult = {
      groupBy: groupBy as CohortGroupBy,
      periods,
      rows,
      generatedAt: new Date().toISOString(),
    }
    await reply.send({ success: true, data: result })
  } catch (err) {
    request.log.error({ err }, 'Failed to build cohort retention')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to build cohort retention' },
    })
  }
}

const cohortRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/cohort', cohortHandler)
}

export default cohortRoutes
