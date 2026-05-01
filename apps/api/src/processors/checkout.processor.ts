import { prisma } from '@engageiq/db'
import type { ShopifyCheckoutPayload } from '@engageiq/shared'
import { normalizePhone } from './utils.js'

export async function processCheckout(
  merchantId: string,
  payload: ShopifyCheckoutPayload,
): Promise<void> {
  const phone = normalizePhone(payload.phone)

  // Resolve customer — prefer Shopify customer ID, fall back to email match
  let customerId: string | null = null

  if (payload.customer?.id) {
    const shopifyCustomerId = String(payload.customer.id)
    const found = await prisma.customer.findUnique({
      where: { merchantId_shopifyCustomerId: { merchantId, shopifyCustomerId } },
      select: { id: true },
    })
    customerId = found?.id ?? null
  }

  if (!customerId && payload.email) {
    const found = await prisma.customer.findUnique({
      where: { merchantId_email: { merchantId, email: payload.email } },
      select: { id: true },
    })
    customerId = found?.id ?? null
  }

  const lineItems = payload.line_items.map((li: ShopifyCheckoutPayload['line_items'][number]) => ({
    product_id: li.product_id ? String(li.product_id) : null,
    variant_id: li.variant_id ? String(li.variant_id) : null,
    title: li.title,
    quantity: li.quantity,
    price: li.price,
    sku: li.sku ?? null,
  }))

  await prisma.abandonedCheckout.upsert({
    where: {
      merchantId_shopifyCheckoutToken: { merchantId, shopifyCheckoutToken: payload.token },
    },
    create: {
      merchantId,
      customerId,
      shopifyCheckoutToken: payload.token,
      email: payload.email ?? null,
      phone,
      lineItems,
      totalPrice: payload.total_price,
      currency: payload.currency,
    },
    update: {
      customerId,
      email: payload.email ?? null,
      phone,
      lineItems,
      totalPrice: payload.total_price,
    },
  })
}
