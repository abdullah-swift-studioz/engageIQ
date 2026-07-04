// apps/api/src/services/couriers/sync.service.ts
//
// The courier sync engine (roadmap 8.1 / guide §9.2 + §10.2). For one shipment it:
//   1. loads the merchant's (tenant-scoped) shipment; skips if terminal / no tracking #
//   2. loads + decrypts the merchant's courier integration (absent → clean skip)
//   3. calls the courier adapter, normalizing the latest tracking
//   4. appends new CourierEvent rows (deduped) and advances CourierShipment — atomically
//   5. on a delivered/returned TRANSITION: syncs the linked CodOrder, recomputes the
//      customer's COD acceptance/return rate, and fires the post-delivery / return
//      journey trigger.
//
// Every DB read/write is scoped by merchantId. pollShipment is idempotent: events dedup,
// terminal shipments are skipped, and transition side-effects only run when the status
// actually crosses into DELIVERED/RETURNED.
import { prisma } from '@engageiq/db'
import { Prisma, ShipmentStatus, CodOrderStatus } from '@prisma/client'
import type { Courier } from '@prisma/client'
import { courierPollQueue } from '@engageiq/queue'
import { COURIER_POLL } from '@engageiq/shared'
import type { CourierPollJob, CourierName } from '@engageiq/shared'
import { checkJourneyEntry } from '../journey-entry.service.js'
import { recalculateCodProfile } from '../profile-sync.service.js'
import { isTerminal, TERMINAL_STATUSES } from './status-map.js'
import { loadCourierIntegration } from './credentials.js'
import { getCourierAdapter, SUPPORTED_COURIERS } from './registry.js'
import type { NormalizedTracking, NormalizedCourierEvent } from './types.js'

export type PollOutcome =
  | { result: 'skipped'; reason: string }
  | { result: 'unchanged' }
  | { result: 'updated'; status: ShipmentStatus; newEvents: number }
  | { result: 'failed'; error: string; retryable: boolean }

// Dedup key for a normalized checkpoint against existing rows: the courier event id when
// present, else a synthetic status+timestamp key (so un-id'd events don't re-insert on
// every poll but genuinely new checkpoints still land).
function eventKey(e: { externalId?: string | null; status: ShipmentStatus; occurredAt: Date }): string {
  return e.externalId ? `id:${e.externalId}` : `st:${e.status}:${e.occurredAt.getTime()}`
}

// Poll ONE shipment and apply the result. Never throws for expected courier/HTTP errors;
// returns a typed outcome. The worker throws only when result==='failed' && retryable.
export async function pollShipment(merchantId: string, shipmentId: string): Promise<PollOutcome> {
  const shipment = await prisma.courierShipment.findFirst({
    where: { id: shipmentId, merchantId },
    include: { events: { select: { externalId: true, status: true, occurredAt: true } } },
  })
  if (!shipment) return { result: 'skipped', reason: 'shipment not found' }
  if (isTerminal(shipment.status)) return { result: 'skipped', reason: `terminal (${shipment.status})` }
  if (!shipment.trackingNumber) return { result: 'skipped', reason: 'no tracking number' }

  const adapter = getCourierAdapter(shipment.courier)
  if (!adapter) return { result: 'skipped', reason: `no adapter for courier ${shipment.courier}` }

  const integration = await loadCourierIntegration(merchantId, shipment.courier)
  if (!integration.ok) return { result: 'skipped', reason: `not configured: ${integration.reason}` }

  const fetched = await adapter.fetchTracking(shipment.trackingNumber, integration.context)
  if (!fetched.configured) return { result: 'skipped', reason: fetched.reason }
  if (!fetched.ok) return { result: 'failed', error: fetched.error, retryable: fetched.retryable }

  return applyTracking(
    {
      id: shipment.id,
      merchantId: shipment.merchantId,
      customerId: shipment.customerId,
      codOrderId: shipment.codOrderId,
      orderId: shipment.orderId,
      courier: shipment.courier,
      status: shipment.status,
      existingKeys: new Set(shipment.events.map((e) => eventKey(e))),
    },
    fetched.tracking,
  )
}

interface ShipmentSnapshot {
  id: string
  merchantId: string
  customerId: string | null
  codOrderId: string | null
  orderId: string | null
  courier: Courier
  status: ShipmentStatus
  existingKeys: Set<string>
}

