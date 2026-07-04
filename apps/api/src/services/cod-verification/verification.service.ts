// apps/api/src/services/cod-verification/verification.service.ts
//
// COD verification orchestration (roadmap 6.4 / guide §7.4). Owns the ORDER SIDE of the flow:
// contacting the customer, recording every VerificationAttempt, and acting on the confirm/cancel/
// no-response outcome. The two-way WhatsApp CONVERSATION side (matching the inbound reply) is owned
// by the wa-conversation lane; it hands the classified decision back to us via the verification hook
// (lib/conversations/verification.ts → applyVerificationDecision here).
//
// This module is DB-only + calls the channel-dispatch and conversation-arm SEAMS. It never touches
// the queue directly (that lives in ./queue.ts) so it stays unit-testable without Redis, and it
// returns a NextTick descriptor the worker enqueues. Every query is merchant-scoped (tenant safety).
//
// Enum note: CodVerificationStatus has no plain CANCELLED — both a customer cancel and a no-response
// auto-cancel map the ORDER to AUTO_CANCELLED. The nuance (customer said NO vs never replied) is
// preserved at VerificationAttempt.status (CANCELLED vs NO_RESPONSE) and surfaced in analytics.
import { prisma } from '@engageiq/db'
import type {
  CodOrder,
  Customer,
  VerificationChannel,
  VerificationStatus as DbVerificationStatus,
} from '@prisma/client'
import type {
  VerificationChannelName,
  VerificationDecision,
  VerificationStats,
  VerificationChannelStats,
} from '@engageiq/shared'
import { dispatchChannel } from '../../lib/channels/dispatcher.js'
import { reuseOrArmConversation } from '../../lib/conversations/state.js'
import {
  resolveCodVerificationConfig,
  channelForAttempt,
  delayForAttempt,
  type CodVerificationConfigResolved,
} from './config.js'
import { buildVerificationPrompt } from './prompt.js'
import { placeIvrCall } from './ivr.js'
import type { NextTick } from './queue.js'

const MINUTE_MS = 60_000

// ─── Config resolution (per merchant) ─────────────────────────────────────────

async function loadConfig(merchantId: string): Promise<CodVerificationConfigResolved> {
  const settings = await prisma.merchantSettings.findUnique({ where: { merchantId } })
  return resolveCodVerificationConfig(settings?.codVerification)
}

// ─── Scan (decoupled entry point) ─────────────────────────────────────────────

export interface ScanEnrollment {
  merchantId: string
  codOrderId: string
  channel: VerificationChannelName
  delayMs: number
}

/**
 * Find COD orders the fake-order gate flagged PENDING_VERIFICATION that have not yet been contacted
 * (no VerificationAttempt), and return the enrollment descriptors for the worker to enqueue as `start`
 * jobs. The gate is off-limits, so this poll is how its output reaches us. Per-merchant config decides
 * the first-attempt channel + delay; a merchant whose config is disabled is skipped.
 */
export async function scanPendingVerifications(limit = 200): Promise<ScanEnrollment[]> {
  const orders = await prisma.codOrder.findMany({
    where: { verificationStatus: 'PENDING_VERIFICATION', verificationAttempts: { none: {} } },
    select: { id: true, merchantId: true },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })
  if (orders.length === 0) return []

  // Resolve config once per distinct merchant.
  const configByMerchant = new Map<string, CodVerificationConfigResolved>()
  const enrollments: ScanEnrollment[] = []
  for (const order of orders) {
    let config = configByMerchant.get(order.merchantId)
    if (!config) {
      config = await loadConfig(order.merchantId)
      configByMerchant.set(order.merchantId, config)
    }
    if (!config.enabled) continue
    enrollments.push({
      merchantId: order.merchantId,
      codOrderId: order.id,
      channel: channelForAttempt(config, 1),
      delayMs: delayForAttempt(config, 1) * MINUTE_MS,
    })
  }
  return enrollments
}

