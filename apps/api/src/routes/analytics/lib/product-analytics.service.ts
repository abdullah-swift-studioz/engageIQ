// Product-level retention analytics (roadmap 4.5).
//
// Computes per-product retention metrics from Postgres orders and persists them onto the
// Product.* columns (these columns are this lane's to write — they are NOT the ML score
// columns). Idempotent: each run recomputes every metric from source orders, so re-running
// is safe and converges to the same result.
//
// Order.lineItems is Json: [{ product_id, variant_id, title, quantity, price, sku }].
// `product_id` is the Shopify product id, matching Product.shopifyProductId.
// Order.returnsData is Json: [{ product_id, line_item_id, quantity, subtotal }] (may be
// absent until the refund processor populates it — returnRate stays null in that case).

import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'

interface LineItem {
  product_id?: string | number
  quantity?: number
}

interface ReturnItem {
  product_id?: string | number
  quantity?: number
}

const DAY_MS = 86_400_000

function asLineItems(value: Prisma.JsonValue | null): LineItem[] {
  if (!Array.isArray(value)) return []
  return value as unknown as LineItem[]
}

function asReturnItems(value: Prisma.JsonValue | null): ReturnItem[] {
  if (!Array.isArray(value)) return []
  return value as unknown as ReturnItem[]
}

export interface ProductAnalyticsSummary {
  merchantId: string
  productsUpdated: number
  ordersScanned: number
}

/**
 * Recompute product retention metrics for one merchant and persist to Product rows.
 * Returns a summary for logging.
 */
export async function computeProductAnalytics(merchantId: string): Promise<ProductAnalyticsSummary> {
  const [products, orders] = await Promise.all([
    prisma.product.findMany({
      where: { merchantId },
      select: { id: true, shopifyProductId: true },
    }),
    prisma.order.findMany({
      where: { merchantId, customerId: { not: null }, cancelledAt: null },
      select: { customerId: true, placedAt: true, lineItems: true, returnsData: true },
      orderBy: { placedAt: 'asc' },
    }),
  ])

  if (products.length === 0) {
    return { merchantId, productsUpdated: 0, ordersScanned: orders.length }
  }

  // customerId -> set of all shopify product ids they ever bought (for cross-sell).
  const customerProducts = new Map<string, Set<string>>()
  // shopifyProductId -> customerId -> sorted list of purchase timestamps (ms).
  const productBuyerTimes = new Map<string, Map<string, number[]>>()
  // shopifyProductId -> { soldUnits, returnedUnits }
  const productUnits = new Map<string, { sold: number; returned: number }>()

  for (const order of orders) {
    const customerId = order.customerId
    if (!customerId) continue
    const placedMs = order.placedAt.getTime()

    let custSet = customerProducts.get(customerId)
    if (!custSet) {
      custSet = new Set<string>()
      customerProducts.set(customerId, custSet)
    }

    for (const li of asLineItems(order.lineItems)) {
      if (li.product_id == null) continue
      const pid = String(li.product_id)
      const qty = typeof li.quantity === 'number' && li.quantity > 0 ? li.quantity : 1
      custSet.add(pid)

      let buyerMap = productBuyerTimes.get(pid)
      if (!buyerMap) {
        buyerMap = new Map<string, number[]>()
        productBuyerTimes.set(pid, buyerMap)
      }
      const times = buyerMap.get(customerId)
      if (times) times.push(placedMs)
      else buyerMap.set(customerId, [placedMs])

      const units = productUnits.get(pid) ?? { sold: 0, returned: 0 }
      units.sold += qty
      productUnits.set(pid, units)
    }

    for (const ri of asReturnItems(order.returnsData)) {
      if (ri.product_id == null) continue
      const pid = String(ri.product_id)
      const qty = typeof ri.quantity === 'number' && ri.quantity > 0 ? ri.quantity : 0
      const units = productUnits.get(pid) ?? { sold: 0, returned: 0 }
      units.returned += qty
      productUnits.set(pid, units)
    }
  }

  // Customer LTV (totalSpent) for buyers, used by avgBuyerLtv.
  const allBuyerIds = new Set<string>(customerProducts.keys())

  const buyerLtvRows = await prisma.customer.findMany({
    where: { merchantId, id: { in: Array.from(allBuyerIds) } },
    select: { id: true, totalSpent: true },
  })
  const ltvByCustomer = new Map<string, number>()
  for (const row of buyerLtvRows) ltvByCustomer.set(row.id, Number(row.totalSpent))

  let productsUpdated = 0
  const now = new Date()

  for (const product of products) {
    const pid = product.shopifyProductId
    const buyerMap = productBuyerTimes.get(pid)
    const units = productUnits.get(pid)

    if (!buyerMap || buyerMap.size === 0) {
      // No buyers — clear metrics to null (except returnRate from units if any).
      const returnRate =
        units && units.sold > 0 ? Math.min(1, units.returned / units.sold) : null
      await prisma.product.update({
        where: { id: product.id },
        data: {
          repurchaseRate90d: null,
          crossSellRate: null,
          returnRate,
          avgBuyerLtv: null,
          avgDaysToSecondPurchase: null,
          analyticsComputedAt: now,
        },
      })
      productsUpdated++
      continue
    }

    const buyerCount = buyerMap.size
    let repurchasers90d = 0
    let crossSellers = 0
    let secondPurchaseDaysSum = 0
    let secondPurchaseCount = 0
    let ltvSum = 0
    let ltvCount = 0

    for (const [customerId, times] of buyerMap) {
      times.sort((a, b) => a - b)
      const first = times[0]!

      // repurchase within 90 days of first purchase of THIS product
      if (times.length > 1) {
        const second = times[1]!
        if (second - first <= 90 * DAY_MS) repurchasers90d++
        secondPurchaseDaysSum += (second - first) / DAY_MS
        secondPurchaseCount++
      }

      // cross-sell: bought any OTHER product
      const productsBought = customerProducts.get(customerId)
      if (productsBought && productsBought.size > 1) crossSellers++

      const ltv = ltvByCustomer.get(customerId)
      if (ltv != null) {
        ltvSum += ltv
        ltvCount++
      }
    }

    const repurchaseRate90d = repurchasers90d / buyerCount
    const crossSellRate = crossSellers / buyerCount
    const avgBuyerLtv = ltvCount > 0 ? ltvSum / ltvCount : null
    const avgDaysToSecondPurchase =
      secondPurchaseCount > 0 ? secondPurchaseDaysSum / secondPurchaseCount : null
    const returnRate = units && units.sold > 0 ? Math.min(1, units.returned / units.sold) : null

    // Composite "retention value": repurchase propensity weighted by buyer value,
    // discounted by returns. Higher = more worth retaining buyers of this product.
    const retentionValue =
      avgBuyerLtv != null
        ? repurchaseRate90d * avgBuyerLtv * (1 - (returnRate ?? 0))
        : null

    await prisma.product.update({
      where: { id: product.id },
      data: {
        repurchaseRate90d,
        crossSellRate,
        returnRate,
        avgBuyerLtv: avgBuyerLtv != null ? new Prisma.Decimal(avgBuyerLtv.toFixed(2)) : null,
        avgDaysToSecondPurchase,
        analyticsComputedAt: now,
      },
    })
    productsUpdated++
    // retentionValue is derived at read time from persisted columns; we keep it out of the
    // schema (no column) and recompute in the product route to avoid a migration.
    void retentionValue
  }

  return { merchantId, productsUpdated, ordersScanned: orders.length }
}
