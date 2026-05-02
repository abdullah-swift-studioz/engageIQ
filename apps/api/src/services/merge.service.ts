import { prisma } from '@engageiq/db'
import type { MergeResult } from '@engageiq/shared'

export async function mergeCustomers(
  merchantId: string,
  id1: string,
  id2: string,
  mergeReason = 'manual_dashboard_merge',
): Promise<MergeResult> {
  // Validation: cannot merge a customer with itself
  if (id1 === id2) {
    throw new Error('MERGE_SAME_CUSTOMER')
  }

  // Fetch both customers, scoped to merchantId
  const [customer1, customer2] = await Promise.all([
    prisma.customer.findFirst({ where: { id: id1, merchantId } }),
    prisma.customer.findFirst({ where: { id: id2, merchantId } }),
  ])

  if (customer1 === null || customer2 === null) {
    throw new Error('CUSTOMER_NOT_FOUND')
  }

  if (customer1.mergedIntoId !== null || customer2.mergedIntoId !== null) {
    throw new Error('CUSTOMER_ALREADY_MERGED')
  }

  // Determine canonical: older createdAt wins; tie goes to id1
  const canonicalId =
    customer1.createdAt <= customer2.createdAt ? id1 : id2
  const secondaryId = canonicalId === id1 ? id2 : id1

  const canonical = canonicalId === id1 ? customer1 : customer2
  const secondary = secondaryId === id1 ? customer1 : customer2

  let now!: Date

  await prisma.$transaction(async (tx) => {
    // Step 1 — Deduplicate SegmentMemberships before migrating
    const canonicalSegmentIds = (
      await tx.segmentMembership.findMany({
        where: { customerId: canonicalId, exitedAt: null },
        select: { segmentId: true },
      })
    ).map((m) => m.segmentId)

    if (canonicalSegmentIds.length > 0) {
      await tx.segmentMembership.deleteMany({
        where: { customerId: secondaryId, segmentId: { in: canonicalSegmentIds } },
      })
    }

    await tx.segmentMembership.updateMany({
      where: { customerId: secondaryId },
      data: { customerId: canonicalId },
    })

    // Step 2 — Deduplicate JourneyEnrollments before migrating
    const canonicalJourneyIds = (
      await tx.journeyEnrollment.findMany({
        where: { customerId: canonicalId, status: 'ACTIVE' },
        select: { journeyId: true },
      })
    ).map((e) => e.journeyId)

    if (canonicalJourneyIds.length > 0) {
      await tx.journeyEnrollment.deleteMany({
        where: {
          customerId: secondaryId,
          journeyId: { in: canonicalJourneyIds },
          status: 'ACTIVE',
        },
      })
    }

    await tx.journeyEnrollment.updateMany({
      where: { customerId: secondaryId },
      data: { customerId: canonicalId },
    })

    // Step 3 — Migrate other relations
    await tx.order.updateMany({ where: { customerId: secondaryId }, data: { customerId: canonicalId } })
    await tx.codOrder.updateMany({ where: { customerId: secondaryId }, data: { customerId: canonicalId } })
    await tx.abandonedCheckout.updateMany({ where: { customerId: secondaryId }, data: { customerId: canonicalId } })

    // Step 4 — Merge anonIds on canonical
    const mergedAnonIds = [...new Set([...canonical.anonIds, ...secondary.anonIds])]
    await tx.customer.update({
      where: { id: canonicalId },
      data: { anonIds: mergedAnonIds },
    })

    // Step 5 — Mark secondary as merged
    now = new Date()
    await tx.customer.update({
      where: { id: secondaryId },
      data: { mergedIntoId: canonicalId, mergedAt: now },
    })
  })

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'customer_merge',
      merge_reason: mergeReason,
      canonical_id: canonicalId,
      merged_id: secondaryId,
      merchant_id: merchantId,
      timestamp: now.toISOString(),
    }),
  )

  return {
    canonicalId,
    secondaryId,
    mergedAt: now.toISOString(),
    mergeReason,
  }
}
