// apps/api/src/lib/conversations/journey-reply.ts
//
// The "journey_reply" conversation context: a journey ACTION step carrying a `waitForReply` block
// (guide §7.2 two-way flows). Because the frozen JourneyStepType enum can't grow, wait-for-reply is
// an ACTION whose Json config has a waitForReply object; isWaitForReplyConfig() is the discriminant.
//
// Flow: the executor calls startJourneyReplyWait() → we send the prompt (fire-and-forget onto the
// Channels lane's message-dispatch queue; we own the conversation, not the send), open a
// journey_reply conversation, park the enrollment (no child advance), and arm a delayed timeout.
// On inbound, conversation.service routes to resolveJourneyReply(); on timeout the timeout worker
// calls journeyReplyTimeout(). Both resume the enrollment by enqueueing execute_step for the branch
// child — the executor then owns the rest of the flow exactly as it does after a CONDITION.
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue, conversationTimeoutQueue } from '@engageiq/queue'
import { JOURNEY_EXECUTOR, CONVERSATION_TIMEOUT } from '@engageiq/shared'
import type {
  JourneyExecutorJob,
  ConversationTimeoutJob,
  WaitForReplyStepConfig,
} from '@engageiq/shared'
import type { WhatsAppConversation } from '@prisma/client'
import { dispatchChannel } from '../channels/dispatcher.js'
import { reuseOrArmConversation, claimStructuredReply } from './state.js'
import { computeTimeoutAt } from './window.js'
import { matchBranch } from './keywords.js'

// Narrow an untyped JourneyStep.config to a wait-for-reply step: an object with a waitForReply
// object whose `branches` is an array. Existing ACTION steps (no waitForReply) fail this, so the
// executor's normal ACTION path is untouched.
export function isWaitForReplyConfig(config: unknown): config is WaitForReplyStepConfig {
  if (typeof config !== 'object' || config === null) return false
  const wfr = (config as { waitForReply?: unknown }).waitForReply
  if (typeof wfr !== 'object' || wfr === null) return false
  return Array.isArray((wfr as { branches?: unknown }).branches)
}

// Find the child step of `parentStepId` whose label matches a resolved branch (same child-by-label
// wiring the CONDITION step uses). Returns the child id or null.
async function resolveBranchChild(parentStepId: string, label: string): Promise<string | null> {
  const child = await prisma.journeyStep.findFirst({
    where: { parentStepId, label },
    select: { id: true },
  })
  return child?.id ?? null
}

// Resume a parked enrollment: enqueue execute_step for the branch child, or (no child) complete the
// enrollment — mirroring the executor's own completion tail so counters stay consistent.
async function resumeEnrollment(
  enrollmentId: string,
  merchantId: string,
  childStepId: string | null,
  dedupeJobId?: string,
): Promise<void> {
  if (childStepId) {
    const job = {
      type: 'execute_step',
      enrollmentId,
      stepId: childStepId,
      merchantId,
    } satisfies JourneyExecutorJob
    // dedupeJobId (timeout path only) makes a retried resume idempotent: BullMQ ignores a duplicate add
    // with the same jobId while the first is still in the queue/retention, so a worker retry after a crash
    // between expire and enqueue can't double-fire the branch. The reply path has single delivery, so it
    // enqueues without a jobId (and journeys with loops still work).
    if (dedupeJobId) {
      await journeyExecutorQueue.add(JOURNEY_EXECUTOR, job, { jobId: dedupeJobId })
    } else {
      await journeyExecutorQueue.add(JOURNEY_EXECUTOR, job)
    }
    return
  }
  const enrollment = await prisma.journeyEnrollment.findFirst({
    where: { id: enrollmentId },
    select: { status: true, journeyId: true },
  })
  if (!enrollment || enrollment.status !== 'ACTIVE') return
  await prisma.journeyEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  })
  await prisma.journey.update({
    where: { id: enrollment.journeyId },
    data: { completionCount: { increment: 1 } },
  })
}

