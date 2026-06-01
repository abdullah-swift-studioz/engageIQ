import { prisma } from '@engageiq/db'
import type { GroupMember } from '@engageiq/shared'

async function getAgencyMerchantIds(merchantId: string): Promise<string[]> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, agencyId: true },
  })
  if (!merchant) return [merchantId]

  if (merchant.agencyId) {
    const siblings = await prisma.merchant.findMany({
      where: { agencyId: merchant.agencyId },
      select: { id: true },
    })
    return [merchant.agencyId, ...siblings.map((s) => s.id)]
  }

  const children = await prisma.merchant.findMany({
    where: { agencyId: merchantId },
    select: { id: true },
  })
  return [merchantId, ...children.map((c) => c.id)]
}

export async function assignGroupCustomerId(
  customerId: string,
  merchantId: string,
  email: string | null,
  phone: string | null,
): Promise<void> {
  if (!email && !phone) return

  const agencyMerchantIds = await getAgencyMerchantIds(merchantId)
  const otherMerchantIds = agencyMerchantIds.filter((id) => id !== merchantId)
  if (otherMerchantIds.length === 0) return

  const orConditions: Array<{ email: string } | { phone: string }> = []
  if (email) orConditions.push({ email })
  if (phone) orConditions.push({ phone })

  const match = await prisma.customer.findFirst({
    where: {
      merchantId: { in: otherMerchantIds },
      mergedIntoId: null,
      OR: orConditions,
    },
    select: { id: true, groupCustomerId: true },
  })

  if (!match) return

  if (match.groupCustomerId) {
    await prisma.customer.update({
      where: { id: customerId },
      data: { groupCustomerId: match.groupCustomerId },
    })
  } else {
    const groupId = crypto.randomUUID()
    await prisma.customer.update({
      where: { id: customerId },
      data: { groupCustomerId: groupId },
    })
    await prisma.customer.update({
      where: { id: match.id },
      data: { groupCustomerId: groupId },
    })
  }
}

export async function getGroupMembers(
  groupCustomerId: string,
  requestingMerchantId: string,
): Promise<GroupMember[]> {
  const agencyMerchantIds = await getAgencyMerchantIds(requestingMerchantId)

  const customers = await prisma.customer.findMany({
    where: {
      groupCustomerId,
      merchantId: { in: agencyMerchantIds },
      mergedIntoId: null,
    },
    include: {
      merchant: { select: { id: true, name: true } },
    },
  })

  return customers.map((c) => ({
    customerId: c.id,
    merchantId: c.merchantId,
    merchantName: c.merchant.name,
    email: c.email,
    phone: c.phone,
    firstName: c.firstName,
    lastName: c.lastName,
    totalOrders: c.totalOrders,
    totalSpent: c.totalSpent.toString(),
    createdAt: c.createdAt.toISOString(),
  }))
}
