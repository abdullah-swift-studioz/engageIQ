// apps/api/src/workers/message-dispatch.worker.ts
//
// Consumes the message-dispatch queue (spec §4.5). For each job:
//   1. load customer (merchant-scoped)
//   2. consent gate (WhatsApp opt-in; non-WhatsApp channels are stubs → skip)
//   3. per-merchant rate limit (re-enqueue with jitter when over cap)
//   4. resolve template + substitute variables (default rule; empty-no-default → FAILED)
//   5. adapter.send(payload)
//   6. persist Message (SENT + wamid | FAILED + error). Retryable → throw (BullMQ
//      retries); permanent → UnrecoverableError + a FAILED Message row.
import { Worker, UnrecoverableError } from 'bullmq'
import { prisma } from '@engageiq/db'
import { messageDispatchQueue, redisConnection } from '@engageiq/queue'
import type { MessageDispatchJob, ChannelSendPayload } from '@engageiq/shared'
import { MESSAGE_DISPATCH } from '@engageiq/shared'
import { getAdapter } from '../lib/channels/registry.js'
import { substituteVariables } from '../lib/channels/template-variables.js'
import type { VariableMapEntry } from '../lib/channels/template-variables.js'
import { checkRateLimit, jitteredReEnqueueDelay } from '../lib/channels/rate-limit.js'

interface JobContext {
  jobId?: string
}

// Persist a terminal FAILED Message row (audit trail for the message log UI).
async function persistFailed(
  data: MessageDispatchJob,
  toPhone: string,
  errorTitle: string,
  errorCode?: string,
): Promise<void> {
  await prisma.message.create({
    data: {
      merchantId: data.merchantId,
      customerId: data.customerId,
      channel: data.channel,
      direction: 'OUTBOUND',
      ...(data.templateId !== undefined && { templateId: data.templateId }),
      status: 'FAILED',
      errorTitle,
      ...(errorCode !== undefined && { errorCode }),
      body: data.content.body,
      toPhone,
      ...(data.journeyEnrollmentId !== undefined && { journeyEnrollmentId: data.journeyEnrollmentId }),
      ...(data.campaignId !== undefined && { campaignId: data.campaignId }),
      failedAt: new Date(),
    },
  })
}

export async function processMessageDispatchJob(
  data: MessageDispatchJob,
  ctx: JobContext = {},
): Promise<void> {
  // 1. Load the customer, merchant-scoped (tenant safety).
  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, merchantId: data.merchantId },
  })
  if (!customer) {
    throw new UnrecoverableError(`Customer ${data.customerId} not found for merchant ${data.merchantId}`)
  }

  // 2. Stub channels (SMS / Email / Push) are not active yet — skip cleanly, no row.
  if (data.channel !== 'WHATSAPP') {
    console.info(
      JSON.stringify({ level: 'info', msg: '[message-dispatch] stub channel skipped', channel: data.channel, merchantId: data.merchantId }),
    )
    return
  }

  // 2b. Consent gate — never send to an opted-out customer. No Message row (a send
  // that never happened is not part of the message log); the inbound opt-out is.
  if (!customer.isSubscribedWhatsapp) {
    console.info(
      JSON.stringify({ level: 'info', msg: '[message-dispatch] consent skip', customerId: customer.id, merchantId: data.merchantId }),
    )
    return
  }

  const toPhone = customer.phone
  if (!toPhone) {
    await persistFailed(data, '', 'Customer has no phone number')
    throw new UnrecoverableError(`Customer ${customer.id} has no phone number`)
  }

  // 3. Per-merchant rate limit — over cap re-enqueues the same job with jitter.
  const allowed = await checkRateLimit(data.merchantId)
  if (!allowed) {
    await messageDispatchQueue.add(MESSAGE_DISPATCH, data, {
      delay: jitteredReEnqueueDelay(ctx.jobId),
    })
    return
  }

  // 4. Build the channel payload (template or free-form).
  let payload: ChannelSendPayload
  if (data.templateId) {
    const template = await prisma.whatsAppTemplate.findFirst({
      where: { id: data.templateId, merchantId: data.merchantId },
    })
    if (!template) {
      await persistFailed(data, toPhone, 'Template not found')
      throw new UnrecoverableError(`Template ${data.templateId} not found`)
    }
    // Business-initiated sends require an APPROVED template.
    if (template.status !== 'APPROVED') {
      await persistFailed(data, toPhone, `Template not approved (status ${template.status})`)
      throw new UnrecoverableError(`Template ${template.id} not approved`)
    }

    const result = substituteVariables(
      (template.variableMap as unknown as VariableMapEntry[]) ?? [],
      customer as unknown as Record<string, unknown>,
    )
    if (!result.ok) {
      await persistFailed(data, toPhone, `Empty template variable {{${result.missingIndex}}}`)
      throw new UnrecoverableError(`Empty template variable {{${result.missingIndex}}}`)
    }

    payload = {
      channel: 'WHATSAPP',
      toPhone,
      templateName: template.name,
      languageCode: template.language,
      category: template.category,
      variables: result.variables,
    }
  } else {
    payload = { channel: 'WHATSAPP', toPhone, freeFormText: data.content.body }
  }

  // 5. Send via the resolved adapter.
  const adapter = getAdapter('WHATSAPP')
  if (!adapter) {
    await persistFailed(data, toPhone, 'No adapter for channel WHATSAPP')
    throw new UnrecoverableError('No adapter for channel WHATSAPP')
  }
  const result = await adapter.send(payload)

  // 6. Persist the outcome.
  if (result.ok) {
    await prisma.message.create({
      data: {
        merchantId: data.merchantId,
        customerId: data.customerId,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        ...(data.templateId !== undefined && { templateId: data.templateId }),
        providerMessageId: result.providerMessageId,
        status: 'SENT',
        body: data.content.body,
        toPhone,
        ...(data.journeyEnrollmentId !== undefined && { journeyEnrollmentId: data.journeyEnrollmentId }),
        ...(data.campaignId !== undefined && { campaignId: data.campaignId }),
        sentAt: new Date(),
      },
    })
    return
  }

  // Retryable (5xx / 429 / network): throw WITHOUT a FAILED row so BullMQ retries
  // and we don't accumulate duplicate FAILED rows across attempts.
  if (result.retryable) {
    throw new Error(result.errorTitle)
  }

  // Permanent failure: record FAILED and stop retrying.
  await persistFailed(data, toPhone, result.errorTitle, result.errorCode)
  throw new UnrecoverableError(result.errorTitle)
}

export function createMessageDispatchWorker(): Worker<MessageDispatchJob> {
  return new Worker<MessageDispatchJob>(
    'message-dispatch',
    async (job) => {
      await processMessageDispatchJob(job.data, { jobId: job.id })
    },
    { connection: redisConnection, concurrency: 10 },
  )
}
