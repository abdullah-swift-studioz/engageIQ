import { prisma } from '@engageiq/db'
import type { ShopifyRefundPayload } from '@engageiq/shared'
import { recalculateCustomerAggregates } from './order.processor.js'

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

  if (refundAmount <= 0) return

  const order = await prisma.order.findUnique({
    where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
    select: { id: true, customerId: true, totalPrice: true, refundedAmount: true },
  })

  if (!order) return

  const previousRefunded = Number(order.refundedAmount)
  const newRefundedAmount = previousRefunded + refundAmount
  const totalPrice = Number(order.totalPrice)

  // Determine new financial status based on refund coverage
  let financialStatus: string
  if (newRefundedAmount >= totalPrice) {
    financialStatus = 'refunded'
  } else {
    financialStatus = 'partially_refunded'
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { refundedAmount: newRefundedAmount, financialStatus },
  })

  if (order.customerId) {
    await recalculateCustomerAggregates(merchantId, order.customerId)
  }
}
