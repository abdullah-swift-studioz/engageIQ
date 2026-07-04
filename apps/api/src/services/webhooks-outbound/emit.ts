import { prisma } from '@engageiq/db'
import { webhookDeliveryQueue } from '@engageiq/queue'
import type { WebhookDeliveryJob } from '@engageiq/shared'
import { WEBHOOK_DELIVERY } from '@engageiq/shared'

/**
 * Fan an event out to all of a merchant's active outbound webhooks subscribed to it.
 *
 * For each matching webhook we create a WebhookDelivery row (the durable audit log)
 * and enqueue one delivery job. The actual HTTP POST + HMAC signing + retry happens
 * in the webhook-delivery worker.
 *
 * This is fire-and-forget by design: it is called from inside other lanes' hot paths
 * (segment evaluation, campaign completion, scoring). It NEVER throws into the caller —
 * a webhook failure must not break the business operation that triggered it.
 *
 * Tenant safety: every query and every created row is scoped by merchantId.
 */
export async function emitOutboundEvent(
  merchantId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  try {
    const webhooks = await prisma.outboundWebhook.findMany({
      where: {
        merchantId,
        isActive: true,
        events: { has: event },
      },
      select: { id: true },
    })

    if (webhooks.length === 0) return

    await Promise.all(
      webhooks.map(async (webhook) => {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            merchantId,
            webhookId: webhook.id,
            event,
            payload: payload as never,
          },
          select: { id: true },
        })

        const job: WebhookDeliveryJob = {
          type: 'deliver',
          merchantId,
          webhookId: webhook.id,
          event,
          payload,
          deliveryId: delivery.id,
        }
        // jobId ties the BullMQ job to the delivery row → dedupes accidental double-enqueue.
        await webhookDeliveryQueue.add(WEBHOOK_DELIVERY, job, { jobId: `whd_${delivery.id}` })
      }),
    )
  } catch (err) {
    // Swallow — see the contract above. Log for observability.
    // eslint-disable-next-line no-console
    console.error('[webhooks-outbound] emitOutboundEvent failed', { merchantId, event, err })
  }
}
