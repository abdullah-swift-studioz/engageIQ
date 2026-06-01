import { prisma } from '@engageiq/db'
import type { ShopifyCustomerPayload } from '@engageiq/shared'
import { normalizePhone, parseTags } from './utils.js'
import { assignGroupCustomerId } from '../services/multi-store.service.js'

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

  // P1 fix: if a stub customer exists with the same email (shopifyCustomerId is null,
  // created by SDK before the Shopify webhook arrived), upgrade it in place.
  // A direct upsert would fail on @@unique([merchantId, email]).
  if (payload.email) {
    const stub = await prisma.customer.findFirst({
      where: {
        merchantId,
        email: payload.email,
        shopifyCustomerId: null,
        mergedIntoId: null,
      },
      select: { id: true },
    })
    if (stub) {
      await prisma.customer.update({
        where: { id: stub.id },
        data: {
          shopifyCustomerId,
          email: payload.email,
          phone,
          firstName: payload.first_name ?? null,
          lastName: payload.last_name ?? null,
          city,
          province,
          country,
          tags,
          isSubscribedEmail: payload.accepts_marketing,
        },
      })
      assignGroupCustomerId(stub.id, merchantId, payload.email, phone).catch(() => {/* best-effort */})
      return stub.id
    }
  }

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

  assignGroupCustomerId(customer.id, merchantId, payload.email ?? null, phone).catch(() => {/* best-effort */})

  return customer.id
}