// Persist new events + advance the shipment atomically, then run transition side-effects.
async function applyTracking(s: ShipmentSnapshot, tracking: NormalizedTracking): Promise<PollOutcome> {
  const newEvents = tracking.events.filter((e) => !s.existingKeys.has(eventKey(e)))

  const oldStatus = s.status
  const nextStatus = tracking.status
  const statusChanged = nextStatus !== oldStatus

  if (newEvents.length === 0 && !statusChanged) return { result: 'unchanged' }

  const deliveredTransition = oldStatus !== ShipmentStatus.DELIVERED && nextStatus === ShipmentStatus.DELIVERED
  const returnedTransition = oldStatus !== ShipmentStatus.RETURNED && nextStatus === ShipmentStatus.RETURNED

  await prisma.$transaction(async (tx) => {
    if (newEvents.length > 0) {
      await tx.courierEvent.createMany({
        data: newEvents.map((e: NormalizedCourierEvent) => ({
          merchantId: s.merchantId,
          shipmentId: s.id,
          status: e.status,
          description: e.description ?? null,
          externalId: e.externalId ?? null,
          raw: e.raw === undefined ? Prisma.JsonNull : (e.raw as Prisma.InputJsonValue),
          occurredAt: e.occurredAt,
        })),
      })
    }

    await tx.courierShipment.update({
      where: { id: s.id },
      data: {
        status: nextStatus,
        ...(tracking.deliveredAt != null && { deliveredAt: tracking.deliveredAt }),
        ...(tracking.returnedAt != null && { returnedAt: tracking.returnedAt }),
        ...(tracking.codCollected !== undefined && { codCollected: tracking.codCollected }),
        ...(tracking.codCollectedAt != null && { codCollectedAt: tracking.codCollectedAt }),
        ...(tracking.returnReason != null && { returnReason: tracking.returnReason }),
        ...(tracking.raw !== undefined && { rawTracking: tracking.raw as Prisma.InputJsonValue }),
      },
    })

    // Keep the linked COD order's status in step with courier truth so the COD
    // acceptance/return rate (recomputed below from CodOrder.status) reflects reality.
    if (s.codOrderId && (deliveredTransition || returnedTransition)) {
      await tx.codOrder.updateMany({
        where: { id: s.codOrderId, merchantId: s.merchantId },
        data: deliveredTransition
          ? { status: CodOrderStatus.DELIVERED, deliveredAt: tracking.deliveredAt ?? new Date() }
          : { status: CodOrderStatus.RETURNED, returnedAt: tracking.returnedAt ?? new Date() },
      })
    }
  })

  // Post-commit side-effects (fire-and-forget). Idempotent: a re-poll after these run
  // sees a terminal shipment and skips, so they run at most once per transition.
  if (deliveredTransition) await onTransition(s, 'order_delivered')
  if (returnedTransition) await onTransition(s, 'order_returned')

  return { result: 'updated', status: nextStatus, newEvents: newEvents.length }
}

// Recompute the customer's COD acceptance/return rate and fire the matching journey
// trigger. Both are best-effort; failures are logged, never propagated.
async function onTransition(s: ShipmentSnapshot, trigger: 'order_delivered' | 'order_returned'): Promise<void> {
  if (!s.customerId) return
  try {
    await recalculateCodProfile(s.merchantId, s.customerId)
  } catch (err) {
    console.error('[courier-sync] recalculateCodProfile failed', { shipmentId: s.id, err })
  }
  try {
    await checkJourneyEntry(s.customerId, s.merchantId, trigger, {
      shipmentId: s.id,
      ...(s.orderId && { orderId: s.orderId }),
      ...(s.codOrderId && { codOrderId: s.codOrderId }),
      courier: s.courier,
    })
  } catch (err) {
    console.error(`[courier-sync] ${trigger} journey trigger failed`, { shipmentId: s.id, err })
  }
}

// Enqueue a poll job for every active (non-terminal, trackable, supported) shipment.
// Omit merchantId for the scheduled global sweep; pass it for a single-merchant sync.
// Returns the number of poll jobs enqueued.
export async function enqueueSweep(merchantId?: string): Promise<number> {
  const shipments = await prisma.courierShipment.findMany({
    where: {
      ...(merchantId && { merchantId }),
      status: { notIn: [...TERMINAL_STATUSES] },
      trackingNumber: { not: null },
      courier: { in: SUPPORTED_COURIERS },
    },
    select: { id: true, merchantId: true, courier: true },
  })

  for (const shipment of shipments) {
    const job: CourierPollJob = {
      type: 'poll',
      merchantId: shipment.merchantId,
      shipmentId: shipment.id,
      courier: shipment.courier as CourierName,
    }
    // No fixed jobId: pollShipment is idempotent, so duplicate polls are harmless and
    // we never want a lingering completed jobId to block the next sweep's enqueue.
    await courierPollQueue.add(COURIER_POLL, job)
  }
  return shipments.length
}
