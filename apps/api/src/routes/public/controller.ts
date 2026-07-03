import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma, getEventCountsByType, getActiveVisitorCount, getRevenueByDay } from '@engageiq/db'
import { campaignSendQueue, segmentEvaluateQueue } from '@engageiq/queue'
import { CAMPAIGN_SEND, SEGMENT_EVALUATE } from '@engageiq/shared'
import type { CampaignSendJob, SegmentEvaluateJobPayload } from '@engageiq/shared'
import { publicMerchant } from './auth.js'
import { validateConditionTree } from '../../lib/segments/condition-validator.js'
import {
  CreateSegmentBodySchema,
  UpdateSegmentBodySchema,
} from '../segments/schema.js'
import {
  createSegment,
  listSegments,
  getSegment,
  updateSegment,
  deleteSegment,
} from '../segments/service.js'
import { CustomEventBodySchema } from '../events/schema.js'
import { ingestCustomEvent } from '../events/service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}
function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message } })
}
function parsePaging(request: FastifyRequest): { page: number; pageSize: number } {
  const q = request.query as { page?: string; pageSize?: string }
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.max(1, Math.min(100, Number(q.pageSize) || 25))
  return { page, pageSize }
}

// ─── Customers ────────────────────────────────────────────────────────────────
const CUSTOMER_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  totalOrders: true,
  totalSpent: true,
  rfmSegment: true,
  churnScore: true,
  churnRiskLabel: true,
  isSubscribedWhatsapp: true,
  isSubscribedEmail: true,
  isSubscribedSms: true,
  lastSeenAt: true,
  createdAt: true,
} as const

function serializeCustomer(c: Record<string, unknown>): Record<string, unknown> {
  return {
    ...c,
    totalSpent: c.totalSpent != null ? Number(c.totalSpent) : 0,
    lastSeenAt: c.lastSeenAt instanceof Date ? c.lastSeenAt.toISOString() : c.lastSeenAt,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
  }
}

export async function listCustomersHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { page, pageSize } = parsePaging(request)
  const q = request.query as { search?: string }
  const where = {
    merchantId,
    mergedIntoId: null,
    ...(q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: 'insensitive' as const } },
            { phone: { contains: q.search } },
            { firstName: { contains: q.search, mode: 'insensitive' as const } },
            { lastName: { contains: q.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: CUSTOMER_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ])
  await reply.send({
    success: true,
    data: items.map(serializeCustomer),
    meta: { page, pageSize, total },
  })
}

export async function getCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
  const customer = await prisma.customer.findFirst({ where: { id, merchantId }, select: CUSTOMER_SELECT })
  if (!customer) {
    await notFound(reply, 'Customer not found')
    return
  }
  await reply.send({ success: true, data: serializeCustomer(customer) })
}

export async function getCustomerSegmentsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
  const customer = await prisma.customer.findFirst({ where: { id, merchantId }, select: { id: true } })
  if (!customer) {
    await notFound(reply, 'Customer not found')
    return
  }
  // Tenant-safe: memberships scope through their merchant-owned segment.
  const memberships = await prisma.segmentMembership.findMany({
    where: { customerId: id, exitedAt: null, segment: { merchantId } },
    select: {
      enteredAt: true,
      segment: { select: { id: true, name: true } },
    },
    orderBy: { enteredAt: 'desc' },
  })
  await reply.send({
    success: true,
    data: memberships.map((m) => ({
      segmentId: m.segment.id,
      name: m.segment.name,
      enteredAt: m.enteredAt.toISOString(),
    })),
  })
}

// ─── Segments ─────────────────────────────────────────────────────────────────
export async function listSegmentsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { page, pageSize } = parsePaging(request)
  const result = await listSegments(merchantId, page, pageSize)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getSegmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
  const segment = await getSegment(merchantId, id)
  if (!segment) {
    await notFound(reply, 'Segment not found')
    return
  }
  await reply.send({ success: true, data: segment })
}

export async function createSegmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
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
  const segment = await createSegment(merchantId, parsed.data)
  await enqueueSegmentEvaluate(segment.id, merchantId)
  await reply.status(201).send({ success: true, data: segment })
}

export async function updateSegmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
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
  const segment = await updateSegment(merchantId, id, parsed.data)
  if (!segment) {
    await notFound(reply, 'Segment not found')
    return
  }
  await enqueueSegmentEvaluate(segment.id, merchantId)
  await reply.send({ success: true, data: segment })
}

