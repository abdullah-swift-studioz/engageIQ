import { prisma } from '@engageiq/db'
import type { RecommendationType } from '@prisma/client'

/**
 * Read cached product recommendations for a customer (milestone 7.2).
 * Tenant-scoped: every query filters by the resolved merchantId, and the customer
 * is verified to belong to the merchant before recommendations are returned.
 * Recommendations are produced by the scoring worker (lane:ml) and cached in the
 * Recommendation table; this is a pure read.
 */
export async function getRecommendationsForCustomer(
  merchantId: string,
  customerId: string,
  type?: RecommendationType,
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, merchantId },
    select: { id: true },
  })
  if (!customer) {
    throw new Error('CUSTOMER_NOT_FOUND')
  }

  const now = new Date()
  const recs = await prisma.recommendation.findMany({
    where: {
      merchantId,
      customerId,
      ...(type ? { type } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { generatedAt: 'desc' },
  })

  return recs.map((r) => ({
    type: r.type,
    productIds: r.productIds,
    score: r.score,
    generatedAt: r.generatedAt,
    expiresAt: r.expiresAt,
  }))
}
