import { Worker, UnrecoverableError } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { redisConnection } from '@engageiq/queue'
import { prisma } from '@engageiq/db'
import type { SegmentEvaluateJobPayload } from '@engageiq/shared'
import type { SegmentGroup } from '@engageiq/shared'
import { validateConditionTree } from '../lib/segments/condition-validator.js'
import { compileToPrismaWhere } from '../services/segment-evaluator.js'
// lane:public-api START
import { emitOutboundEvent } from '../services/webhooks-outbound/emit.js'
import { OUTBOUND_EVENTS } from '../services/webhooks-outbound/events.js'
// lane:public-api END

export function createSegmentEvaluateWorker() {
  const worker = new Worker<SegmentEvaluateJobPayload>(
    'segment-evaluate',
    async (job) => {
      const { segmentId, merchantId } = job.data

      const segment = await prisma.segment.findFirst({
        where: { id: segmentId, merchantId },
      })
      if (!segment) {
        throw new UnrecoverableError(`Segment ${segmentId} not found for merchant ${merchantId}`)
      }

      const validation = validateConditionTree(segment.conditions)
      if (!validation.ok) {
        throw new UnrecoverableError(`Invalid conditions on segment ${segmentId}: ${validation.error}`)
      }

      const group = segment.conditions as unknown as SegmentGroup
      const where = compileToPrismaWhere(group, merchantId) as Prisma.CustomerWhereInput

      // Find all currently matching customer IDs
      const matchingCustomers = await prisma.customer.findMany({
        where,
        select: { id: true },
      })
      const matchingIds = new Set(matchingCustomers.map((c) => c.id))

      // Find all currently active memberships
      const activeMemberships = await prisma.segmentMembership.findMany({
        where: { segmentId, exitedAt: null },
        select: { id: true, customerId: true },
      })
      const activeMemberIds = new Set(activeMemberships.map((m) => m.customerId))

      // New members: matching but not currently active
      const toAdd = [...matchingIds].filter((id) => !activeMemberIds.has(id))
      if (toAdd.length > 0) {
        await prisma.segmentMembership.createMany({
          data: toAdd.map((customerId) => ({ segmentId, customerId })),
          skipDuplicates: true,
        })
        // lane:public-api START — outbound webhook: segment.entered (per new member)
        for (const customerId of toAdd) {
          void emitOutboundEvent(merchantId, OUTBOUND_EVENTS.SEGMENT_ENTERED, {
            segmentId,
            segmentName: segment.name,
            customerId,
          })
        }
        // lane:public-api END
      }

      // Exited members: active but no longer matching
      const toRemove = activeMemberships.filter((m) => !matchingIds.has(m.customerId))
      if (toRemove.length > 0) {
        const exitedAt = new Date()
        await Promise.all(
          toRemove.map((m) =>
            prisma.segmentMembership.update({
              where: { id: m.id },
              data: { exitedAt },
            }),
          ),
        )
        // lane:public-api START — outbound webhook: segment.exited (per exited member)
        for (const m of toRemove) {
          void emitOutboundEvent(merchantId, OUTBOUND_EVENTS.SEGMENT_EXITED, {
            segmentId,
            segmentName: segment.name,
            customerId: m.customerId,
          })
        }
        // lane:public-api END
      }

      // Update segment stats
      await prisma.segment.update({
        where: { id: segmentId },
        data: {
          memberCount: matchingIds.size,
          lastEvaluatedAt: new Date(),
        },
      })
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  )

  return worker
}
