// apps/api/src/routes/messages/service.ts
//
// Read-only message log + summary stats over Message rows (spec §5). All queries
// merchant-scoped. No RFM/funnel/cohort logic — that is a later analytics phase.
import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { MessageDirection, MessageStatus } from '@prisma/client'

export interface ListMessagesFilters {
  direction?: MessageDirection
  status?: MessageStatus
}

export async function listMessages(
  merchantId: string,
  filters: ListMessagesFilters,
  page: number,
  pageSize: number,
) {
  const where: Prisma.MessageWhereInput = {
    merchantId,
    ...(filters.direction !== undefined && { direction: filters.direction }),
    ...(filters.status !== undefined && { status: filters.status }),
  }

  const [items, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        template: { select: { id: true, name: true } },
      },
    }),
    prisma.message.count({ where }),
  ])
  return { items, total, page, pageSize }
}

export interface MessageStats {
  totalOutbound: number
  totalInbound: number
  sent: number
  delivered: number
  read: number
  failed: number
  deliveryRate: number // delivered (incl. read) / left-the-system
  readRate: number // read / delivered (incl. read)
  optOutCount: number // customers currently opted out of WhatsApp
}

export async function getMessageStats(merchantId: string): Promise<MessageStats> {
  const grouped = await prisma.message.groupBy({
    by: ['status'],
    where: { merchantId, direction: 'OUTBOUND' },
    _count: { _all: true },
  })

  const byStatus: Record<string, number> = {}
  for (const g of grouped) byStatus[g.status] = g._count._all

  const queued = byStatus.QUEUED ?? 0
  const sent = byStatus.SENT ?? 0
  const delivered = byStatus.DELIVERED ?? 0
  const read = byStatus.READ ?? 0
  const failed = byStatus.FAILED ?? 0

  // Monotonic status: a READ row has status READ, so "reached device" = delivered + read,
  // and "left the system" = sent + delivered + read + failed (everything we attempted).
  const reachedDevice = delivered + read
  const leftSystem = sent + delivered + read + failed
  const totalOutbound = queued + leftSystem

  const [totalInbound, optOutCount] = await Promise.all([
    prisma.message.count({ where: { merchantId, direction: 'INBOUND' } }),
    prisma.customer.count({ where: { merchantId, isSubscribedWhatsapp: false } }),
  ])

  return {
    totalOutbound,
    totalInbound,
    sent,
    delivered,
    read,
    failed,
    deliveryRate: leftSystem > 0 ? reachedDevice / leftSystem : 0,
    readRate: reachedDevice > 0 ? read / reachedDevice : 0,
    optOutCount,
  }
}