// ─── Attempt sending (start = attempt 1, reminder = attempt N) ────────────────

export type RunAttemptStatus = 'sent' | 'skipped' | 'noop'

export interface RunAttemptResult {
  status: RunAttemptStatus
  // The next escalation tick to schedule (reminder N+1 or the finalize timeout). Absent on noop.
  next?: NextTick
}

// Map a resolved channel name to the DB VerificationChannel enum (identical members).
function toDbChannel(channel: VerificationChannelName): VerificationChannel {
  return channel as VerificationChannel
}

// Compute the next tick (reminder or timeout) after attempt N is sent, and the reply-window deadline.
function computeNext(
  config: CodVerificationConfigResolved,
  merchantId: string,
  codOrderId: string,
  attemptNumber: number,
  now: Date,
): { next: NextTick; awaitingReplyUntil: Date } {
  const thisDelay = delayForAttempt(config, attemptNumber)
  if (attemptNumber < config.attempts.length) {
    const nextNumber = attemptNumber + 1
    const gapMin = Math.max(0, delayForAttempt(config, nextNumber) - thisDelay)
    const delayMs = gapMin * MINUTE_MS
    return {
      next: {
        job: { type: 'reminder', merchantId, codOrderId, attemptNumber: nextNumber },
        delayMs,
        jobId: `codverify:${codOrderId}:reminder:${nextNumber}`,
      },
      awaitingReplyUntil: new Date(now.getTime() + delayMs),
    }
  }
  const gapMin = Math.max(0, config.autoCancelDelayMinutes - thisDelay)
  const delayMs = gapMin * MINUTE_MS
  return {
    next: {
      job: { type: 'timeout', merchantId, codOrderId },
      delayMs,
      jobId: `codverify:${codOrderId}:timeout`,
    },
    awaitingReplyUntil: new Date(now.getTime() + delayMs),
  }
}

// Resolve a display product name from the matching Order's lineItems Json (best-effort, cosmetic).
async function resolveProduct(merchantId: string, shopifyOrderId: string): Promise<string | null> {
  const order = await prisma.order.findUnique({
    where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
    select: { lineItems: true },
  })
  const items = order?.lineItems
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0] as Record<string, unknown>
    const title = first.title ?? first.name
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  return null
}

/**
 * Send verification attempt `attemptNumber` (1-based) for a COD order and return the next tick to
 * schedule. Idempotent: if the order already left PENDING_VERIFICATION (confirmed/cancelled) it is a
 * no-op; if this exact attempt row already exists (a job retry) the send is not repeated. A failed
 * send does NOT stop escalation — the ladder still advances so a later channel / the auto-cancel runs.
 */
export async function runAttempt(
  merchantId: string,
  codOrderId: string,
  attemptNumber: number,
  now: Date = new Date(),
): Promise<RunAttemptResult> {
  const order = await prisma.codOrder.findFirst({ where: { id: codOrderId, merchantId } })
  if (!order || order.verificationStatus !== 'PENDING_VERIFICATION') return { status: 'noop' }

  const config = await loadConfig(merchantId)
  if (!config.enabled) return { status: 'noop' }

  // Clamp to the ladder length (defensive; the worker never schedules past it).
  const n = Math.min(Math.max(attemptNumber, 1), config.attempts.length)
  const channel = channelForAttempt(config, n)
  const { next, awaitingReplyUntil } = computeNext(config, merchantId, codOrderId, n, now)

  // Idempotency: skip re-sending if this attempt row was already processed by a prior job run.
  const prior = await prisma.verificationAttempt.findUnique({
    where: { codOrderId_attemptNumber: { codOrderId, attemptNumber: n } },
  })
  if (prior && prior.status !== 'PENDING') {
    return { status: 'sent', next }
  }

  const customer = order.customerId
    ? await prisma.customer.findFirst({ where: { id: order.customerId, merchantId } })
    : null

  // Ensure the attempt row exists (PENDING) before sending, so a mid-send crash still leaves a trace.
  await prisma.verificationAttempt.upsert({
    where: { codOrderId_attemptNumber: { codOrderId, attemptNumber: n } },
    create: {
      merchantId,
      codOrderId,
      customerId: order.customerId,
      channel: toDbChannel(channel),
      status: 'PENDING',
      attemptNumber: n,
    },
    update: { channel: toDbChannel(channel) },
  })

  const sendResult = await sendOnChannel(order, customer, channel, config, awaitingReplyUntil, now)

  await prisma.verificationAttempt.update({
    where: { codOrderId_attemptNumber: { codOrderId, attemptNumber: n } },
    data: { status: sendResult.status, sentAt: now },
  })

  // Stamp the order's first-contact time once.
  if (!order.verificationSentAt) {
    await prisma.codOrder.update({ where: { id: order.id }, data: { verificationSentAt: now } })
  }

  return { status: sendResult.status === 'FAILED' ? 'skipped' : 'sent', next }
}

