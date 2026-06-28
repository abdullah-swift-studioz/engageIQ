import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@engageiq/db'
import { analyticsQueue } from '@engageiq/queue'
import type { ProductRetentionRow, ProductRetentionResult } from '@engageiq/shared'

// 4.5 Product-Level Retention Analytics — read API + recompute trigger.
//
// The heavy compute lives in lib/product-analytics.service.ts (run by the analytics worker) and
// PERSISTS metrics onto Product.* columns. This route only READS those persisted columns and
// derives the composite `retentionValue` at read time (no column exists for it). The recompute
// endpoint enqueues a job rather than computing synchronously.

// ── GET /products ────────────────────────────────────────────────────────────

async function listProductsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = request.user.merchantId

  try {
    const rows = await prisma.product.findMany({
      where: { merchantId },
      select: {
        id: true,
        shopifyProductId: true,
        title: true,
        repurchaseRate90d: true,
        crossSellRate: true,
        returnRate: true,
        avgBuyerLtv: true,
        avgDaysToSecondPurchase: true,
        analyticsComputedAt: true,
      },
    })

    const products: ProductRetentionRow[] = rows.map((row) => {
      const avgBuyerLtv = row.avgBuyerLtv != null ? row.avgBuyerLtv.toString() : null
      // Composite ranking score: repurchase propensity weighted by buyer value, discounted by
      // returns. Mirrors the formula in product-analytics.service.ts; recomputed here from the
      // persisted columns so no extra column/migration is needed.
      const retentionValue =
        row.repurchaseRate90d != null && avgBuyerLtv != null
          ? row.repurchaseRate90d * Number(avgBuyerLtv) * (1 - (row.returnRate ?? 0))
          : null

      return {
        productId: row.id,
        shopifyProductId: row.shopifyProductId,
        title: row.title,
        repurchaseRate90d: row.repurchaseRate90d,
        crossSellRate: row.crossSellRate,
        returnRate: row.returnRate,
        avgBuyerLtv,
        avgDaysToSecondPurchase: row.avgDaysToSecondPurchase,
        retentionValue,
      }
    })

    // Sort by retentionValue DESC, nulls last.
    products.sort((a, b) => {
      if (a.retentionValue == null && b.retentionValue == null) return 0
      if (a.retentionValue == null) return 1
      if (b.retentionValue == null) return -1
      return b.retentionValue - a.retentionValue
    })

    // Latest computation timestamp across all products (null if none computed yet).
    let computedAtMs: number | null = null
    for (const row of rows) {
      if (row.analyticsComputedAt != null) {
        const ms = row.analyticsComputedAt.getTime()
        if (computedAtMs == null || ms > computedAtMs) computedAtMs = ms
      }
    }
    const computedAt = computedAtMs != null ? new Date(computedAtMs).toISOString() : null

    const result: ProductRetentionResult = { products, computedAt }
    await reply.send({ success: true, data: result })
  } catch (err) {
    request.log.error({ err }, 'Failed to load product retention analytics')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load product retention analytics' },
    })
  }
}

// ── POST /products/recompute ─────────────────────────────────────────────────

async function recomputeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const merchantId = request.user.merchantId

  try {
    // jobId dedupes concurrent recompute requests for the same merchant.
    // NOTE: BullMQ rejects ':' in a custom jobId, so use '-' as the separator.
    await analyticsQueue.add(
      'product-analytics',
      { type: 'product-analytics', merchantId },
      { jobId: `product-analytics-${merchantId}` },
    )
    await reply.status(202).send({ success: true, data: { enqueued: true } })
  } catch (err) {
    request.log.error({ err }, 'Failed to enqueue product analytics recompute')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to enqueue product analytics recompute' },
    })
  }
}

const productRoutes: FastifyPluginAsync = async (fastify) => {
  // Static path registered before any wildcard (paths are distinct here, kept explicit).
  fastify.post('/products/recompute', recomputeHandler)
  fastify.get('/products', listProductsHandler)
}

export default productRoutes
