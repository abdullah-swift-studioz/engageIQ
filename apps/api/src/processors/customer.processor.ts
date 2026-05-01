import { prisma } from '@engageiq/db'
import type { ShopifyCustomerPayload } from '@engageiq/shared'
import { normalizePhone, parseTags } from './utils.js'

export async function processCustomerUpsert(
  merchantId: string,
  payload: ShopifyCustomerPayload,
): Promise<string> {
  const shopifyCustomerId = String(payload.id)
  const phone = normalizePhone(payload.phone)
  const city = payload.default_address?.city ?? null
  const province = payload.default_address?.province ?? null
  const country = payload.default_address?.country_code ?? 'PK'
  const tags = parseTags(payload.tags)

  const customer = await prisma.customer.upsert({
    where: { merchantId_shopifyCustomerId: { merchantId, shopifyCustomerId } },
    create: {
      merchantId,
      shopifyCustomerId,
      email: payload.email ?? null,
      phone,
      firstName: payload.first_name ?? null,
      lastName: payload.last_name ?? null,
      city,
      province,
      country,
      tags,
      isSubscribedEmail: payload.accepts_marketing,
    },
    update: {
      email: payload.email ?? null,
      phone,
      firstName: payload.first_name ?? null,
      lastName: payload.last_name ?? null,
      city,
      province,
      country,
      tags,
      isSubscribedEmail: payload.accepts_marketing,
    },
    select: { id: true },
  })

  return customer.id
}
