import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '@engageiq/db'
import type {
  AttributionModel,
  AttributionResult,
  ChannelAttribution,
  CampaignAttributionRow,
} from '@engageiq/shared'
import { resolvePeriod } from './lib/dates.js'

// 4.5 Revenue Attribution. Multi-touch attribution computed on the fly (never persisted,
// per project decision) over Postgres orders + outbound campaign messages. Every query is
// tenant-scoped by request.user.merchantId.

// ── Validation ────────────────────────────────────────────────────────────────

const querySchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d', 'custom']).default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
  model: z.enum(['last_touch', 'first_touch', 'linear', 'time_decay']).default('last_touch'),
})

// Per-channel attribution lookback window (a touch only counts if it precedes the order
// within this window). WhatsApp 3d, Email 7d, SMS/Push 24h.
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

function windowMsForChannel(channel: string): number {
  switch (channel) {
    case 'WHATSAPP':
      return 3 * DAY_MS
    case 'EMAIL':
      return 7 * DAY_MS
    case 'SMS':
      return 24 * HOUR_MS
    case 'PUSH':
      return 24 * HOUR_MS
    default:
      return 0
  }
}

// Time-decay half-life: 1 day.
const HALF_LIFE_MS = DAY_MS

interface Touch {
  channel: string
  campaignId: string
  sentAt: Date
}

/**
 * Distribute one unit of weight across an order's qualifying touches per the model.
 * Returns weights aligned with the input touches array (summing to 1).
 */
function weightsForModel(model: AttributionModel, touches: Touch[], placedAt: Date): number[] {
  const n = touches.length
  if (n === 0) return []
  if (n === 1) return [1]

  switch (model) {
    case 'last_touch': {
      let idx = 0
      for (let i = 1; i < n; i++) {
        if (touches[i]!.sentAt.getTime() > touches[idx]!.sentAt.getTime()) idx = i
      }
      return touches.map((_, i) => (i === idx ? 1 : 0))
    }
    case 'first_touch': {
      let idx = 0
      for (let i = 1; i < n; i++) {
        if (touches[i]!.sentAt.getTime() < touches[idx]!.sentAt.getTime()) idx = i
      }
      return touches.map((_, i) => (i === idx ? 1 : 0))
    }
    case 'linear': {
      return touches.map(() => 1 / n)
    }
    case 'time_decay': {
      const raw = touches.map((t) => {
        const delta = placedAt.getTime() - t.sentAt.getTime()
        return Math.exp(-delta / HALF_LIFE_MS)
      })
      const sum = raw.reduce((a, b) => a + b, 0)
      if (sum <= 0) return touches.map(() => 1 / n)
      return raw.map((w) => w / sum)
    }
    default:
      return touches.map(() => 1 / n)
  }
}

async function buildAttribution(
  merchantId: string,
  model: AttributionModel,
  from: Date,
  to: Date,
): Promise<AttributionResult> {
  // Orders in range that can be attributed (must have a customer to link touches).
  const orders = await prisma.order.findMany({
    where: {
      merchantId,
      cancelledAt: null,
      customerId: { not: null },
      placedAt: { gte: from, lt: to },
    },
    select: { id: true, customerId: true, placedAt: true, totalPrice: true },
  })

  const channelAcc = new Map<string, { revenue: number; orderIds: Set<string> }>()
  const campaignAcc = new Map<string, number>()
  let totalAttributed = 0

  if (orders.length > 0) {
    const customerIds = Array.from(
      new Set(orders.map((o) => o.customerId).filter((id): id is string => id != null)),
    )

    // Outbound campaign messages that could touch any of these orders. Bound the scan
    // by the widest window (7d, email) before the range start.
    const messages = await prisma.message.findMany({
      where: {
        merchantId,
        direction: 'OUTBOUND',
        campaignId: { not: null },
        sentAt: { gte: new Date(from.getTime() - 7 * DAY_MS), lt: to },
        customerId: { in: customerIds },
      },
      select: { customerId: true, channel: true, campaignId: true, sentAt: true },
    })

    // Group touches by customer for per-order lookup.
    const byCustomer = new Map<string, Touch[]>()
    for (const m of messages) {
      if (m.customerId == null || m.campaignId == null || m.sentAt == null) continue
      const list = byCustomer.get(m.customerId) ?? []
      list.push({ channel: m.channel, campaignId: m.campaignId, sentAt: m.sentAt })
      byCustomer.set(m.customerId, list)
    }

    for (const order of orders) {
      if (order.customerId == null) continue
      const candidates = byCustomer.get(order.customerId)
      if (!candidates || candidates.length === 0) continue

      const placedMs = order.placedAt.getTime()
      const qualifying = candidates.filter((t) => {
        const sentMs = t.sentAt.getTime()
        if (sentMs > placedMs) return false
        return placedMs - sentMs < windowMsForChannel(t.channel)
      })
      if (qualifying.length === 0) continue

      const revenue = Number(order.totalPrice)
      const weights = weightsForModel(model, qualifying, order.placedAt)

      const channelsTouched = new Set<string>()
      for (let i = 0; i < qualifying.length; i++) {
        const touch = qualifying[i]!
        const attributed = revenue * (weights[i] ?? 0)
        if (attributed === 0) continue
        totalAttributed += attributed

        // By channel.
        const cEntry = channelAcc.get(touch.channel) ?? { revenue: 0, orderIds: new Set<string>() }
        cEntry.revenue += attributed
        cEntry.orderIds.add(order.id)
        channelAcc.set(touch.channel, cEntry)
        channelsTouched.add(touch.channel)

        // By campaign.
        campaignAcc.set(touch.campaignId, (campaignAcc.get(touch.campaignId) ?? 0) + attributed)
      }
    }
  }

  const byChannel: ChannelAttribution[] = Array.from(channelAcc.entries())
    .map(([channel, v]) => ({ channel, revenue: v.revenue, orders: v.orderIds.size }))
    .sort((a, b) => b.revenue - a.revenue)

  // Resolve campaign metadata for the campaigns that received attribution.
  const campaignIds = Array.from(campaignAcc.keys())
  const campaigns =
    campaignIds.length > 0
      ? await prisma.campaign.findMany({
          where: { merchantId, id: { in: campaignIds } },
          select: { id: true, name: true, channel: true, recipientCount: true },
        })
      : []
  const campaignMeta = new Map(campaigns.map((c) => [c.id, c]))

  const byCampaign: CampaignAttributionRow[] = Array.from(campaignAcc.entries())
    .map(([campaignId, revenue]) => {
      const meta = campaignMeta.get(campaignId)
      const recipientCount = meta?.recipientCount ?? 0
      return {
        campaignId,
        name: meta?.name ?? '(unknown campaign)',
        channel: meta?.channel ?? '',
        revenue,
        recipientCount,
        roi: recipientCount > 0 ? revenue / recipientCount : null,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  return {
    model,
    byChannel,
    byCampaign,
    totalAttributed,
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

async function attributionHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
    const result = await buildAttribution(merchantId, parsed.data.model, from, to)
    await reply.send({ success: true, data: result })
  } catch (err) {
    request.log.error({ err }, 'Failed to build revenue attribution')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to build revenue attribution' },
    })
  }
}

const attributionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/attribution', attributionHandler)
}

export default attributionRoutes
