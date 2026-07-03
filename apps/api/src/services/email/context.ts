// apps/api/src/services/email/context.ts
//
// Assembles the per-recipient EmailRenderContext (segment membership for conditional
// blocks, live products for dynamic blocks, unsubscribe/open-tracking URLs) from the
// database at send time. Everything here is merchant-scoped for tenant safety.

import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type { EmailBlock, EmailDynamicProductBlock, EmailRenderContext, EmailRenderProduct } from '@engageiq/shared'
import { resolveBlockProducts } from './products.js'
import { makeUnsubscribeToken } from './tracking-tokens.js'

// The customer fields the renderer + context need. A Prisma Customer satisfies this.
export interface RenderCustomer {
  id: string
  email: string | null
  [key: string]: unknown
}

export interface BuildContextParams {
  merchantId: string
  customer: RenderCustomer
  blocks: EmailBlock[]
  order?: Record<string, unknown>
  // When present, an open-tracking pixel URL is embedded for this Message.
  messageId?: string
}

// Depth-first collect every dynamic-product block, including those nested inside
// conditional blocks, so each is resolved exactly once by its id.
function collectDynamicBlocks(blocks: EmailBlock[], out: EmailDynamicProductBlock[] = []): EmailDynamicProductBlock[] {
  for (const b of blocks) {
    if (b.type === 'dynamic-product') out.push(b)
    else if (b.type === 'conditional') collectDynamicBlocks(b.blocks, out)
  }
  return out
}

export async function buildEmailRenderContext(params: BuildContextParams): Promise<EmailRenderContext> {
  const { merchantId, customer, blocks } = params

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, currency: true, shopifyDomain: true },
  })
  const currency = merchant?.currency ?? 'PKR'
  const storefrontBase = merchant?.shopifyDomain ? `https://${merchant.shopifyDomain}` : null

  // Active segment memberships → segmentIds (drives conditional blocks). Tenant-scoped
  // through the segment's merchantId (SegmentMembership carries no direct merchantId).
  const memberships = await prisma.segmentMembership.findMany({
    where: { customerId: customer.id, exitedAt: null, segment: { merchantId } },
    select: { segmentId: true },
  })
  const segmentIds = memberships.map((m) => m.segmentId)

  // Resolve each dynamic-product block once, keyed by block id.
  const dynamicBlocks = collectDynamicBlocks(blocks)
  const productsByBlockId: Record<string, EmailRenderProduct[]> = {}
  await Promise.all(
    dynamicBlocks.map(async (block) => {
      productsByBlockId[block.id] = await resolveBlockProducts(
        { merchantId, customerId: customer.id, currency, storefrontBase },
        block,
      )
    }),
  )

  const base = env.EMAIL_TRACKING_BASE_URL.replace(/\/$/, '')
  const unsubscribeUrl =
    customer.email !== null
      ? `${base}/email/unsubscribe?m=${encodeURIComponent(merchantId)}&c=${encodeURIComponent(customer.id)}&t=${makeUnsubscribeToken(merchantId, customer.id, customer.email)}`
      : undefined
  const openTrackingUrl = params.messageId ? `${base}/email/open/${params.messageId}.gif` : undefined

  return {
    customer: customer as Record<string, unknown>,
    merchant: { name: merchant?.name ?? 'EngageIQ', currency },
    ...(params.order ? { order: params.order } : {}),
    segmentIds,
    productsByBlockId,
    ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
    ...(openTrackingUrl ? { openTrackingUrl } : {}),
  }
}
