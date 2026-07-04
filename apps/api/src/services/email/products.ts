// apps/api/src/services/email/products.ts
//
// Resolves the live product list for a dynamic-product block at send time (guide 7.3:
// "update automatically at send time"). Reads the Postgres Product catalog (never
// ClickHouse for catalog data). "viewed" additionally reads recent product_view events
// from ClickHouse and falls back to top sellers when the customer has no view history.
//
// Every path is defensive: a resolution failure returns [] (the block renders nothing)
// rather than throwing, so a catalog/analytics hiccup never fails an email send.

import { prisma } from '@engageiq/db'
import { queryEvents } from '@engageiq/db'
import type { Prisma } from '@prisma/client'
import type { EmailDynamicProductBlock, EmailRenderProduct } from '@engageiq/shared'

type ProductRow = Prisma.ProductGetPayload<{
  select: {
    id: true
    shopifyProductId: true
    title: true
    handle: true
    imageUrl: true
    priceMin: true
  }
}>

const PRODUCT_SELECT = {
  id: true,
  shopifyProductId: true,
  title: true,
  handle: true,
  imageUrl: true,
  priceMin: true,
} as const

function formatPrice(value: Prisma.Decimal | null, currency: string): string | null {
  if (value === null) return null
  const n = Number(value)
  if (Number.isNaN(n)) return null
  return `${currency} ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function toRender(p: ProductRow, currency: string, storefrontBase: string | null): EmailRenderProduct {
  const url = storefrontBase && p.handle ? `${storefrontBase}/products/${p.handle}` : null
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    imageUrl: p.imageUrl,
    price: formatPrice(p.priceMin, currency),
    url,
  }
}

// Preserve the order of `ids` when mapping a bag of rows keyed by one of its fields.
function orderBy<T>(ids: string[], rows: T[], key: (r: T) => string): T[] {
  const byKey = new Map(rows.map((r) => [key(r), r]))
  const out: T[] = []
  for (const id of ids) {
    const r = byKey.get(id)
    if (r) out.push(r)
  }
  return out
}

export interface ResolveProductsDeps {
  merchantId: string
  customerId: string | null
  currency: string
  storefrontBase: string | null
}

// Merchant best-sellers. Until the analytics engine (Lane C) populates ranking columns,
// this ranks active, image-bearing products by repurchase signal then recency — a stable
// placeholder that becomes accurate once analyticsComputedAt fills.
async function topSellers(deps: ResolveProductsDeps, limit: number): Promise<EmailRenderProduct[]> {
  const rows = await prisma.product.findMany({
    where: { merchantId: deps.merchantId, status: 'active' },
    select: PRODUCT_SELECT,
    orderBy: [{ repurchaseRate90d: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: limit,
  })
  return rows.map((r) => toRender(r, deps.currency, deps.storefrontBase))
}

// Products from the customer's Recommendation cache (Lane D). productIds are Shopify ids.
async function recommended(deps: ResolveProductsDeps, limit: number): Promise<EmailRenderProduct[]> {
  if (!deps.customerId) return topSellers(deps, limit)
  const rec = await prisma.recommendation.findFirst({
    where: { merchantId: deps.merchantId, customerId: deps.customerId },
    orderBy: { generatedAt: 'desc' },
    select: { productIds: true },
  })
  const shopifyIds = (rec?.productIds ?? []).slice(0, limit)
  if (shopifyIds.length === 0) return topSellers(deps, limit)
  const rows = await prisma.product.findMany({
    where: { merchantId: deps.merchantId, shopifyProductId: { in: shopifyIds } },
    select: PRODUCT_SELECT,
  })
  const ordered = orderBy(shopifyIds, rows, (r) => r.shopifyProductId)
  const out = ordered.map((r) => toRender(r, deps.currency, deps.storefrontBase))
  return out.length > 0 ? out : topSellers(deps, limit)
}

// Recently viewed products from ClickHouse product_view events; falls back to top sellers.
async function viewed(deps: ResolveProductsDeps, limit: number): Promise<EmailRenderProduct[]> {
  if (!deps.customerId) return topSellers(deps, limit)
  try {
    const events = await queryEvents(deps.merchantId, {
      customerId: deps.customerId,
      eventType: 'product_view',
      limit: 50,
    })
    const seen = new Set<string>()
    const shopifyIds: string[] = []
    for (const e of events) {
      const pid = e.properties?.product_id
      if (typeof pid === 'string' && !seen.has(pid)) {
        seen.add(pid)
        shopifyIds.push(pid)
      }
      if (shopifyIds.length >= limit) break
    }
    if (shopifyIds.length === 0) return topSellers(deps, limit)
    const rows = await prisma.product.findMany({
      where: { merchantId: deps.merchantId, shopifyProductId: { in: shopifyIds } },
      select: PRODUCT_SELECT,
    })
    const out = orderBy(shopifyIds, rows, (r) => r.shopifyProductId).map((r) =>
      toRender(r, deps.currency, deps.storefrontBase),
    )
    return out.length > 0 ? out : topSellers(deps, limit)
  } catch {
    // ClickHouse unavailable → don't fail the send; show best-sellers instead.
    return topSellers(deps, limit)
  }
}

// Explicit merchant-picked products (Product.id list from the builder).
async function manual(deps: ResolveProductsDeps, block: EmailDynamicProductBlock): Promise<EmailRenderProduct[]> {
  const ids = (block.productIds ?? []).slice(0, block.limit)
  if (ids.length === 0) return []
  const rows = await prisma.product.findMany({
    where: { merchantId: deps.merchantId, id: { in: ids } },
    select: PRODUCT_SELECT,
  })
  return orderBy(ids, rows, (r) => r.id).map((r) => toRender(r, deps.currency, deps.storefrontBase))
}

export async function resolveBlockProducts(
  deps: ResolveProductsDeps,
  block: EmailDynamicProductBlock,
): Promise<EmailRenderProduct[]> {
  const limit = Math.max(1, Math.min(block.limit, 12))
  const bounded = { ...deps }
  try {
    switch (block.source) {
      case 'top_sellers':
        return await topSellers(bounded, limit)
      case 'recommended':
        return await recommended(bounded, limit)
      case 'viewed':
        return await viewed(bounded, limit)
      case 'manual':
        return await manual(bounded, block)
      default:
        return []
    }
  } catch {
    return []
  }
}
