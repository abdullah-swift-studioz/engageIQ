// apps/api/src/services/conversation.service.ts
//
// The two-way WhatsApp conversation engine's orchestration + read layer (guide §7.2, §10.1).
//   dispatchInbound()  — entry called by the whatsapp webhook for every non-STOP inbound from a
//                        known customer: match to an active conversation and route to its context.
//   list / get / stats — tenant-scoped reads that back the conversations inbox UI.
//
// Every query is scoped by merchantId (multi-tenancy rule). The engine never SENDS — outbound is the
// Channels lane's job; this lane opens/closes/routes conversations and resolves the waiting context.
import { prisma } from '@engageiq/db'
import type { WhatsAppConversationState } from '@prisma/client'
import type { ConversationContextType } from '@engageiq/shared'
import { findActiveConversation, openConversation, touchInbound } from '../lib/conversations/state.js'
import { resolveJourneyReply } from '../lib/conversations/journey-reply.js'
import { resolveVerificationReply } from '../lib/conversations/verification.js'

export interface InboundDispatch {
  merchantId: string
  customerId: string
  phone: string
  text: string
}

// Route one inbound WhatsApp message (already persisted as a Message row, already confirmed non-STOP)
// to the two-way engine. Matches the active conversation for (merchant, phone); if awaiting a reply
// within its deadline, resolves the waiting context; otherwise records the inbound (renewing the 24h
// window) and, when there is no conversation at all, opens a freeform one so the thread surfaces in
// the inbox. Never throws — the webhook must always 200 to Meta.
export async function dispatchInbound(input: InboundDispatch): Promise<void> {
  const now = new Date()

  const convo = await findActiveConversation(input.merchantId, input.phone)
  if (!convo) {
    // An inbound message opens a 24h service window. Auto-open a freeform conversation so the thread
    // appears in the inbox and the window is tracked (a fresh row is born OPEN, taking the unique slot).
    const opened = await openConversation({
      merchantId: input.merchantId,
      phone: input.phone,
      customerId: input.customerId,
      contextType: 'freeform',
    })
    await touchInbound(opened.id, now)
    return
  }

  // Renew the free-form window on every inbound.
  await touchInbound(convo.id, now)

  // Only an AWAITING_REPLY conversation still inside its deadline is a structured reply. (A reply that
  // arrives after the deadline is treated as free-form; the timeout worker owns the timeout branch.)
  const awaiting =
    convo.state === 'AWAITING_REPLY' &&
    convo.awaitingReplyUntil !== null &&
    now.getTime() <= convo.awaitingReplyUntil.getTime()

  if (awaiting) {
    const ctx = convo.contextType as ConversationContextType
    if (ctx === 'journey_reply') {
      await resolveJourneyReply(convo, input.text)
    } else if (ctx === 'verification') {
      await resolveVerificationReply(convo, input.text)
    }
    // 'freeform' awaiting has nothing structured to resolve.
    return
  }

  // Free-form message inside the window (or a late reply): the Message row already exists; nothing to
  // route. The conversation stays OPEN.
}

// ─── Read layer (inbox UI) ────────────────────────────────────────────────────

export interface ListConversationsParams {
  page: number
  pageSize: number
  state?: WhatsAppConversationState
}

// One inbox row: the conversation, its customer, and a preview of the most recent WhatsApp message.
export async function listConversations(merchantId: string, params: ListConversationsParams) {
  const where = {
    merchantId,
    ...(params.state ? { state: params.state } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.whatsAppConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    }),
    prisma.whatsAppConversation.count({ where }),
  ])

  // Last-message preview per row. Inbox pages are small (≤50) so a per-row lookup is acceptable;
  // documented as a known N+1 to revisit if inbox volume grows.
  const items = await Promise.all(
    rows.map(async (c) => {
      const last = await prisma.message.findFirst({
        where: {
          merchantId,
          channel: 'WHATSAPP',
          OR: [{ fromPhone: c.phone }, { toPhone: c.phone }],
        },
        orderBy: { createdAt: 'desc' },
        select: { body: true, direction: true, createdAt: true },
      })
      return {
        id: c.id,
        phone: c.phone,
        state: c.state,
        contextType: c.contextType,
        contextId: c.contextId,
        awaitingReplyUntil: c.awaitingReplyUntil,
        lastInboundAt: c.lastInboundAt,
        lastOutboundAt: c.lastOutboundAt,
        journeyEnrollmentId: c.journeyEnrollmentId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        customer: c.customer,
        lastMessage: last,
      }
    }),
  )

  return { items, total, page: params.page, pageSize: params.pageSize }
}

// A single conversation with its full WhatsApp message thread (ascending). Tenant-scoped.
export async function getConversation(merchantId: string, conversationId: string) {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, merchantId },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
    },
  })
  if (!convo) return null

  const messages = await prisma.message.findMany({
    where: {
      merchantId,
      channel: 'WHATSAPP',
      OR: [{ fromPhone: convo.phone }, { toPhone: convo.phone }],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      direction: true,
      status: true,
      body: true,
      fromPhone: true,
      toPhone: true,
      errorTitle: true,
      createdAt: true,
    },
  })

  return { conversation: convo, messages }
}

// Inbox header counts by state. Returns a full record so every state renders (even at 0).
export async function conversationStats(merchantId: string) {
  const grouped = await prisma.whatsAppConversation.groupBy({
    by: ['state'],
    where: { merchantId },
    _count: { _all: true },
  })
  const counts: Record<WhatsAppConversationState, number> = {
    OPEN: 0,
    AWAITING_REPLY: 0,
    CLOSED: 0,
    EXPIRED: 0,
  }
  for (const g of grouped) counts[g.state] = g._count._all
  const total = counts.OPEN + counts.AWAITING_REPLY + counts.CLOSED + counts.EXPIRED
  return { total, byState: counts }
}