// Perform the actual send for one channel; returns the resulting attempt status. Never throws — a
// send failure degrades to a FAILED attempt so escalation continues.
async function sendOnChannel(
  order: CodOrder,
  customer: Customer | null,
  channel: VerificationChannelName,
  config: CodVerificationConfigResolved,
  awaitingReplyUntil: Date,
  now: Date,
): Promise<{ status: DbVerificationStatus }> {
  const phone = customer?.phone ?? null
  const body = buildVerificationPrompt(
    {
      orderNumber: order.orderNumber,
      amount: Number(order.amount),
      product: await resolveProduct(order.merchantId, order.shopifyOrderId),
      firstName: customer?.firstName ?? null,
    },
    config,
  )

  try {
    if (channel === 'IVR') {
      if (!phone) return { status: 'FAILED' }
      const res = await placeIvrCall({ toPhone: phone, orderNumber: order.orderNumber, amount: Number(order.amount) })
      // placed/mocked → the call is out (or intentionally skipped); await the reply window/finalize.
      // failed → mark FAILED but let escalation continue.
      return { status: res.status === 'failed' ? 'FAILED' : 'AWAITING' }
    }

    // WHATSAPP / SMS both go through the channel-dispatch seam (needs a customer + phone).
    if (!customer || !phone) return { status: 'FAILED' }

    await dispatchChannel(channel, customer.id, { body }, order.merchantId, {
      ...(channel === 'WHATSAPP' && config.whatsappTemplateId
        ? { templateId: config.whatsappTemplateId }
        : {}),
    })

    // WhatsApp is two-way: arm the conversation so the inbound reply routes to the verification
    // context (contextId = codOrderId) and resolves via applyVerificationDecision. SMS is one-way in
    // this lane (no SMS inbound engine) — it's a notification/reminder only (documented known gap).
    if (channel === 'WHATSAPP') {
      await reuseOrArmConversation({
        merchantId: order.merchantId,
        phone,
        customerId: customer.id,
        contextType: 'verification',
        contextId: order.id,
        awaitingReplyUntil,
      })
    }
    return { status: 'AWAITING' }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: '[cod-verify] send failed',
        codOrderId: order.id,
        channel,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { status: 'FAILED' }
  }
}

// ─── Decision (confirm / cancel) — from the WhatsApp reply hook or a manual action ────────────────

export interface ApplyDecisionInput {
  merchantId: string
  codOrderId: string
  decision: Exclude<VerificationDecision, 'UNKNOWN'>
  // The raw reply text / IVR digit / 'manual' marker recorded on the attempt.
  response?: string
  respondedAt?: Date
}

export interface ApplyDecisionResult {
  status: 'applied' | 'noop'
  verificationStatus: CodOrder['verificationStatus']
}

