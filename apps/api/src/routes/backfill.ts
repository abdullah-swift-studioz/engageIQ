import type { FastifyInstance } from 'fastify'
import { prisma } from '@engageiq/db'
import { redisConnection } from '@engageiq/queue'
import type { BackfillProgress, BackfillStatus } from '@engageiq/shared'
import { getBackfillProgressKey } from '../workers/backfill.worker.js'
import { backfillQueue } from '@engageiq/queue'

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

async function backfillRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /backfill/status
  // Returns the live backfill progress for the authenticated merchant.
  fastify.get('/status', {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      const { merchantId } = request.user

      const key = getBackfillProgressKey(merchantId)
      const raw = await redisConnection.hgetall(key)

      if (raw && Object.keys(raw).length > 0) {
        const customersDone = parseInt(raw.customersDone ?? '0', 10)
        const customersTotal = parseInt(raw.customersTotal ?? '0', 10)
        const ordersDone = parseInt(raw.ordersDone ?? '0', 10)
        const ordersTotal = parseInt(raw.ordersTotal ?? '0', 10)
        const status = (raw.status ?? 'pending') as BackfillStatus

        const progress: BackfillProgress = {
          status,
          customersTotal,
          customersDone,
          ordersTotal,
          ordersDone,
          percentComplete: calcPercent(customersDone, customersTotal, ordersDone, ordersTotal, status),
          startedAt: raw.startedAt ?? '',
          completedAt: raw.completedAt || null,
          error: raw.error || null,
        }

        return reply.send({ data: progress })
      }

      // No Redis key — check the DB for a completed merchant
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { backfillCompletedAt: true, shopifyInstalledAt: true },
      })

      if (merchant?.backfillCompletedAt) {
        const progress: BackfillProgress = {
          status: 'completed',
          customersTotal: 0,
          customersDone: 0,
          ordersTotal: 0,
          ordersDone: 0,
          percentComplete: 100,
          startedAt: merchant.shopifyInstalledAt?.toISOString() ?? '',
          completedAt: merchant.backfillCompletedAt.toISOString(),
          error: null,
        }
        return reply.send({ data: progress })
      }

      if (!merchant?.shopifyInstalledAt) {
        return reply.status(404).send({ error: 'No Shopify store connected for this merchant' })
      }

      // Store is connected but backfill has not started yet
      const progress: BackfillProgress = {
        status: 'pending',
        customersTotal: 0,
        customersDone: 0,
        ordersTotal: 0,
        ordersDone: 0,
        percentComplete: 0,
        startedAt: '',
        completedAt: null,
        error: null,
      }
      return reply.send({ data: progress })
    },
  })

  // POST /backfill/trigger
  // Manually (re-)trigger a backfill. Requires OWNER or ADMIN role.
  // Useful for re-running after a failed attempt or for testing.
  fastify.post('/trigger', {
    preHandler: fastify.requireRole(['OWNER', 'ADMIN']),
    handler: async (request, reply) => {
      const { merchantId } = request.user

      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { id: true, shopifyDomain: true, shopifyAccessToken: true },
      })

      if (!merchant?.shopifyDomain || !merchant.shopifyAccessToken) {
        return reply.status(422).send({ error: 'No Shopify store connected — cannot trigger backfill' })
      }

      // Reset completion flag so the worker doesn't skip
      await prisma.merchant.update({
        where: { id: merchantId },
        data: { backfillCompletedAt: null },
      })

      // Remove any stale progress key
      await redisConnection.del(getBackfillProgressKey(merchantId))

      // Enqueue; jobId = merchantId prevents duplicate jobs in the queue
      await backfillQueue.add('backfill', { merchantId }, { jobId: merchantId })

      return reply.status(202).send({ ok: true, message: 'Backfill job enqueued' })
    },
  })
}

export default backfillRoutes
