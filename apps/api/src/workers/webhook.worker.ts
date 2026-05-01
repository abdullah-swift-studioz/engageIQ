import { Worker, UnrecoverableError } from 'bullmq'
import { redisConnection } from '@engageiq/queue'
import type { ShopifyWebhookJob } from '@engageiq/shared'
import type {
  ShopifyCustomerPayload,
  ShopifyOrderPayload,
  ShopifyCheckoutPayload,
  ShopifyProductPayload,
  ShopifyInventoryPayload,
  ShopifyRefundPayload,
} from '@engageiq/shared'
import { processCustomerUpsert } from '../processors/customer.processor.js'
import { processOrder } from '../processors/order.processor.js'
import { processCheckout } from '../processors/checkout.processor.js'
import { processProductUpdate, processInventoryUpdate } from '../processors/product.processor.js'
import { processRefund } from '../processors/refund.processor.js'

export function createWebhookWorker(): Worker<ShopifyWebhookJob> {
  const worker = new Worker<ShopifyWebhookJob>(
    'webhook-ingestion',
    async (job: import('bullmq').Job<ShopifyWebhookJob>) => {
      const { topic, payload, merchantId, shopifyWebhookId } = job.data

      try {
        switch (topic) {
          case 'customers/create':
          case 'customers/update':
            await processCustomerUpsert(merchantId, payload as ShopifyCustomerPayload)
            break

          case 'orders/create':
          case 'orders/updated':
          case 'orders/paid':
            await processOrder(merchantId, payload as ShopifyOrderPayload)
            break

          case 'checkouts/create':
          case 'checkouts/update':
            await processCheckout(merchantId, payload as ShopifyCheckoutPayload)
            break

          case 'products/update':
            await processProductUpdate(merchantId, payload as ShopifyProductPayload)
            break

          case 'inventory_levels/update':
            await processInventoryUpdate(merchantId, payload as ShopifyInventoryPayload)
            break

          case 'refunds/create':
            await processRefund(merchantId, payload as ShopifyRefundPayload)
            break

          default:
            // Unknown topic — not an error, just skip
            console.warn(`[webhook-worker] Unhandled topic: ${topic} (job ${shopifyWebhookId})`)
        }
      } catch (error) {
        // Structural / type errors won't improve with retries — mark unrecoverable
        if (error instanceof TypeError || error instanceof SyntaxError) {
          throw new UnrecoverableError(
            `Malformed payload for topic ${topic} (job ${shopifyWebhookId}): ${(error as Error).message}`,
          )
        }
        throw error
      }
    },
    {
      connection: redisConnection,
      concurrency: 10,
    },
  )

  return worker
}