/**
 * Apply a confirm/cancel decision to a COD order. Called by the wa-conversation verification hook on
 * a matched WhatsApp reply, and by the manual agent-action routes. Idempotent: once the order has left
 * PENDING_VERIFICATION it is a no-op (a late reply or a double-fire cannot flip a decided order).
 *
 * CONFIRM → order VERIFIED + status CONFIRMED (released for fulfillment).
 * CANCEL  → order AUTO_CANCELLED + status CANCELLED (the enum has no plain CANCELLED for verification).
 */
export async function applyVerificationDecision(input: ApplyDecisionInput): Promise<ApplyDecisionResult> {
  const now = input.respondedAt ?? new Date()
  const order = await prisma.codOrder.findFirst({
    where: { id: input.codOrderId, merchantId: input.merchantId },
  })
  if (!order) return { status: 'noop', verificationStatus: 'UNVERIFIED' }
  if (order.verificationStatus !== 'PENDING_VERIFICATION') {
    return { status: 'noop', verificationStatus: order.verificationStatus }
  }

  const confirmed = input.decision === 'CONFIRM'
  const attemptStatus: DbVerificationStatus = confirmed ? 'CONFIRMED' : 'CANCELLED'

  // Mark the most recent awaiting/pending attempt with the decision (best-effort — a manual action
  // with no live attempt still records the order-level outcome below).
  const currentAttempt = await prisma.verificationAttempt.findFirst({
    where: { codOrderId: order.id, merchantId: input.merchantId, status: { in: ['AWAITING', 'PENDING'] } },
    orderBy: { attemptNumber: 'desc' },
  })
  if (currentAttempt) {
    await prisma.verificationAttempt.update({
      where: { id: currentAttempt.id },
      data: {
        status: attemptStatus,
        respondedAt: now,
        ...(input.response !== undefined ? { response: input.response } : {}),
      },
    })
  }

  await prisma.codOrder.update({
    where: { id: order.id },
    data: {
      verificationStatus: confirmed ? 'VERIFIED' : 'AUTO_CANCELLED',
      status: confirmed ? 'CONFIRMED' : 'CANCELLED',
      verificationRepliedAt: now,
    },
  })

  await closeVerificationConversation(input.merchantId, order.id)

  console.info(
    JSON.stringify({
      level: 'info',
      msg: '[cod-verify] decision applied',
      codOrderId: order.id,
      decision: input.decision,
      verificationStatus: confirmed ? 'VERIFIED' : 'AUTO_CANCELLED',
    }),
  )
  return { status: 'applied', verificationStatus: confirmed ? 'VERIFIED' : 'AUTO_CANCELLED' }
}

// ─── Finalize (auto-cancel on no-response) ────────────────────────────────────

export interface FinalizeResult {
  status: 'auto_cancelled' | 'held_for_review' | 'noop'
}

/**
 * The auto-cancel deadline elapsed without a confirm. Marks the last awaiting attempt NO_RESPONSE and
 * either auto-cancels the order (AUTO_CANCELLED) or, when the merchant disabled auto-cancel, leaves it
 * PENDING_VERIFICATION for manual agent review. Idempotent (no-op once the order is decided).
 */
export async function finalizeVerification(
  merchantId: string,
  codOrderId: string,
  now: Date = new Date(),
): Promise<FinalizeResult> {
  const order = await prisma.codOrder.findFirst({ where: { id: codOrderId, merchantId } })
  if (!order || order.verificationStatus !== 'PENDING_VERIFICATION') return { status: 'noop' }

  const config = await loadConfig(merchantId)

  // Mark any still-awaiting attempts as no-response.
  await prisma.verificationAttempt.updateMany({
    where: { codOrderId: order.id, merchantId, status: { in: ['AWAITING', 'PENDING'] } },
    data: { status: 'NO_RESPONSE', respondedAt: now },
  })

  if (!config.autoCancel) {
    console.info(
      JSON.stringify({ level: 'info', msg: '[cod-verify] held for manual review', codOrderId: order.id }),
    )
    return { status: 'held_for_review' }
  }

  await prisma.codOrder.update({
    where: { id: order.id },
    data: { verificationStatus: 'AUTO_CANCELLED', status: 'CANCELLED', verificationRepliedAt: now },
  })
  await closeVerificationConversation(merchantId, order.id)

  console.info(
    JSON.stringify({ level: 'info', msg: '[cod-verify] auto-cancelled (no response)', codOrderId: order.id }),
  )
  return { status: 'auto_cancelled' }
}

