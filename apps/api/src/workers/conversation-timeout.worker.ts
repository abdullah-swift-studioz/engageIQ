// apps/api/src/workers/conversation-timeout.worker.ts
//
// Fires awaiting-reply timeouts for the two-way WhatsApp engine (guide §7.2). One delayed job is
// armed per await round (see startJourneyReplyWait); when it fires we atomically expire the
// conversation (AWAITING_REPLY → EXPIRED, guarded by the deadline) and, only if we won that race,
// resume the waiting context down its timeout branch. If the customer already replied — or the wait
// re-armed with a new deadline — expireConversation returns false and this is a clean no-op.
import { Worker } from 'bullmq'
import { prisma } from '@engageiq/db'
import { redisConnection } from '@engageiq/queue'
import type { ConversationTimeoutJob } from '@engageiq/shared'
import { expireConversation } from '../lib/conversations/state.js'
import { journeyReplyTimeout } from '../lib/conversations/journey-reply.js'
import { verificationTimeout } from '../lib/conversations/verification.js'

export async function processConversationTimeoutJob(data: ConversationTimeoutJob): Promise<void> {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: data.conversationId },
  })
  if (!convo) return

  const won = await expireConversation(convo.id, data.awaitingReplyUntilMs)

  // Recovery: if a prior attempt won the expire but crashed before resuming (state is already EXPIRED for
  // exactly this deadline), drive the resume again. The resume is idempotent (journeyReplyTimeout uses a
  // deterministic dedupe jobId), so this cannot double-fire the branch. If neither won nor already-expired,
  // the reply resolved it first or the wait re-armed with a new deadline — a clean no-op.
  const alreadyExpiredForThisDeadline =
    !won &&
    convo.state === 'EXPIRED' &&
    convo.awaitingReplyUntil?.getTime() === data.awaitingReplyUntilMs
  if (!won && !alreadyExpiredForThisDeadline) return

  if (convo.contextType === 'journey_reply') {
    await journeyReplyTimeout(convo)
  } else if (convo.contextType === 'verification') {
    await verificationTimeout(convo)
  }
}

export function createConversationTimeoutWorker(): Worker<ConversationTimeoutJob> {
  return new Worker<ConversationTimeoutJob>(
    'conversation-timeout',
    async (job) => {
      await processConversationTimeoutJob(job.data)
    },
    { connection: redisConnection, concurrency: 10 },
  )
}
