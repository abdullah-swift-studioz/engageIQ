import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { ShopifyRefundPayload } from '@engageiq/shared'
import { recalculateCustomerAggregates } from './order.processor.js'
import { recalculateCodProfile } from '../services/profile-sync.service.js'

// Stored Order.lineItems shape (subset we need): carries the Shopify line_item_id
// (added in order.processor) so a refund line can be mapped back to its product_id.
interface StoredLineItem {
  line_item_id?: string | null
  product_id?: string | null
}

// Persisted onto Order.returnsData — the exact shape the product-retention analytics
// consumer expects: [{ product_id, line_item_id, quantity, subtotal }].
export interface ReturnItem {
  product_id: string | null
  line_item_id: string
  quantity: number
  subtotal: number
}

/**
 * Map a refund's line items to return items with their product_id resolved from the
 * order's stored line items (refund_line_items only carry line_item_id, not product_id).
 * Pure + exported for unit testing. A refund line whose line_item_id is not found in the
 * order still produces a return item with product_id=null (quantity is preserved so the
 * refund is never silently dropped).
 */
export function buildReturnItems(
  orderLineItems: Prisma.JsonValue | null,
  refundLineItems: ShopifyRefundPayload['refund_line_items'],
): ReturnItem[] {
  const productByLineItem = new Map<string, string | null>()
  if (Array.isArray(orderLineItems)) {
    for (const li of orderLineItems as unknown as StoredLineItem[]) {
      if (li && li.line_item_id != null) {
        productByLineItem.set(String(li.line_item_id), li.product_id ?? null)
      }
    }
  }

  const items: ReturnItem[] = []
  for (const rli of refundLineItems) {
    const lineItemId = String(rli.line_item_id)
    const quantity = typeof rli.quantity === 'number' && rli.quantity > 0 ? rli.quantity : 0
    if (quantity <= 0) continue
    items.push({
      product_id: productByLineItem.get(lineItemId) ?? null,
      line_item_id: lineItemId,
      quantity,
      subtotal: Number(rli.subtotal) || 0,
    })
  }
  return items
}

export async function processRefund(
  merchantId: string,
  payload: ShopifyRefundPayload,
): Promise<void> {
  const shopifyOrderId = String(payload.order_id)

  type Txn = ShopifyRefundPayload['transactions'][number]
  // Sum only successful refund/void transactions
  const refundAmount = payload.transactions
    .filter((t: Txn) => t.status === 'success' && (t.kind === 'refund' || t.kind === 'void'))
    .reduce((sum: number, t: Txn) => sum + Number(t.amount), 0)

  // Restocked line items (returns) are tracked independently of the money refunded:
  // a $0 "return to stock" refund still returns units and must count toward returnRate.
  const returnItems = buildReturnItems(null, payload.refund_line_items)
  const hasReturns = returnItems.length > 0

  if (refundAmount <= 0 && !hasReturns) return

  const order = await prisma.order.findUnique({
    where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
    select: {
      id: true,
      customerId: true,
      totalPrice: true,
      refundedAmount: true,
      lineItems: true,
      returnsData: true,
    },
  })

  if (!order) return

  const data: Prisma.OrderUpdateInput = {}

  // Money: accumulate refunded amount and recompute financial status.
  if (refundAmount > 0) {
    const previousRefunded = Number(order.refundedAmount)
    const newRefundedAmount = previousRefunded + refundAmount
    const totalPrice = Number(order.totalPrice)
    data.refundedAmount = newRefundedAmount
    data.financialStatus = newRefundedAmount >= totalPrice ? 'refunded' : 'partially_refunded'
  }

  // Returns: resolve product_id from the order's stored line items, then append to the
  // existing returnsData (each refund webhook is processed once — dedup by webhook id —
  // so appending accumulates units across separate refunds without double counting).
  if (hasReturns) {
    const resolved = buildReturnItems(order.lineItems, payload.refund_line_items)
    const existing = Array.isArray(order.returnsData)
      ? (order.returnsData as unknown as ReturnItem[])
      : []
    data.returnsData = [...existing, ...resolved] as unknown as Prisma.InputJsonValue
  }

  await prisma.order.update({ where: { id: order.id }, data })

  if (order.customerId) {
    await recalculateCustomerAggregates(merchantId, order.customerId)

    recalculateCodProfile(merchantId, order.customerId).catch((err: unknown) =>
      console.error('recalculateCodProfile failed', err),
    )
  }
}
