import { prisma } from '@engageiq/db'
import type { AgencyClientReport, AgencyClientReportRow } from '@engageiq/shared'
import { getReportableMerchantIds, type AgencyUser } from './access.service.js'

/**
 * Cross-client report (guide §9.4 — "run reports across clients"). Aggregates
 * headline numbers for every child merchant the agency user can access. Each
 * per-client aggregate is itself tenant-scoped by that child's merchantId, so no
 * data crosses between clients. Postgres only (counts + revenue), never events.
 */
export async function buildAgencyClientReport(user: AgencyUser): Promise<AgencyClientReport> {
  const merchantIds = await getReportableMerchantIds(user)

  const merchants = await prisma.merchant.findMany({
    where: { id: { in: merchantIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  const rows: AgencyClientReportRow[] = await Promise.all(
    merchants.map(async (m) => {
      const [customerCount, orderAgg] = await Promise.all([
        prisma.customer.count({ where: { merchantId: m.id } }),
        prisma.order.aggregate({
          where: { merchantId: m.id },
          _count: { _all: true },
          _sum: { totalPrice: true },
        }),
      ])
      return {
        merchantId: m.id,
        merchantName: m.name,
        customerCount,
        orderCount: orderAgg._count._all,
        totalRevenue: (orderAgg._sum.totalPrice ?? 0).toString(),
      }
    }),
  )

  return {
    generatedAt: new Date().toISOString(),
    clientCount: rows.length,
    rows,
  }
}