// Close any active verification conversation for this order (tenant-scoped). The WhatsApp reply path
// already closes it via the engine; this covers the manual + timeout paths and is a harmless no-op
// when none is open.
async function closeVerificationConversation(merchantId: string, codOrderId: string): Promise<void> {
  await prisma.whatsAppConversation.updateMany({
    where: {
      merchantId,
      contextType: 'verification',
      contextId: codOrderId,
      state: { in: ['OPEN', 'AWAITING_REPLY'] },
    },
    data: { state: 'CLOSED' },
  })
}

// ─── Read layer (dashboard + detail) ──────────────────────────────────────────

const IN_VERIFICATION_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'AUTO_CANCELLED'] as const
type InVerificationStatus = (typeof IN_VERIFICATION_STATUSES)[number]

export interface ListVerificationsParams {
  page: number
  pageSize: number
  status?: InVerificationStatus
}

export interface VerificationListItem {
  codOrderId: string
  orderNumber: string
  amount: string
  city: string | null
  verificationStatus: CodOrder['verificationStatus']
  fakeScore: number | null
  attemptCount: number
  lastChannel: VerificationChannelName | null
  lastAttemptAt: string | null
  placedAt: string
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null
}

export interface ListVerificationsResult {
  items: VerificationListItem[]
  page: number
  pageSize: number
  total: number
}

/** Paginated list of COD orders in/through verification for the merchant, newest first. */
export async function listVerifications(
  merchantId: string,
  params: ListVerificationsParams,
): Promise<ListVerificationsResult> {
  const where = {
    merchantId,
    verificationStatus: params.status
      ? { equals: params.status }
      : { in: [...IN_VERIFICATION_STATUSES] },
  }
  const [total, orders] = await Promise.all([
    prisma.codOrder.count({ where }),
    prisma.codOrder.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        verificationAttempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
      },
    }),
  ])

  const items: VerificationListItem[] = orders.map((o) => {
    const last = o.verificationAttempts[0]
    return {
      codOrderId: o.id,
      orderNumber: o.orderNumber,
      amount: o.amount.toString(),
      city: o.city,
      verificationStatus: o.verificationStatus,
      fakeScore: o.fakeScore,
      attemptCount: o.verificationAttempts.length > 0 ? last!.attemptNumber : 0,
      lastChannel: last ? (last.channel as VerificationChannelName) : null,
      lastAttemptAt: last?.sentAt?.toISOString() ?? null,
      placedAt: o.placedAt.toISOString(),
      customer: o.customer,
    }
  })
  return { items, page: params.page, pageSize: params.pageSize, total }
}

export interface VerificationDetailAttempt {
  id: string
  attemptNumber: number
  channel: VerificationChannelName
  status: DbVerificationStatus
  sentAt: string | null
  respondedAt: string | null
  response: string | null
}

export interface VerificationDetail {
  codOrderId: string
  orderNumber: string
  amount: string
  city: string | null
  province: string | null
  courier: string | null
  status: CodOrder['status']
  verificationStatus: CodOrder['verificationStatus']
  fakeScore: number | null
  placedAt: string
  verificationSentAt: string | null
  verificationRepliedAt: string | null
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null; email: string | null } | null
  attempts: VerificationDetailAttempt[]
}