export async function deleteSegmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
  const deleted = await deleteSegment(merchantId, id)
  if (!deleted) {
    await notFound(reply, 'Segment not found')
    return
  }
  await reply.send({ success: true, data: { id } })
}

async function enqueueSegmentEvaluate(segmentId: string, merchantId: string): Promise<void> {
  const payload: SegmentEvaluateJobPayload = { segmentId, merchantId }
  await segmentEvaluateQueue.add(SEGMENT_EVALUATE, payload, { jobId: `seg_${segmentId}` })
}

// ─── Custom events (push) ───────────────────────────────────────────────────────
export async function pushEventHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const parsed = CustomEventBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  try {
    const { event_id } = await ingestCustomEvent(merchantId, parsed.data)
    await reply.status(201).send({ success: true, data: { event_id } })
  } catch (err) {
    if (err instanceof Error && err.message === 'CUSTOMER_NOT_FOUND') {
      await notFound(reply, 'Customer not found')
      return
    }
    throw err
  }
}

// ─── Campaigns ─────────────────────────────────────────────────────────────────
const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  channel: true,
  status: true,
  segmentId: true,
  sendAt: true,
  sentAt: true,
  recipientCount: true,
  deliveredCount: true,
  createdAt: true,
} as const

function serializeCampaign(c: Record<string, unknown>): Record<string, unknown> {
  return {
    ...c,
    sendAt: c.sendAt instanceof Date ? c.sendAt.toISOString() : c.sendAt,
    sentAt: c.sentAt instanceof Date ? c.sentAt.toISOString() : c.sentAt,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
  }
}

export async function listCampaignsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { page, pageSize } = parsePaging(request)
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { merchantId },
      select: CAMPAIGN_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaign.count({ where: { merchantId } }),
  ])
  await reply.send({ success: true, data: items.map(serializeCampaign), meta: { page, pageSize, total } })
}

export async function getCampaignHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
  const campaign = await prisma.campaign.findFirst({ where: { id, merchantId }, select: CAMPAIGN_SELECT })
  if (!campaign) {
    await notFound(reply, 'Campaign not found')
    return
  }
  await reply.send({ success: true, data: serializeCampaign(campaign) })
}

export async function triggerCampaignHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const { id } = request.params as { id: string }
  const campaign = await prisma.campaign.findFirst({
    where: { id, merchantId },
    select: { id: true, status: true },
  })
  if (!campaign) {
    await notFound(reply, 'Campaign not found')
    return
  }
  // Guard against re-triggering an already-sent/sending campaign.
  if (campaign.status === 'SENT' || campaign.status === 'SENDING') {
    await reply.status(409).send({
      success: false,
      error: { code: 'CAMPAIGN_NOT_TRIGGERABLE', message: `Campaign is already ${campaign.status}` },
    })
    return
  }
  const job: CampaignSendJob = { type: 'send_campaign', campaignId: id, merchantId }
  // jobId=campaignId dedupes accidental double-trigger (matches the campaigns lane).
  await campaignSendQueue.add(CAMPAIGN_SEND, job, { jobId: id })
  await reply.status(202).send({ success: true, data: { campaignId: id, status: 'queued' } })
}

// ─── Analytics (pull) ────────────────────────────────────────────────────────
export async function analyticsOverviewHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const q = request.query as { days?: string }
  const days = Math.max(1, Math.min(365, Number(q.days) || 30))
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const [eventCounts, activeVisitors, totalCustomers] = await Promise.all([
    getEventCountsByType(merchantId, from, to),
    getActiveVisitorCount(merchantId),
    prisma.customer.count({ where: { merchantId, mergedIntoId: null } }),
  ])

  await reply.send({
    success: true,
    data: {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      totalCustomers,
      activeVisitors,
      eventCounts,
    },
  })
}

export async function analyticsRevenueHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = publicMerchant(request)
  const q = request.query as { days?: string }
  const days = Math.max(1, Math.min(365, Number(q.days) || 30))
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  const revenueByDay = await getRevenueByDay(merchantId, from, to)
  await reply.send({
    success: true,
    data: { range: { from: from.toISOString(), to: to.toISOString(), days }, revenueByDay },
  })
}