// Called by the journey executor for an ACTION step with a waitForReply block. Sends the prompt,
// opens a journey_reply conversation, parks the enrollment, and arms the timeout. If the customer
// has no phone we can't await a WhatsApp reply, so we resume immediately down the timeout branch.
export async function startJourneyReplyWait(params: {
  merchantId: string
  enrollmentId: string
  customerId: string
  stepId: string
}): Promise<void> {
  const step = await prisma.journeyStep.findFirst({
    where: { id: params.stepId },
    select: { config: true },
  })
  if (!step || !isWaitForReplyConfig(step.config)) {
    // Defensive: not actually a wait-for-reply step — complete rather than park forever.
    await resumeEnrollment(params.enrollmentId, params.merchantId, null)
    return
  }
  const config = step.config as WaitForReplyStepConfig
  const wfr = config.waitForReply

  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, merchantId: params.merchantId },
    select: { phone: true },
  })
  const phone = customer?.phone
  if (!phone) {
    const child = wfr.timeoutLabel ? await resolveBranchChild(params.stepId, wfr.timeoutLabel) : null
    await resumeEnrollment(params.enrollmentId, params.merchantId, child)
    return
  }

  const now = new Date()
  const awaitingReplyUntil = computeTimeoutAt(now, wfr.timeoutMinutes)

  // Atomically (advisory-locked) reuse-or-create + arm the single conversation this phone allows. The frozen
  // schema permits one active conversation per (merchant, phone); if the phone is ALREADY awaiting a
  // different structured reply (another journey wait, or a COD verification), we must not clobber it. On
  // that conflict the earlier waiter keeps the conversation and THIS enrollment takes its timeout branch
  // deterministically — a defined outcome, not a silent strand. We arm BEFORE sending so we never prompt a
  // customer whose reply we couldn't collect.
  const armed = await reuseOrArmConversation({
    merchantId: params.merchantId,
    phone,
    customerId: params.customerId,
    contextType: 'journey_reply',
    contextId: params.stepId,
    journeyEnrollmentId: params.enrollmentId,
    awaitingReplyUntil,
  })

  if (armed.status === 'conflict') {
    const child = wfr.timeoutLabel ? await resolveBranchChild(params.stepId, wfr.timeoutLabel) : null
    await resumeEnrollment(params.enrollmentId, params.merchantId, child)
    return
  }

  // We hold this phone's conversation — now safe to prompt. dispatchChannel enqueues onto the Channels
  // lane's message-dispatch queue; the actual WhatsApp send (and its consent gate) is theirs.
  await dispatchChannel('WHATSAPP', params.customerId, config.content, params.merchantId, {
    journeyEnrollmentId: params.enrollmentId,
  })

  // Arm the timeout as a delayed job. jobId is unique per await round so a re-armed wait gets its own
  // timer and the old job (if it still fires) no-ops via expireConversation's deadline guard.
  const delay = Math.max(0, awaitingReplyUntil.getTime() - now.getTime())
  await conversationTimeoutQueue.add(
    CONVERSATION_TIMEOUT,
    {
      type: 'timeout',
      conversationId: armed.conversation.id,
      awaitingReplyUntilMs: awaitingReplyUntil.getTime(),
    } satisfies ConversationTimeoutJob,
    { delay, jobId: `conv-timeout:${armed.conversation.id}:${awaitingReplyUntil.getTime()}` },
  )
}

// Route an inbound structured reply for a journey_reply conversation. Matches the reply to a branch
// (or the fallback); on a match we atomically claim the reply and resume the enrollment down that
// branch. A reply matching no branch (and no fallback) is left un-claimed so the customer can retry
// until the timeout.
export async function resolveJourneyReply(
  convo: WhatsAppConversation,
  text: string,
): Promise<void> {
  const stepId = convo.contextId
  const enrollmentId = convo.journeyEnrollmentId
  if (!stepId || !enrollmentId) return // malformed context — treat as free-form

  const step = await prisma.journeyStep.findFirst({
    where: { id: stepId },
    select: { config: true },
  })
  if (!step || !isWaitForReplyConfig(step.config)) return
  const wfr = (step.config as WaitForReplyStepConfig).waitForReply

  const label = matchBranch(text, wfr.branches) ?? wfr.fallbackLabel ?? null
  if (label === null) return // no branch matched and no fallback — keep awaiting

  // Claim the reply (AWAITING_REPLY → OPEN). If we lose the race to the timeout, stop.
  const claimed = await claimStructuredReply(convo.id)
  if (!claimed) return

  const child = await resolveBranchChild(stepId, label)
  await resumeEnrollment(enrollmentId, convo.merchantId, child)
}

// Called by the timeout worker once it has atomically expired the conversation. Resumes the
// enrollment down the configured timeout branch (or completes it if none).
export async function journeyReplyTimeout(convo: WhatsAppConversation): Promise<void> {
  const stepId = convo.contextId
  const enrollmentId = convo.journeyEnrollmentId
  if (!stepId || !enrollmentId) return

  const step = await prisma.journeyStep.findFirst({
    where: { id: stepId },
    select: { config: true },
  })
  const timeoutLabel =
    step && isWaitForReplyConfig(step.config)
      ? ((step.config as WaitForReplyStepConfig).waitForReply.timeoutLabel ?? null)
      : null
  const child = timeoutLabel ? await resolveBranchChild(stepId, timeoutLabel) : null
  // Deterministic dedupe key (conversation + deadline) so a retried timeout worker resumes at most once.
  const dedupeJobId = `conv-resume:${convo.id}:${convo.awaitingReplyUntil?.getTime() ?? 'na'}`
  await resumeEnrollment(enrollmentId, convo.merchantId, child, dedupeJobId)
}
