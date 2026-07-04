// apps/api/src/lib/conversations/state.ts
//
// The WhatsAppConversation lifecycle primitives — the only place conversation `state` transitions.
// State model (schema enum WhatsAppConversationState):
//   OPEN            live thread; free-form inbound within the 24h window routes here
//   AWAITING_REPLY  a prompt was sent and we're waiting for a structured reply until awaitingReplyUntil
//   CLOSED          resolved (terminal)
//   EXPIRED         awaiting-reply timed out (terminal)
//
// Determinism: the DB enforces a partial-unique (merchant_id, phone) WHERE state='OPEN', so there is
// at most one OPEN conversation per phone. A conversation is always BORN OPEN (taking that slot),
// then flips to AWAITING_REPLY only when a reply-expecting prompt is sent. openConversation() always
// reuses an existing active (OPEN or AWAITING_REPLY) row and only creates when none exists, with the
// partial-unique as the create-race backstop (P2002 → re-fetch the winner).
import { prisma } from '@engageiq/db'
import type { WhatsAppConversation } from '@prisma/client'
import type { ConversationContextType } from '@engageiq/shared'

// OPEN and AWAITING_REPLY are the two non-terminal ("active") states.
const ACTIVE_STATES = ['OPEN', 'AWAITING_REPLY'] as const

export interface OpenConversationInput {
  merchantId: string
  phone: string
  customerId?: string | null
  contextType: ConversationContextType
  contextId?: string | null
  journeyEnrollmentId?: string | null
}

// The single active conversation for (merchant, phone), or null. Newest first (defensive — the
// partial-unique guarantees ≤1 OPEN, and app logic keeps ≤1 active).
export function findActiveConversation(
  merchantId: string,
  phone: string,
): Promise<WhatsAppConversation | null> {
  return prisma.whatsAppConversation.findFirst({
    where: { merchantId, phone, state: { in: [...ACTIVE_STATES] } },
    orderBy: { createdAt: 'desc' },
  })
}

// Serialize find-or-create/arm for one (merchant, phone) with a Postgres transaction-scoped advisory
// lock. The partial-unique only covers state='OPEN'; once a row flips to AWAITING_REPLY it vacates that
// slot, so the DB constraint alone cannot stop two concurrent opens from BOTH seeing "no active row" and
// creating two active conversations. The advisory lock closes that race (different phones hash to
// different keys and never contend). The lock releases automatically at transaction end.

// Get-or-create the active OPEN conversation for (merchant, phone), advisory-locked so concurrent opens
// can't create duplicates. Reuses any active row (OPEN or AWAITING_REPLY) rather than creating a second.
export function openConversation(input: OpenConversationInput): Promise<WhatsAppConversation> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.merchantId}|${input.phone}`}))`
    const existing = await tx.whatsAppConversation.findFirst({
      where: { merchantId: input.merchantId, phone: input.phone, state: { in: [...ACTIVE_STATES] } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return existing
    return tx.whatsAppConversation.create({
      data: {
        merchantId: input.merchantId,
        phone: input.phone,
        customerId: input.customerId ?? null,
        contextType: input.contextType,
        contextId: input.contextId ?? null,
        journeyEnrollmentId: input.journeyEnrollmentId ?? null,
        state: 'OPEN',
      },
    })
  })
}

export type ArmResult =
  | { status: 'armed'; conversation: WhatsAppConversation }
  | { status: 'conflict'; conversation: WhatsAppConversation }

// Atomically (advisory-locked per phone) reuse-or-create the active conversation for (merchant, phone) and
// arm it to AWAITING_REPLY for a structured wait — UNLESS it is already AWAITING_REPLY for a DIFFERENT
// waiting context, in which case we REFUSE to clobber and return { status: 'conflict' } (the caller then
// resolves the new context deterministically instead of silently stranding the existing waiter). Re-arming
// the SAME context (same contextId + journeyEnrollmentId) is idempotent. Doing the conflict check and the
// arm in one locked transaction is what makes "one waiter per phone" safe under executor concurrency.
export async function reuseOrArmConversation(
  input: OpenConversationInput & { awaitingReplyUntil: Date },
): Promise<ArmResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.merchantId}|${input.phone}`}))`
    const existing = await tx.whatsAppConversation.findFirst({
      where: { merchantId: input.merchantId, phone: input.phone, state: { in: [...ACTIVE_STATES] } },
      orderBy: { createdAt: 'desc' },
    })

    if (existing && existing.state === 'AWAITING_REPLY') {
      const sameContext =
        existing.contextId === (input.contextId ?? null) &&
        existing.journeyEnrollmentId === (input.journeyEnrollmentId ?? null)
      if (!sameContext) return { status: 'conflict', conversation: existing }
    }

    const armData = {
      state: 'AWAITING_REPLY' as const,
      awaitingReplyUntil: input.awaitingReplyUntil,
      contextType: input.contextType,
      contextId: input.contextId ?? null,
      journeyEnrollmentId: input.journeyEnrollmentId ?? null,
      lastOutboundAt: new Date(),
    }

    if (existing) {
      const updated = await tx.whatsAppConversation.update({ where: { id: existing.id }, data: armData })
      return { status: 'armed', conversation: updated }
    }
    const created = await tx.whatsAppConversation.create({
      data: {
        merchantId: input.merchantId,
        phone: input.phone,
        customerId: input.customerId ?? null,
        ...armData,
      },
    })
    return { status: 'armed', conversation: created }
  })
}

// Atomically claim a structured reply: AWAITING_REPLY → OPEN, clearing the deadline. Returns true iff
// we won the claim (count === 1). Mutually exclusive with expireConversation() — whoever flips the
// state first wins, so a reply and its timeout can never both fire a branch.
export async function claimStructuredReply(conversationId: string): Promise<boolean> {
  const { count } = await prisma.whatsAppConversation.updateMany({
    where: { id: conversationId, state: 'AWAITING_REPLY' },
    data: { state: 'OPEN', awaitingReplyUntil: null },
  })
  return count === 1
}

// Atomically expire an awaiting conversation: AWAITING_REPLY → EXPIRED, but only if the deadline
// still matches `awaitingReplyUntilMs` (so a stale timeout job from a previous await round can't
// expire a re-armed conversation). Returns true iff we won (count === 1).
export async function expireConversation(
  conversationId: string,
  awaitingReplyUntilMs: number,
): Promise<boolean> {
  const { count } = await prisma.whatsAppConversation.updateMany({
    where: {
      id: conversationId,
      state: 'AWAITING_REPLY',
      awaitingReplyUntil: new Date(awaitingReplyUntilMs),
    },
    data: { state: 'EXPIRED' },
  })
  return count === 1
}

// Terminal close (e.g. a resolved verification). Does not guard on prior state.
export function closeConversation(conversationId: string): Promise<WhatsAppConversation> {
  return prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { state: 'CLOSED' },
  })
}

// Stamp the customer's last inbound — (re)opens the 24h free-form service window.
export function touchInbound(conversationId: string, at: Date): Promise<WhatsAppConversation> {
  return prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { lastInboundAt: at },
  })
}
