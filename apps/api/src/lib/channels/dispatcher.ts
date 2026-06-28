// apps/api/src/lib/channels/dispatcher.ts
//
// Thin enqueue onto the message-dispatch queue. Signature is UNCHANGED from the
// Phase 4.2 stub (channel, customerId, content, merchantId) so the journey ACTION
// caller and its tests are untouched. The actual send happens async in
// message-dispatch.worker.ts via the resolved ChannelAdapter (spec §4.3).
import { messageDispatchQueue } from '@engageiq/queue'
import { MESSAGE_DISPATCH } from '@engageiq/shared'
import type { ActionStepConfig, MessageDispatchJob } from '@engageiq/shared'

export interface DispatchOptions {
  templateId?: string
  journeyEnrollmentId?: string
  campaignId?: string
  campaignRecipientId?: string
}

export async function dispatchChannel(
  channel: ActionStepConfig['channel'],
  customerId: string,
  content: ActionStepConfig['content'],
  merchantId: string,
  options: DispatchOptions = {},
): Promise<void> {
  const job: MessageDispatchJob = {
    type: 'send',
    channel,
    merchantId,
    customerId,
    content,
    ...(options.templateId !== undefined && { templateId: options.templateId }),
    ...(options.journeyEnrollmentId !== undefined && {
      journeyEnrollmentId: options.journeyEnrollmentId,
    }),
    ...(options.campaignId !== undefined && { campaignId: options.campaignId }),
    ...(options.campaignRecipientId !== undefined && {
      campaignRecipientId: options.campaignRecipientId,
    }),
  }

  await messageDispatchQueue.add(MESSAGE_DISPATCH, job)
}