/** Full verification detail for one COD order: the order, its customer, and the attempt timeline. */
export async function getVerification(
  merchantId: string,
  codOrderId: string,
): Promise<VerificationDetail | null> {
  const order = await prisma.codOrder.findFirst({
    where: { id: codOrderId, merchantId },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      verificationAttempts: { orderBy: { attemptNumber: 'asc' } },
    },
  })
  if (!order) return null

  return {
    codOrderId: order.id,
    orderNumber: order.orderNumber,
    amount: order.amount.toString(),
    city: order.city,
    province: order.province,
    courier: order.courier,
    status: order.status,
    verificationStatus: order.verificationStatus,
    fakeScore: order.fakeScore,
    placedAt: order.placedAt.toISOString(),
    verificationSentAt: order.verificationSentAt?.toISOString() ?? null,
    verificationRepliedAt: order.verificationRepliedAt?.toISOString() ?? null,
    customer: order.customer,
    attempts: order.verificationAttempts.map((a) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      channel: a.channel as VerificationChannelName,
      status: a.status,
      sentAt: a.sentAt?.toISOString() ?? null,
      respondedAt: a.respondedAt?.toISOString() ?? null,
      response: a.response,
    })),
  }
}

// ─── Analytics (guide §7.4 "Verification analytics") ──────────────────────────

const ALL_CHANNELS: VerificationChannelName[] = ['WHATSAPP', 'SMS', 'IVR']

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

/** Aggregate verification analytics for the merchant: rates + per-channel breakdown + revenue saved. */
export async function verificationStats(merchantId: string): Promise<VerificationStats> {
  const [pending, verified, autoCancelled, cancelledOrders, savedAgg, channelRows] = await Promise.all([
    prisma.codOrder.count({ where: { merchantId, verificationStatus: 'PENDING_VERIFICATION' } }),
    prisma.codOrder.count({
      where: { merchantId, verificationStatus: 'VERIFIED', verificationAttempts: { some: {} } },
    }),
    prisma.codOrder.count({
      where: { merchantId, verificationStatus: 'AUTO_CANCELLED', verificationAttempts: { some: {} } },
    }),
    prisma.codOrder.count({
      where: {
        merchantId,
        verificationStatus: 'AUTO_CANCELLED',
        verificationAttempts: { some: { status: 'CANCELLED' } },
      },
    }),
    prisma.codOrder.aggregate({
      where: { merchantId, verificationStatus: 'AUTO_CANCELLED', verificationAttempts: { some: {} } },
      _sum: { amount: true },
    }),
    prisma.verificationAttempt.groupBy({
      by: ['channel', 'status'],
      where: { merchantId },
      _count: { _all: true },
    }),
  ])

  const noResponseOrders = Math.max(0, autoCancelled - cancelledOrders)
  const terminal = verified + autoCancelled
  const responded = verified + cancelledOrders // confirmed or explicitly cancelled

  const byChannel: VerificationChannelStats[] = ALL_CHANNELS.map((channel) => {
    const rows = channelRows.filter((r) => (r.channel as VerificationChannelName) === channel)
    const countFor = (status: DbVerificationStatus): number =>
      rows.filter((r) => r.status === status).reduce((sum, r) => sum + r._count._all, 0)
    return {
      channel,
      attempts: rows.reduce((sum, r) => sum + r._count._all, 0),
      confirmed: countFor('CONFIRMED'),
      cancelled: countFor('CANCELLED'),
      noResponse: countFor('NO_RESPONSE'),
      failed: countFor('FAILED'),
    }
  })

  return {
    totalInVerification: pending + verified + autoCancelled,
    pending,
    verified,
    autoCancelled,
    confirmRate: rate(verified, terminal),
    cancelRate: rate(cancelledOrders, terminal),
    noResponseRate: rate(noResponseOrders, terminal),
    responseRate: rate(responded, terminal),
    revenueSaved: (savedAgg._sum.amount ?? 0).toString(),
    byChannel,
  }
}
