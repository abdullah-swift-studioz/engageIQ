import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { ShopifyOrderPayload, ShopifyLineItem } from '@engageiq/shared'
import { detectCod, parseTags } from './utils.js'
import { processCustomerUpsert } from './customer.processor.js'
import { recalculateCodProfile } from '../services/profile-sync.service.js'
import { checkJourneyEntry } from '../services/journey-entry.service.js'
import { checkJourneyExit } from '../services/journey-exit.service.js'
import { scoreFakeOrderRealtime } from '../services/fake-order-gate.service.js'

/**
 * Recompute totalOrders, totalSpent, avgOrderValue, firstOrderAt, lastOrderAt,
 * and codOrderCount from the orders table rather than maintaining running
 * counters — avoids drift on updates, cancellations, and refunds.
 */
export async function recalculateCustomerAggregates(
  merchantId: string,
  customerId: string,
): Promise<void> {
  const [agg, firstOrder, lastOrder, codCount] = await Promise.all([
    prisma.order.aggregate({
      where: { merchantId, customerId, cancelledAt: null },
      _count: true,
      _sum: { totalPrice: true, refundedAmount: true },
    }),
    prisma.order.findFirst({
      where: { merchantId, customerId, cancelledAt: null },
      orderBy: { placedAt: 'asc' },
      select: { placedAt: true },
    }),
    prisma.order.findFirst({
      where: { merchantId, customerId, cancelledAt: null },
      orderBy: { placedAt: 'desc' },
      select: { placedAt: true },
    }),
    prisma.order.count({
      where: { merchantId, customerId, cancelledAt: null, isCod: true },
    }),
  ])

  const totalOrders = agg._count
  const grossSpent = Number(agg._sum.totalPrice ?? 0)
  const refunded = Number(agg._sum.refundedAmount ?? 0)
  const totalSpent = Math.max(0, grossSpent - refunded)
  const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      totalOrders,
      totalSpent,
      avgOrderValue,
      firstOrderAt: firstOrder?.placedAt ?? null,
      lastOrderAt: lastOrder?.placedAt ?? null,
      codOrderCount: codCount,
    },
  })
}

/**
 * Upsert an Order and its corresponding CodOrder record without recalculating
 * customer aggregates. Used by the historical backfill where aggregates are
 * recalculated once in bulk after all orders are written.
 */
export async function processOrderUpsert(
  merchantId: string,
  payload: ShopifyOrderPayload,
  customerId: string | null,
): Promise<void> {
  const shopifyOrderId = String(payload.id)
  const gateway = payload.payment_gateway || payload.gateway || ''
  const isCod = detectCod(gateway, payload.financial_status)
  const tags = parseTags(payload.tags)

  const lineItems = payload.line_items.map((li: ShopifyLineItem) => ({
    // line_item_id is the Shopify order-line id; stored so refund webhooks can map a
    // refund_line_item (which only carries line_item_id) back to its product_id when
    // populating Order.returnsData (see refund.processor.ts / Product.returnRate).
    line_item_id: li.id != null ? String(li.id) : null,
    product_id: li.product_id ? String(li.product_id) : null,
    variant_id: li.variant_id ? String(li.variant_id) : null,
    title: li.title,
    quantity: li.quantity,
    price: li.price,
    sku: li.sku ?? null,
  }))

  await prisma.order.upsert({
    where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
    create: {
      merchantId,
      customerId,
      shopifyOrderId,
      orderNumber: String(payload.order_number),
      totalPrice: payload.total_price,
      subtotalPrice: payload.subtotal_price,
      currency: payload.currency,
      financialStatus: payload.financial_status,
      fulfillmentStatus: payload.fulfillment_status,
      paymentGateway: gateway || null,
      isCod,
      lineItems,
      shippingAddress: payload.shipping_address
        ? (payload.shipping_address as Prisma.InputJsonValue)
        : Prisma.DbNull,
      tags,
      cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : null,
      cancelReason: payload.cancel_reason ?? null,
      placedAt: new Date(payload.created_at),
    },
    update: {
      financialStatus: payload.financial_status,
      fulfillmentStatus: payload.fulfillment_status,
      cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : null,
      cancelReason: payload.cancel_reason ?? null,
      tags,
    },
  })

  if (isCod) {
    await prisma.codOrder.upsert({
      where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
      create: {
        merchantId,
        customerId,
        shopifyOrderId,
        orderNumber: String(payload.order_number),
        amount: payload.total_price,
        city: payload.shipping_address?.city ?? null,
        province: payload.shipping_address?.province ?? null,
        paymentGateway: gateway,
        placedAt: new Date(payload.created_at),
      },
      update: {
        city: payload.shipping_address?.city ?? null,
        province: payload.shipping_address?.province ?? null,
      },
    })
  }
}

export async function processOrder(
  merchantId: string,
  payload: ShopifyOrderPayload,
): Promise<void> {
  let customerId: string | null = null
  if (payload.customer) {
    customerId = await processCustomerUpsert(merchantId, {
      id: payload.customer.id,
      email: payload.customer.email,
      phone: payload.customer.phone,
      first_name: payload.customer.first_name,
      last_name: payload.customer.last_name,
      default_address: payload.customer.default_address,
      tags: payload.customer.tags ?? '',
      accepts_marketing: payload.customer.accepts_marketing ?? false,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
    })
  }

  const gateway = payload.payment_gateway || payload.gateway || ''
  const isCod = detectCod(gateway, payload.financial_status)

  await processOrderUpsert(merchantId, payload, customerId)

  if (customerId) {
    await recalculateCustomerAggregates(merchantId, customerId)

    if (isCod) {
      recalculateCodProfile(merchantId, customerId).catch((err: unknown) =>
        console.error('recalculateCodProfile failed', err),
      )
    }
    checkJourneyEntry(customerId, merchantId, 'order_placed', {}).catch(
      (err: unknown) => console.error('[journey-entry] order_placed hook failed', err),
    )
    checkJourneyExit(customerId, merchantId, 'order_placed').catch(
      (err: unknown) => console.error('[journey-exit] order_placed hook failed', err),
    )
  }

  // Real-time fake-order scoring + gating (7.3). Runs after aggregates are recalculated so
  // the customer features (codOrderCount, avgOrderValue) are fresh. Awaited so the gate is
  // applied inline, but never allowed to throw — an ML-service outage must not drop the
  // order; the nightly batch scoring worker re-scores anything left unscored.
  if (isCod) {
    try {
      await scoreFakeOrderRealtime(merchantId, String(payload.id))
    } catch (err) {
      console.error('[fake-order-gate] realtime scoring failed', err)
    }
  }
}
