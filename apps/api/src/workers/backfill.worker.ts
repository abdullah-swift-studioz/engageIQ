import { Worker } from 'bullmq'
import { prisma } from '@engageiq/db'
import { redisConnection } from '@engageiq/queue'
import type { BackfillJobData } from '@engageiq/shared'
import { processCustomerUpsert } from '../processors/customer.processor.js'
import { processOrderUpsert, recalculateCustomerAggregates } from '../processors/order.processor.js'
import {
  fetchCustomerCount,
  fetchOrderCount,
  fetchAllCustomers,
  fetchAllOrders,
} from '../services/shopify-admin.service.js'

const PROGRESS_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

// Store structured progress in a Redis hash
async function setProgress(
  merchantId: string,
  fields: Record<string, string | number>,
): Promise<void> {
  const key = progressKey(merchantId)
  const flat: (string | number)[] = []
  for (const [k, v] of Object.entries(fields)) {
    flat.push(k, String(v))
  }
  await redisConnection.hset(key, ...flat)
  await redisConnection.expire(key, PROGRESS_TTL_SECONDS)
}

function progressKey(merchantId: string): string {
  return `backfill:progress:${merchantId}`
}

// 30% weight for customers, 70% for orders — orders are the bulk of work
function calcPercent(
  customersDone: number,
  customersTotal: number,
  ordersDone: number,
  ordersTotal: number,
  status: string,
): number {
  if (status === 'completed') return 100
  if (status === 'recalculating') return 95
  const customerPct = customersTotal > 0 ? customersDone / customersTotal : 0
  const orderPct = ordersTotal > 0 ? ordersDone / ordersTotal : 0
  return Math.min(94, Math.round(customerPct * 30 + orderPct * 65))
}

export function createBackfillWorker(): Worker<BackfillJobData> {
  const worker = new Worker<BackfillJobData>(
    'backfill',
    async (job) => {
      const { merchantId } = job.data

      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: {
          id: true,
          shopifyDomain: true,
          shopifyAccessToken: true,
          backfillCompletedAt: true,
        },
      })

      if (!merchant?.shopifyDomain || !merchant.shopifyAccessToken) {
        throw new Error(`Merchant ${merchantId} missing Shopify credentials — cannot backfill`)
      }

      // Idempotency: if already completed, skip
      if (merchant.backfillCompletedAt) {
        console.info(`[backfill] ${merchantId} already completed at ${merchant.backfillCompletedAt.toISOString()}, skipping`)
        return
      }

      const { shopifyDomain: shop, shopifyAccessToken: accessToken } = merchant

      // 2-year lookback window
      const createdAtMin = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString()

      await setProgress(merchantId, {
        status: 'running_customers',
        customersTotal: 0,
        customersDone: 0,
        ordersTotal: 0,
        ordersDone: 0,
        startedAt: new Date().toISOString(),
        completedAt: '',
        error: '',
      })

      try {
        // ── Phase 1: Customers ───────────────────────────────────────────────
        const customersTotal = await fetchCustomerCount(shop, accessToken)
        await setProgress(merchantId, { customersTotal })

        let customersDone = 0

        await fetchAllCustomers(shop, accessToken, async (page) => {
          for (const customer of page) {
            await processCustomerUpsert(merchantId, customer)
            customersDone++
          }
          await setProgress(merchantId, { customersDone })
          job.updateProgress(calcPercent(customersDone, customersTotal, 0, 0, 'running_customers'))
        })

        // ── Phase 2: Orders ──────────────────────────────────────────────────
        await setProgress(merchantId, { status: 'running_orders' })

        const ordersTotal = await fetchOrderCount(shop, accessToken, createdAtMin)
        await setProgress(merchantId, { ordersTotal })

        let ordersDone = 0
        const affectedCustomerIds = new Set<string>()

        await fetchAllOrders(shop, accessToken, createdAtMin, async (page) => {
          for (const order of page) {
            // Upsert customer embedded in order payload
            let customerId: string | null = null
            if (order.customer) {
              customerId = await processCustomerUpsert(merchantId, {
                id: order.customer.id,
                email: order.customer.email ?? null,
                phone: order.customer.phone ?? null,
                first_name: order.customer.first_name ?? null,
                last_name: order.customer.last_name ?? null,
                default_address: order.customer.default_address,
                tags: order.customer.tags ?? '',
                accepts_marketing: order.customer.accepts_marketing ?? false,
                created_at: order.created_at,
                updated_at: order.updated_at,
              })
              affectedCustomerIds.add(customerId)
            }

            await processOrderUpsert(merchantId, order, customerId)
            ordersDone++
          }

          await setProgress(merchantId, { ordersDone })
          job.updateProgress(
            calcPercent(customersDone, customersTotal, ordersDone, ordersTotal, 'running_orders'),
          )
        })

        // ── Phase 3: Batch aggregate recalculation ───────────────────────────
        await setProgress(merchantId, { status: 'recalculating' })

        for (const customerId of affectedCustomerIds) {
          await recalculateCustomerAggregates(merchantId, customerId)
        }

        // ── Done ─────────────────────────────────────────────────────────────
        const completedAt = new Date()

        await prisma.merchant.update({
          where: { id: merchantId },
          data: { backfillCompletedAt: completedAt },
        })

        await setProgress(merchantId, {
          status: 'completed',
          completedAt: completedAt.toISOString(),
        })

        job.updateProgress(100)

        console.info(
          `[backfill] Completed for merchant ${merchantId} — ` +
          `${customersDone} customers, ${ordersDone} orders, ` +
          `${affectedCustomerIds.size} aggregates recalculated`,
        )
      } catch (err) {
        const message = (err as Error).message
        await setProgress(merchantId, { status: 'failed', error: message })
        throw err
      }
    },
    {
      connection: redisConnection,
      concurrency: 2,
    },
  )

  return worker
}

export function getBackfillProgressKey(merchantId: string): string {
  return progressKey(merchantId)
}
