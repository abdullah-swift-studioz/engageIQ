import { Worker, UnrecoverableError, Queue } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { redisConnection } from '@engageiq/queue'
import { prisma } from '@engageiq/db'
import { MESSAGE_DISPATCH } from '@engageiq/shared'
import type { CampaignSendJob, MessageDispatchJob, ChannelName } from '@engageiq/shared'

// ─── Dispatch seam (Lane A <-> Lane B contract) ──────────────────────────────
//
// The campaign-send worker fans out one MessageDispatchJob per eligible recipient
// onto the frozen MESSAGE_DISPATCH queue. Lane A owns that queue's *consumer* (the
// message-dispatch worker that calls the ChannelAdapter and persists Message rows).
// Here we are only a *producer* of that queue. The dispatch function is injectable
// so unit tests pass a mock and never touch Redis; the default below is a thin
// producer bound to the frozen queue name. At integration the integrator may swap
// this default for Lane A's exported `messageDispatchQueue` handle — behaviour is
// identical because BullMQ matches the queue by its string name.

export type DispatchMessageFn = (
  job: MessageDispatchJob,
  opts?: { jobId?: string },
) => Promise<void>

let _messageDispatchQueue: Queue | null = null
function messageDispatchQueue(): Queue {
  if (!_messageDispatchQueue) {
    _messageDispatchQueue = new Queue(MESSAGE_DISPATCH, { connection: redisConnection })
  }
  return _messageDispatchQueue
}

export const defaultDispatch: DispatchMessageFn = async (job, opts) => {
  await messageDispatchQueue().add('send', job, opts?.jobId ? { jobId: opts.jobId } : undefined)
}

export interface CampaignSendDeps {
  dispatch: DispatchMessageFn
}

// Statuses from which the worker will proceed. Anything else (SENT, CANCELLED,
// PAUSED, DRAFT) is treated as a no-op so a stray/duplicate job never re-sends.
const PROCESSABLE_STATUSES = new Set(['SCHEDULED', 'SENDING'])

// Per-channel eligibility: the recipient must be opted in to the channel and have
// the contact field that channel needs. PUSH has no suppression flag/contact gate.
function channelEligibilityWhere(channel: ChannelName): Prisma.CustomerWhereInput {
  switch (channel) {
    case 'WHATSAPP':
      return { isSubscribedWhatsapp: true, phone: { not: null } }
    case 'SMS':
      return { isSubscribedSms: true, phone: { not: null } }
    case 'EMAIL':
      return { isSubscribedEmail: true, email: { not: null } }
    case 'PUSH':
      return {}
  }
}

export interface CampaignSendOutcome {
  campaignId: string
  recipientCount: number
  dispatched: number
  skipped: boolean
}

/**
 * Process one campaign-send job: materialize recipients from the campaign's target
 * segment, suppress un-subscribed/blocked customers, fan out a MessageDispatchJob per
 * eligible recipient, and mark the campaign SENT. Idempotent — safe to re-run:
 *  - CampaignRecipient rows are created with skipDuplicates (unique campaignId+customerId),
 *  - only PENDING recipients are (re-)dispatched,
 *  - each dispatch carries jobId `cr_<recipientId>` so the message-dispatch queue dedupes.
 */
export async function processCampaignSendJob(
  data: CampaignSendJob,
  deps: CampaignSendDeps = { dispatch: defaultDispatch },
): Promise<CampaignSendOutcome> {
  const { campaignId, merchantId } = data

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, merchantId },
  })
  if (!campaign) {
    throw new UnrecoverableError(`Campaign ${campaignId} not found for merchant ${merchantId}`)
  }

  if (!PROCESSABLE_STATUSES.has(campaign.status)) {
    // Cancelled/sent/paused before the job ran — do nothing.
    return { campaignId, recipientCount: 0, dispatched: 0, skipped: true }
  }

  if (!campaign.segmentId) {
    throw new UnrecoverableError(`Campaign ${campaignId} has no target segment`)
  }

  const content = campaign.content as { body?: string } | null
  if (!content?.body) {
    throw new UnrecoverableError(`Campaign ${campaignId} has no message body`)
  }
  const channel = campaign.channel as ChannelName
  const messageContent = {
    body: content.body,
    ...(campaign.subject ? { subject: campaign.subject } : {}),
  }

  // Mark SENDING (idempotent: no-op if already SENDING).
  if (campaign.status !== 'SENDING') {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SENDING' },
    })
  }

  // Eligible = active member of the target segment, not merged, not blocked, opted in.
  const eligible = await prisma.customer.findMany({
    where: {
      merchantId,
      mergedIntoId: null,
      isBlocked: false,
      segmentMemberships: { some: { segmentId: campaign.segmentId, exitedAt: null } },
      ...channelEligibilityWhere(channel),
    },
    select: { id: true },
  })

  if (eligible.length > 0) {
    await prisma.campaignRecipient.createMany({
      data: eligible.map((c) => ({ merchantId, campaignId, customerId: c.id })),
      skipDuplicates: true,
    })
  }

  // Fan out dispatch only for recipients not yet handed off (Lane A flips PENDING -> SENT).
  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, merchantId, status: 'PENDING' },
    select: { id: true, customerId: true },
  })

  for (const recipient of pending) {
    const dispatchJob: MessageDispatchJob = {
      type: 'send',
      channel,
      merchantId,
      customerId: recipient.customerId,
      content: messageContent,
      campaignId,
      campaignRecipientId: recipient.id,
    }
    await deps.dispatch(dispatchJob, { jobId: `cr_${recipient.id}` })
  }

  const recipientCount = await prisma.campaignRecipient.count({
    where: { campaignId, merchantId },
  })

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'SENT', sentAt: new Date(), recipientCount },
  })

  return { campaignId, recipientCount, dispatched: pending.length, skipped: false }
}

export function createCampaignSendWorker(deps?: CampaignSendDeps): Worker<CampaignSendJob> {
  return new Worker<CampaignSendJob>(
    'campaign-send',
    async (job) => processCampaignSendJob(job.data, deps),
    {
      connection: redisConnection,
      concurrency: 3,
    },
  )
}
