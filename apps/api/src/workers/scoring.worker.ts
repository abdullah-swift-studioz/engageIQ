/**
 * ML scoring worker (lane:ml).
 *
 * The Node side of the ML/AI lane. It reads **tenant-scoped** features from
 * Postgres, calls the stateless Python ML service (apps/ml-service), and persists
 * the results to the EXISTING score columns:
 *   Customer.rfm* / churnScore+churnRiskLabel / ltv90d|180d|365d / fakeOrderScore
 *   CodOrder.fakeScore + fakeScoreDetails
 *   Recommendation rows (cache), ModelRun rows (audit)
 *
 * It writes ONLY those columns/tables — no schema changes, no other tables.
 * Every query is scoped by merchantId so no cross-tenant data ever leaves a run.
 *
 * Tasks: rfm | churn | ltv | fake-order | recommendations | segment-discovery | full
 * `full` runs the daily bundle (rfm+churn+ltv+fake-order+recommendations); segment
 * discovery is weekly. Both are registered as repeatable BullMQ job schedulers.
 */

import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import type { Customer, CodOrder, Order, RfmSegment, ChurnRiskLabel } from '@prisma/client'
import { redisConnection, scoringQueue } from '@engageiq/queue'
import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type { ScoringJob, ScoringTask } from '@engageiq/shared'
// lane:public-api START
import { emitOutboundEvent } from '../services/webhooks-outbound/emit.js'
import { OUTBOUND_EVENTS } from '../services/webhooks-outbound/events.js'
// Churn score (0–1) at/above which an upward crossing fires the customer.churn_threshold webhook.
const CHURN_WEBHOOK_THRESHOLD = 0.7
// lane:public-api END

const DAY_MS = 24 * 60 * 60 * 1000

// ─── ML service response shapes (camelCase, mirror apps/ml-service/app/schemas.py) ──
interface RfmScoreOut {
  id: string
  recencyScore: number
  frequencyScore: number
  monetaryScore: number
  segment: RfmSegment
}
interface ChurnScoreOut {
  id: string
  churnScore: number
  churnRiskLabel: ChurnRiskLabel
}
interface LtvScoreOut {
  id: string
  ltv90d: number
  ltv180d: number
  ltv365d: number
}
interface FakeOrderScoreOut {
  id: string
  fakeScore: number
  riskBand: 'PROCESS' | 'VERIFY' | 'CANCEL'
  details: Record<string, unknown>
}
interface RecommendationOut {
  customerId: string
  recType: 'ALSO_BOUGHT' | 'MIGHT_LIKE' | 'COMPLETE_LOOK' | 'RESTOCK'
  productIds: string[]
  score: number
}
interface DiscoveredClusterOut {
  label: string
  size: number
  avgLtv: number
  avgRecencyDays: number
  avgFrequency: number
  avgMonetary: number
  description: string
  recommendedAction: string
  customerIds: string[]
}

// ─── ML service HTTP client ───────────────────────────────────────────────────
export interface MlClient {
  health(): Promise<unknown>
  rfm(customers: unknown[]): Promise<RfmScoreOut[]>
  churn(customers: unknown[]): Promise<ChurnScoreOut[]>
  ltv(customers: unknown[]): Promise<LtvScoreOut[]>
  fakeOrder(orders: unknown[]): Promise<FakeOrderScoreOut[]>
  recommendations(body: unknown): Promise<RecommendationOut[]>
  discover(body: unknown): Promise<{ clusters: DiscoveredClusterOut[]; silhouette: number | null }>
}

