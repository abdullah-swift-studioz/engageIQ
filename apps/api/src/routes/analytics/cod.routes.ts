import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '@engageiq/db'
import type { CodAnalytics, CodBreakdownRow } from '@engageiq/shared'
import { resolvePeriod } from './lib/dates.js'

// 4.5 COD Analytics. Cash-on-delivery acceptance / rejection / fake-order economics over
// Postgres CodOrder (+ Order for prepaid net revenue and COD→prepaid conversion). Every
// query is tenant-scoped by request.user.merchantId.

const querySchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d', 'custom']).default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
})

const FAKE_SCORE_THRESHOLD = 70 // fakeScore strictly above this counts as a likely fake order
const DAY_MS = 86_400_000

type CodStatus = 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'RETURNED' | 'CANCELLED'

function isAccepted(status: CodStatus): boolean {
  return status === 'DELIVERED'
}

function isRejected(status: CodStatus): boolean {
  return status === 'RETURNED' || status === 'CANCELLED'
}

function valueBand(amount: number): string {
  if (amount < 2000) return '< 2k'
  if (amount < 5000) return '2k–5k'
  if (amount < 10000) return '5k–10k'
  return '≥ 10k'
}

const VALUE_BAND_ORDER = ['< 2k', '2k–5k', '5k–10k', '≥ 10k']

interface GroupTally {
  total: number
  accepted: number
  rejected: number
}

function emptyTally(): GroupTally {
  return { total: 0, accepted: 0, rejected: 0 }
}

function tallyToRow(key: string, t: GroupTally): CodBreakdownRow {
  const resolved = t.accepted + t.rejected
  return {
    key,
    total: t.total,
    accepted: t.accepted,
    rejected: t.rejected,
    acceptanceRate: resolved > 0 ? t.accepted / resolved : 0,
  }
}

async function buildCodAnalytics(merchantId: string, from: Date, to: Date): Promise<CodAnalytics> {
  const [codOrders, prepaidAgg] = await Promise.all([
    prisma.codOrder.findMany({
      where: { merchantId, placedAt: { gte: from, lt: to } },
      select: {
        customerId: true,
        amount: true,
        city: true,
        courier: true,
        status: true,
        fakeScore: true,
        placedAt: true,
        deliveredAt: true,
      },
    }),
    prisma.order.aggregate({
      where: { merchantId, cancelledAt: null, isCod: false, placedAt: { gte: from, lt: to } },
      _sum: { totalPrice: true },
    }),
  ])

  const totalCodOrders = codOrders.length
  let accepted = 0
  let rejected = 0
  let fakeCount = 0
  let netRevenueCod = 0
  let deliverDaysSum = 0
  let deliverCount = 0

  const byCity = new Map<string, GroupTally>()
  const byCourier = new Map<string, GroupTally>()
  const byBand = new Map<string, GroupTally>()
  const codCustomerIds = new Set<string>()

  for (const o of codOrders) {
    const status = o.status as CodStatus
    const amount = Number(o.amount)
    const acc = isAccepted(status)
    const rej = isRejected(status)
    if (acc) {
      accepted++
      netRevenueCod += amount
      if (o.deliveredAt) {
        deliverDaysSum += (o.deliveredAt.getTime() - o.placedAt.getTime()) / DAY_MS
        deliverCount++
      }
    }
    if (rej) rejected++
    if (o.fakeScore != null && o.fakeScore > FAKE_SCORE_THRESHOLD) fakeCount++
    if (o.customerId != null) codCustomerIds.add(o.customerId)

    const cityKey = o.city ?? 'Unknown'
    const courierKey = o.courier ?? 'Unknown'
    const bandKey = valueBand(amount)

    for (const [map, key] of [
      [byCity, cityKey],
      [byCourier, courierKey],
      [byBand, bandKey],
    ] as const) {
      const t = map.get(key) ?? emptyTally()
      t.total++
      if (acc) t.accepted++
      if (rej) t.rejected++
      map.set(key, t)
    }
  }

  const resolved = accepted + rejected

  // COD → prepaid conversion: of customers with a COD order in range, the fraction who
  // also placed a non-COD order at any time.
  let codToPrepaidConversion: number | null = null
  if (codCustomerIds.size > 0) {
    const converted = await prisma.order.findMany({
      where: { merchantId, isCod: false, customerId: { in: Array.from(codCustomerIds) } },
      select: { customerId: true },
      distinct: ['customerId'],
    })
    const convertedCount = converted.filter((r) => r.customerId != null).length
    codToPrepaidConversion = convertedCount / codCustomerIds.size
  }

  const byCityRows = Array.from(byCity.entries())
    .map(([k, t]) => tallyToRow(k, t))
    .sort((a, b) => b.total - a.total)
  const byCourierRows = Array.from(byCourier.entries())
    .map(([k, t]) => tallyToRow(k, t))
    .sort((a, b) => b.total - a.total)
  const byValueBandRows = VALUE_BAND_ORDER.filter((k) => byBand.has(k)).map((k) =>
    tallyToRow(k, byBand.get(k)!),
  )

  return {
    totalCodOrders,
    acceptanceRate: resolved > 0 ? accepted / resolved : 0,
    rejectionRate: resolved > 0 ? rejected / resolved : 0,
    fakeOrderRate: totalCodOrders > 0 ? fakeCount / totalCodOrders : 0,
    codToPrepaidConversion,
    avgDaysToCollect: deliverCount > 0 ? deliverDaysSum / deliverCount : null,
    netRevenueCod,
    netRevenuePrepaid: Number(prepaidAgg._sum.totalPrice ?? 0),
    byCity: byCityRows,
    byCourier: byCourierRows,
    byValueBand: byValueBandRows,
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

async function codHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = request.user.merchantId

  const parsed = querySchema.safeParse(request.query)
  if (!parsed.success) {
    await reply.status(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() },
    })
    return
  }

  let from: Date
  let to: Date
  try {
    const range = resolvePeriod({
      period: parsed.data.period,
      fromIso: parsed.data.from,
      toIso: parsed.data.to,
    })
    from = range.from
    to = range.to
  } catch (err) {
    await reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err instanceof Error ? err.message : 'Invalid date range',
      },
    })
    return
  }

  try {
    const result = await buildCodAnalytics(merchantId, from, to)
    await reply.send({ success: true, data: result })
  } catch (err) {
    request.log.error({ err }, 'Failed to build COD analytics')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to build COD analytics' },
    })
  }
}

const codRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/cod', codHandler)
}

export default codRoutes
