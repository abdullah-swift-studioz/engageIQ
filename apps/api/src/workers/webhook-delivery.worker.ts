import { Worker, UnrecoverableError } from 'bullmq'
import type { Job } from 'bullmq'
import { redisConnection } from '@engageiq/queue'
import { prisma } from '@engageiq/db'
import type { WebhookDeliveryJob } from '@engageiq/shared'
import { env } from '@engageiq/shared'
import { decryptSecret, signPayload } from '../services/webhooks-outbound/crypto.js'

/** The signed body EngageIQ POSTs to a merchant endpoint. */
interface WebhookRequestBody {
  id: string
  event: string
  createdAt: string
  data: unknown
}

/** Approximate the next BullMQ retry time (exponential backoff, 5s base) for the log row. */
function computeNextRetryAt(attemptsMade: number, maxAttempts: number): Date | null {
  if (attemptsMade >= maxAttempts) return null
  const delayMs = 5000 * Math.pow(2, attemptsMade)
  return new Date(Date.now() + delayMs)
}

export async function processWebhookDeliveryJob(job: Job<WebhookDeliveryJob>): Promise<void> {
  const { merchantId, webhookId, event, payload } = job.data
  let { deliveryId } = job.data

  const webhook = await prisma.outboundWebhook.findFirst({
    where: { id: webhookId, merchantId },
    select: { id: true, url: true, secret: true, isActive: true },
  })

  // Webhook was deleted or deactivated after the job was enqueued → stop, don't retry.
  if (!webhook || !webhook.isActive) {
    if (deliveryId) {
      await prisma.webhookDelivery.updateMany({
        where: { id: deliveryId, merchantId },
        data: { success: false, error: 'Webhook no longer active', attempts: { increment: 1 } },
      })
    }
    throw new UnrecoverableError(`Outbound webhook ${webhookId} not deliverable for merchant ${merchantId}`)
  }

  // Ensure a delivery log row exists (emit always creates one, but be defensive).
  if (!deliveryId) {
    const created = await prisma.webhookDelivery.create({
      data: { merchantId, webhookId, event, payload: payload as never },
      select: { id: true },
    })
    deliveryId = created.id
  }

  const deliveryRow = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, merchantId },
    select: { createdAt: true },
  })

  const body: WebhookRequestBody = {
    id: deliveryId,
    event,
    createdAt: (deliveryRow?.createdAt ?? new Date()).toISOString(),
    data: payload,
  }
  const rawBody = JSON.stringify(body)

  let secret: string
  try {
    secret = decryptSecret(webhook.secret)
  } catch {
    await prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, merchantId },
      data: { success: false, error: 'Unable to decrypt signing secret', attempts: { increment: 1 } },
    })
    throw new UnrecoverableError(`Cannot decrypt secret for webhook ${webhookId}`)
  }
  const signature = signPayload(secret, rawBody)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.WEBHOOK_DELIVERY_TIMEOUT_MS)

  let statusCode: number | null = null
  let errorMessage: string | null = null
  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EngageIQ-Webhooks/1.0',
        'X-EngageIQ-Event': event,
        'X-EngageIQ-Delivery': deliveryId,
        'X-EngageIQ-Signature': `sha256=${signature}`,
      },
      body: rawBody,
      signal: controller.signal,
    })
    statusCode = res.status
    if (!res.ok) errorMessage = `Endpoint responded ${res.status}`
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Request failed'
  } finally {
    clearTimeout(timeout)
  }

  const success = statusCode !== null && statusCode >= 200 && statusCode < 300
  // job.attemptsMade is 0-based during the current attempt; +1 = attempts made after this one.
  const attemptsMade = (job.attemptsMade ?? 0) + 1
  const maxAttempts = job.opts.attempts ?? 1

  await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, merchantId },
    data: {
      statusCode,
      success,
      error: success ? null : errorMessage,
      attempts: { increment: 1 },
      deliveredAt: success ? new Date() : null,
      nextRetryAt: success ? null : computeNextRetryAt(attemptsMade, maxAttempts),
    },
  })

  // Throw so BullMQ retries with backoff. On the final attempt the throw just marks the
  // job failed; the delivery row already records the terminal state.
  if (!success) {
    throw new Error(errorMessage ?? `Webhook delivery failed for ${webhookId}`)
  }
}

export function createWebhookDeliveryWorker(): Worker<WebhookDeliveryJob> {
  return new Worker<WebhookDeliveryJob>('webhook-delivery', processWebhookDeliveryJob, {
    connection: redisConnection,
    concurrency: 10,
  })
}
