import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@engageiq/db'
import { getActiveVisitorCount } from '@engageiq/db'
import type { RealtimeKpis, AnalyticsAlert, KpiStatus } from '@engageiq/shared'
import { todayRange, yesterdayRange, sameDayLastWeekRange, DEFAULT_TZ } from './lib/dates.js'

// Revenue + order counts over a [from, to) window, from the authoritative Postgres orders
// table (cancelled orders excluded). COD vs prepaid split via Order.isCod.
async function ordersStats(merchantId: string, from: Date, to: Date) {
  const where = { merchantId, placedAt: { gte: from, lt: to }, cancelledAt: null }
  const [agg, codCount] = await Promise.all([
    prisma.order.aggregate({ where, _sum: { totalPrice: true }, _count: true }),
    prisma.order.count({ where: { ...where, isCod: true } }),
  ])
  const orders = agg._count
  return {
    revenue: Number(agg._sum.totalPrice ?? 0),
    orders,
    cod: codCount,
    prepaid: orders - codCount,
  }
}

// Green if at/above target, amber within 70% of it, red below. Zero-target falls back to
// "any value is good".
function statusVsTarget(value: number, target: number): KpiStatus {
  if (target <= 0) return value > 0 ? 'green' : 'amber'
  const ratio = value / target
  if (ratio >= 1) return 'green'
  if (ratio >= 0.7) return 'amber'
  return 'red'
}

async function buildRealtimeKpis(merchantId: string, timeZone: string): Promise<RealtimeKpis> {
  const now = new Date()
  const today = todayRange(now, timeZone)
  const yesterday = yesterdayRange(now, timeZone)
  const lastWeek = sameDayLastWeekRange(now, timeZone)

  const [activeVisitors, todayStats, yStats, lwStats, newToday, ordererRows, activeCampaigns, highRiskCount] =
    await Promise.all([
      getActiveVisitorCount(merchantId, 30),
      ordersStats(merchantId, today.from, today.to),
      ordersStats(merchantId, yesterday.from, yesterday.to),
      ordersStats(merchantId, lastWeek.from, lastWeek.to),
      prisma.customer.count({
        where: { merchantId, firstOrderAt: { gte: today.from, lt: today.to } },
      }),
      prisma.order.findMany({
        where: {
          merchantId,
          placedAt: { gte: today.from, lt: today.to },
          cancelledAt: null,
          customerId: { not: null },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
      prisma.campaign.findMany({
        where: { merchantId, status: { in: ['SENDING', 'SCHEDULED'] } },
        select: {
          id: true,
          name: true,
          status: true,
          recipientCount: true,
          deliveredCount: true,
          revenueAttributed: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      // churn columns are written by the ML lane (read-only here); null-safe.
      prisma.customer.count({ where: { merchantId, churnRiskLabel: { in: ['HIGH', 'CRITICAL'] } } }),
    ])

  const distinctOrderersToday = ordererRows.length
  const returningToday = Math.max(0, distinctOrderersToday - newToday)

  // ── Alerts ─────────────────────────────────────────────────────────────────
  const alerts: AnalyticsAlert[] = []

  const revStatus = statusVsTarget(todayStats.revenue, lwStats.revenue)
  if (revStatus === 'red' && lwStats.revenue > 0) {
    const dropPct = Math.round((1 - todayStats.revenue / lwStats.revenue) * 100)
    alerts.push({
      level: 'red',
      kind: 'revenue_drop',
      message: `Revenue today is down ${dropPct}% vs the same day last week.`,
    })
  }

  const totalCustomers = await prisma.customer.count({ where: { merchantId } })
  if (totalCustomers > 0 && highRiskCount > 0) {
    const riskPct = highRiskCount / totalCustomers
    if (riskPct >= 0.25) {
      alerts.push({
        level: 'amber',
        kind: 'churn_spike',
        message: `${Math.round(riskPct * 100)}% of customers are high/critical churn risk.`,
      })
    }
  }

  for (const c of activeCampaigns) {
    if (c.recipientCount > 0 && c.deliveredCount === 0 && c.status === 'SENDING') {
      alerts.push({
        level: 'amber',
        kind: 'campaign_anomaly',
        message: `Campaign "${c.name}" is sending but has 0 deliveries.`,
      })
    }
  }

  return {
    activeVisitors,
    revenue: {
      today: todayStats.revenue,
      yesterday: yStats.revenue,
      sameDayLastWeek: lwStats.revenue,
    },
    orders: {
      today: todayStats.orders,
      codToday: todayStats.cod,
      prepaidToday: todayStats.prepaid,
    },
    customers: { newToday, returningToday },
    activeCampaigns: activeCampaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      recipientCount: c.recipientCount,
      deliveredCount: c.deliveredCount,
      revenueAttributed: Number(c.revenueAttributed),
    })),
    alerts,
    generatedAt: now.toISOString(),
  }
}

async function realtimeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = request.user.merchantId
  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { timezone: true },
    })
    const kpis = await buildRealtimeKpis(merchantId, merchant?.timezone ?? DEFAULT_TZ)
    await reply.send({ success: true, data: kpis })
  } catch (err) {
    request.log.error({ err }, 'Failed to build real-time KPIs')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to build real-time dashboard' },
    })
  }
}

const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/realtime', realtimeHandler)
}

export default realtimeRoutes