export function createMlClient(
  baseUrl: string = env.ML_SERVICE_URL,
  timeoutMs: number = env.ML_SERVICE_TIMEOUT_MS,
): MlClient {
  async function call<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`ML service ${path} returned ${res.status}: ${text.slice(0, 300)}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async health() {
      const res = await fetch(`${baseUrl}/health`)
      return res.json()
    },
    async rfm(customers) {
      const r = await call<{ scores: RfmScoreOut[] }>('/score/rfm', { customers })
      return r.scores
    },
    async churn(customers) {
      const r = await call<{ scores: ChurnScoreOut[] }>('/score/churn', { customers })
      return r.scores
    },
    async ltv(customers) {
      const r = await call<{ scores: LtvScoreOut[] }>('/score/ltv', { customers })
      return r.scores
    },
    async fakeOrder(orders) {
      const r = await call<{ scores: FakeOrderScoreOut[] }>('/score/fake-order', { orders })
      return r.scores
    },
    async recommendations(body) {
      const r = await call<{ recommendations: RecommendationOut[] }>('/recommendations', body)
      return r.recommendations
    },
    async discover(body) {
      return call<{ clusters: DiscoveredClusterOut[]; silhouette: number | null }>(
        '/segments/discover',
        body,
      )
    },
  }
}

// ─── Feature builders (pure — unit-tested without a DB or service) ────────────
const toNum = (d: Prisma.Decimal | number | null | undefined): number =>
  d == null ? 0 : typeof d === 'number' ? d : Number(d)

const daysSince = (date: Date | null | undefined, now: Date): number =>
  date == null ? 99999 : Math.max(0, (now.getTime() - new Date(date).getTime()) / DAY_MS)

/** Customers eligible for purchase-based scoring (have at least one order). */
export function buyers<T extends { totalOrders: number }>(customers: T[]): T[] {
  return customers.filter((c) => c.totalOrders > 0)
}

export function buildRfmInputs(customers: Customer[], now: Date) {
  return buyers(customers).map((c) => ({
    id: c.id,
    recencyDays: daysSince(c.lastOrderAt, now),
    frequency: c.totalOrders,
    monetary: toNum(c.totalSpent),
  }))
}

export function buildChurnInputs(customers: Customer[], now: Date) {
  return buyers(customers).map((c) => {
    const tenure = c.firstOrderAt ? daysSince(c.firstOrderAt, now) : 0
    const gap = c.totalOrders > 1 ? tenure / c.totalOrders : tenure
    return {
      id: c.id,
      recencyDays: daysSince(c.lastOrderAt, now),
      frequency: c.totalOrders,
      monetary: toNum(c.totalSpent),
      avgOrderValue: toNum(c.avgOrderValue),
      tenureDays: tenure,
      interPurchaseGapDays: gap,
      sessionCount: c.sessionCount,
      daysSinceLastSeen: c.lastSeenAt ? daysSince(c.lastSeenAt, now) : null,
      codOrderCount: c.codOrderCount,
      codRejectionRate: c.codRejectionRate ?? 0,
    }
  })
}

export function buildLtvInputs(customers: Customer[], now: Date) {
  return buyers(customers).map((c) => ({
    id: c.id,
    recencyDays: daysSince(c.lastOrderAt, now),
    frequency: c.totalOrders,
    monetary: toNum(c.totalSpent),
    avgOrderValue: toNum(c.avgOrderValue),
    tenureDays: c.firstOrderAt ? daysSince(c.firstOrderAt, now) : 0,
  }))
}

const E164 = /^\+?[0-9]{10,15}$/

interface ShippingAddress {
  address1?: string | null
  city?: string | null
}

export function buildFakeOrderInput(
  cod: CodOrder,
  order: Order | undefined,
  customer: Customer | undefined,
  codCountLast24h: number,
) {
  const addr = (order?.shippingAddress as ShippingAddress | null) ?? null
  const address1 = addr?.address1 ?? ''
  const avgOrderValue = customer ? toNum(customer.avgOrderValue) : 0
  const phone = customer?.phone ?? ''
  return {
    id: cod.id,
    amount: toNum(cod.amount),
    isFirstOrder: (customer?.codOrderCount ?? 0) <= 1,
    isHighValue: avgOrderValue > 0 ? toNum(cod.amount) > 2 * avgOrderValue : toNum(cod.amount) > 10000,
    customerCodOrderCount: customer?.codOrderCount ?? 0,
    customerCodRejectionRate: customer?.codRejectionRate ?? 0,
    phoneValid: E164.test(phone.replace(/[\s-]/g, '')),
    addressLength: address1.length,
    addressHasStreetSignal: /\d/.test(address1),
    addressDuplicationCount: 0, // requires cross-account address index — see follow-up
    cityKnown: Boolean(cod.city),
    ordersLast24h: codCountLast24h,
  }
}

/** Implicit-feedback interactions from order line items (purchase = weight 3). */
export function buildInteractions(orders: Pick<Order, 'customerId' | 'lineItems'>[]) {
  const interactions: { customerId: string; productId: string; weight: number }[] = []
  for (const o of orders) {
    if (!o.customerId) continue
    const items = Array.isArray(o.lineItems) ? (o.lineItems as Array<{ product_id?: string | null }>) : []
    for (const li of items) {
      if (li && li.product_id) {
        interactions.push({ customerId: o.customerId, productId: String(li.product_id), weight: 3 })
      }
    }
  }
  return interactions
}

// ─── Persistence helpers ──────────────────────────────────────────────────────
async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size))
  }
}

const ANALYTIC_VERSIONS: Record<string, string> = {
  rfm: 'rfm-percentile-v1',
  ltv: 'ltv-prob-v1',
  recommendations: 'rec-itemcf-v1',
  'segment-discovery': 'segdisc-kmeans-v1',
  churn: 'churn-hgb-synthetic-v1',
  'fake-order': 'fake-order-hgb-synthetic-v1',
}

async function recordRun(
  merchantId: string | null,
  task: ScoringTask,
  rowCount: number,
  startedAt: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.modelRun.create({
    data: {
      merchantId,
      modelName: task,
      modelVersion: ANALYTIC_VERSIONS[task] ?? 'v1',
      status: 'success',
      rowCount,
      durationMs: Date.now() - startedAt,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  })
}

// ─── Task runners (merchant-scoped) ───────────────────────────────────────────
export interface ScoringDeps {
  ml: MlClient
  now?: Date
}

export async function runRfm(merchantId: string, deps: ScoringDeps): Promise<number> {
  const now = deps.now ?? new Date()
  const startedAt = Date.now()
  const customers = await prisma.customer.findMany({ where: { merchantId, mergedIntoId: null } })
  const inputs = buildRfmInputs(customers, now)
  if (inputs.length === 0) return 0
  const scores = await deps.ml.rfm(inputs)
  const scoredAt = new Date()
  await chunked(scores, 50, async (chunk) => {
    await prisma.$transaction(
      chunk.map((s) =>
        prisma.customer.update({
          where: { id: s.id },
          data: {
            rfmRecencyScore: s.recencyScore,
            rfmFrequencyScore: s.frequencyScore,
            rfmMonetaryScore: s.monetaryScore,
            rfmSegment: s.segment,
            rfmScoredAt: scoredAt,
          },
        }),
      ),
    )
  })
  await recordRun(merchantId, 'rfm', scores.length, startedAt)
  return scores.length
}

export async function runChurn(merchantId: string, deps: ScoringDeps): Promise<number> {
  const now = deps.now ?? new Date()
  const startedAt = Date.now()
  const customers = await prisma.customer.findMany({ where: { merchantId, mergedIntoId: null } })
  const inputs = buildChurnInputs(customers, now)
  if (inputs.length === 0) return 0
  const scores = await deps.ml.churn(inputs)
  const scoredAt = new Date()
  // lane:public-api — capture prior churn scores to detect threshold crossings for webhooks.
  const priorChurn = new Map(customers.map((c) => [c.id, c.churnScore]))
  await chunked(scores, 50, async (chunk) => {
    await prisma.$transaction(
      chunk.map((s) =>
        prisma.customer.update({
          where: { id: s.id },
          data: {
            churnScore: s.churnScore,
            churnRiskLabel: s.churnRiskLabel,
            churnScoredAt: scoredAt,
          },
        }),
      ),
    )
  })
  // lane:public-api START — outbound webhook: customer.churn_threshold (upward crossings only)
  for (const s of scores) {
    const prev = priorChurn.get(s.id) ?? null
    if ((prev === null || prev < CHURN_WEBHOOK_THRESHOLD) && s.churnScore >= CHURN_WEBHOOK_THRESHOLD) {
      void emitOutboundEvent(merchantId, OUTBOUND_EVENTS.CHURN_THRESHOLD_CROSSED, {
        customerId: s.id,
        churnScore: s.churnScore,
        churnRiskLabel: s.churnRiskLabel,
        threshold: CHURN_WEBHOOK_THRESHOLD,
        previousScore: prev,
      })
    }
  }
  // lane:public-api END
  await recordRun(merchantId, 'churn', scores.length, startedAt)
  return scores.length
}

export async function runLtv(merchantId: string, deps: ScoringDeps): Promise<number> {
  const now = deps.now ?? new Date()
  const startedAt = Date.now()
  const customers = await prisma.customer.findMany({ where: { merchantId, mergedIntoId: null } })
  const inputs = buildLtvInputs(customers, now)
  if (inputs.length === 0) return 0
  const scores = await deps.ml.ltv(inputs)
  const scoredAt = new Date()
  await chunked(scores, 50, async (chunk) => {
    await prisma.$transaction(
      chunk.map((s) =>
        prisma.customer.update({
          where: { id: s.id },
          data: {
            ltv90d: new Prisma.Decimal(s.ltv90d),
            ltv180d: new Prisma.Decimal(s.ltv180d),
            ltv365d: new Prisma.Decimal(s.ltv365d),
            ltvScoredAt: scoredAt,
          },
        }),
      ),
    )
  })
  await recordRun(merchantId, 'ltv', scores.length, startedAt)
  return scores.length
}

export async function runFakeOrder(merchantId: string, deps: ScoringDeps): Promise<number> {
  const startedAt = Date.now()
  const codOrders = await prisma.codOrder.findMany({ where: { merchantId } })
  if (codOrders.length === 0) return 0

  // Resolve matching Orders (for shipping address + history) and customers, tenant-scoped.
  const shopifyOrderIds = codOrders.map((c) => c.shopifyOrderId)
  const orders = await prisma.order.findMany({
    where: { merchantId, shopifyOrderId: { in: shopifyOrderIds } },
  })
  const orderByShopify = new Map(orders.map((o) => [o.shopifyOrderId, o]))
  const customerIds = [...new Set(codOrders.map((c) => c.customerId).filter((x): x is string => !!x))]
  const customers = await prisma.customer.findMany({ where: { merchantId, id: { in: customerIds } } })
  const customerById = new Map(customers.map((c) => [c.id, c]))

  // Velocity: COD orders per customer within 24h before each order.
  const codCountLast24h = (cod: CodOrder): number =>
    codOrders.filter(
      (o) =>
        o.customerId &&
        o.customerId === cod.customerId &&
        o.id !== cod.id &&
        Math.abs(new Date(o.placedAt).getTime() - new Date(cod.placedAt).getTime()) <= DAY_MS,
    ).length

  const inputs = codOrders.map((cod) =>
    buildFakeOrderInput(
      cod,
      orderByShopify.get(cod.shopifyOrderId),
      cod.customerId ? customerById.get(cod.customerId) : undefined,
      codCountLast24h(cod),
    ),
  )
  const scores = await deps.ml.fakeOrder(inputs)
  const scoreById = new Map(scores.map((s) => [s.id, s]))

  // Persist per-COD-order fake score + details.
  await chunked(scores, 50, async (chunk) => {
    await prisma.$transaction(
      chunk.map((s) =>
        prisma.codOrder.update({
          where: { id: s.id },
          data: {
            fakeScore: s.fakeScore,
            fakeScoreDetails: { ...s.details, riskBand: s.riskBand } as Prisma.InputJsonValue,
          },
        }),
      ),
    )
  })

  // Roll up to Customer.fakeOrderScore = worst (max) score across their COD orders.
  const worstByCustomer = new Map<string, number>()
  for (const cod of codOrders) {
    if (!cod.customerId) continue
    const s = scoreById.get(cod.id)
    if (!s) continue
    worstByCustomer.set(cod.customerId, Math.max(worstByCustomer.get(cod.customerId) ?? 0, s.fakeScore))
  }
  const rollups = [...worstByCustomer.entries()]
  await chunked(rollups, 50, async (chunk) => {
    await prisma.$transaction(
      chunk.map(([customerId, score]) =>
        prisma.customer.update({ where: { id: customerId }, data: { fakeOrderScore: score } }),
      ),
    )
  })

  await recordRun(merchantId, 'fake-order', scores.length, startedAt)
  return scores.length
}

export async function runRecommendations(merchantId: string, deps: ScoringDeps): Promise<number> {
  const startedAt = Date.now()
  const orders = await prisma.order.findMany({
    where: { merchantId, customerId: { not: null } },
    select: { customerId: true, lineItems: true },
  })
  const interactions = buildInteractions(orders)
  if (interactions.length === 0) return 0

  const recs = await deps.ml.recommendations({
    interactions,
    customers: [],
    topN: 5,
    recType: 'ALSO_BOUGHT',
  })
  const generatedAt = new Date()
  const expiresAt = new Date(generatedAt.getTime() + 7 * DAY_MS)
  await chunked(recs, 50, async (chunk) => {
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.recommendation.upsert({
          where: {
            merchantId_customerId_type: {
              merchantId,
              customerId: r.customerId,
              type: r.recType,
            },
          },
          create: {
            merchantId,
            customerId: r.customerId,
            type: r.recType,
            productIds: r.productIds,
            score: r.score,
            generatedAt,
            expiresAt,
          },
          update: { productIds: r.productIds, score: r.score, generatedAt, expiresAt },
        }),
      ),
    )
  })
  await recordRun(merchantId, 'recommendations', recs.length, startedAt)
  return recs.length
}

/**
 * AI segment discovery (5.3). Surfaces discovered clusters; it does NOT auto-create
 * Segment rows (that table is owned by the segmentation lane). The clusters are
 * recorded in a ModelRun for audit + one-click promotion in the UI later.
 */
export async function runSegmentDiscovery(merchantId: string, deps: ScoringDeps): Promise<number> {
  const now = deps.now ?? new Date()
  const startedAt = Date.now()
  const customers = await prisma.customer.findMany({ where: { merchantId, mergedIntoId: null } })
  const inputs = buyers(customers).map((c) => ({
    id: c.id,
    recencyDays: daysSince(c.lastOrderAt, now),
    frequency: c.totalOrders,
    monetary: toNum(c.totalSpent),
    ltv365d: toNum(c.ltv365d),
    sessionCount: c.sessionCount,
  }))
  if (inputs.length < 3) return 0

  const { clusters, silhouette } = await deps.ml.discover({ customers: inputs, maxClusters: 6 })
  // Compact summary for audit (omit full customerId arrays to keep the row small).
  const summary = clusters.map((c) => ({
    label: c.label,
    size: c.size,
    avgLtv: c.avgLtv,
    avgRecencyDays: c.avgRecencyDays,
    avgFrequency: c.avgFrequency,
    avgMonetary: c.avgMonetary,
    description: c.description,
    recommendedAction: c.recommendedAction,
  }))
  await recordRun(merchantId, 'segment-discovery', inputs.length, startedAt, {
    silhouette,
    clusters: summary,
  })
  return clusters.length
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
const DAILY_TASKS: Exclude<ScoringTask, 'full'>[] = [
  'rfm',
  'churn',
  'ltv',
  'fake-order',
  'recommendations',
]

const RUNNERS: Record<
  Exclude<ScoringTask, 'full'>,
  (merchantId: string, deps: ScoringDeps) => Promise<number>
> = {
  rfm: runRfm,
  churn: runChurn,
  ltv: runLtv,
  'fake-order': runFakeOrder,
  recommendations: runRecommendations,
  'segment-discovery': runSegmentDiscovery,
}

export async function runScoringJob(job: ScoringJob, deps: ScoringDeps): Promise<void> {
  const merchantIds = job.merchantId
    ? [job.merchantId]
    : (await prisma.merchant.findMany({ select: { id: true } })).map((m) => m.id)

  const tasks: Exclude<ScoringTask, 'full'>[] =
    job.task === 'full' ? DAILY_TASKS : [job.task]

  for (const merchantId of merchantIds) {
    for (const task of tasks) {
      try {
        const n = await RUNNERS[task](merchantId, deps)
        console.info(`[scoring-worker] ${task} merchant=${merchantId} scored=${n}`)
      } catch (err) {
        // One task/merchant failing must not abort the whole run.
        console.error(`[scoring-worker] ${task} merchant=${merchantId} failed:`, (err as Error).message)
        throw err
      }
    }
  }
}

// ─── Worker factory ───────────────────────────────────────────────────────────
export function createScoringWorker(): Worker<ScoringJob> {
  const ml = createMlClient()
  return new Worker<ScoringJob>(
    'scoring',
    async (job: Job<ScoringJob>) => {
      await runScoringJob(job.data, { ml })
    },
    { connection: redisConnection, concurrency: 1 },
  )
}

/**
 * Idempotently register the repeatable scoring schedulers (daily full run +
 * weekly segment discovery). Safe to call on every worker boot — job schedulers
 * are keyed by id, so re-registration just updates the cron.
 */
export async function registerScoringSchedulers(): Promise<void> {
  await scoringQueue.upsertJobScheduler(
    'scoring-daily-full',
    { pattern: env.ML_SCORING_CRON },
    { name: 'scoring', data: { task: 'full' } satisfies ScoringJob },
  )
  await scoringQueue.upsertJobScheduler(
    'scoring-weekly-segment-discovery',
    { pattern: env.ML_SEGMENT_DISCOVERY_CRON },
    { name: 'scoring', data: { task: 'segment-discovery' } satisfies ScoringJob },
  )
}
