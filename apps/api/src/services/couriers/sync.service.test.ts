import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShipmentStatus, CodOrderStatus } from '@prisma/client'

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────
vi.mock('@engageiq/db', () => ({
  prisma: {
    courierShipment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    courierEvent: { createMany: vi.fn() },
    codOrder: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@engageiq/queue', () => ({ courierPollQueue: { add: vi.fn() }, redisConnection: {} }))
vi.mock('@engageiq/shared', () => ({ COURIER_POLL: 'courier-poll' }))
vi.mock('../journey-entry.service.js', () => ({ checkJourneyEntry: vi.fn() }))
vi.mock('../profile-sync.service.js', () => ({ recalculateCodProfile: vi.fn() }))
vi.mock('./credentials.js', () => ({ loadCourierIntegration: vi.fn() }))
vi.mock('./registry.js', () => ({
  getCourierAdapter: vi.fn(),
  SUPPORTED_COURIERS: ['POSTEX', 'LEOPARDS', 'TCS', 'MP'],
}))

import { prisma } from '@engageiq/db'
import { courierPollQueue } from '@engageiq/queue'
import { checkJourneyEntry } from '../journey-entry.service.js'
import { recalculateCodProfile } from '../profile-sync.service.js'
import { loadCourierIntegration } from './credentials.js'
import { getCourierAdapter } from './registry.js'
import { pollShipment, enqueueSweep } from './sync.service.js'

const configured = { ok: true, context: { credentials: { token: 'x' }, config: null } } as never

function shipment(over: Record<string, unknown> = {}) {
  return {
    id: 's1', merchantId: 'm1', customerId: 'c1', codOrderId: 'co1', orderId: 'o1',
    courier: 'POSTEX', status: ShipmentStatus.IN_TRANSIT, trackingNumber: 'T1', events: [],
    ...over,
  }
}

function adapterReturning(result: unknown) {
  return { courier: 'POSTEX', fetchTracking: vi.fn().mockResolvedValue(result) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) => cb(prisma)) as never)
  vi.mocked(loadCourierIntegration).mockResolvedValue(configured)
})

describe('pollShipment — delivered transition', () => {
  it('appends the event, advances status, syncs COD order, recomputes rate, fires trigger', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(shipment() as never)
    vi.mocked(getCourierAdapter).mockReturnValue(
      adapterReturning({
        configured: true, ok: true,
        tracking: {
          status: ShipmentStatus.DELIVERED,
          events: [{ status: ShipmentStatus.DELIVERED, occurredAt: new Date('2026-07-01T10:00:00Z'), externalId: 'e1' }],
          deliveredAt: new Date('2026-07-01T10:00:00Z'),
          codCollected: true,
          codCollectedAt: new Date('2026-07-01T10:00:00Z'),
        },
      }) as never,
    )

    const outcome = await pollShipment('m1', 's1')

    expect(outcome).toEqual({ result: 'updated', status: ShipmentStatus.DELIVERED, newEvents: 1 })
    expect(prisma.courierEvent.createMany).toHaveBeenCalledTimes(1)
    expect(prisma.courierShipment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ShipmentStatus.DELIVERED, codCollected: true }) }),
    )
    expect(prisma.codOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: CodOrderStatus.DELIVERED }) }),
    )
    expect(recalculateCodProfile).toHaveBeenCalledWith('m1', 'c1')
    expect(checkJourneyEntry).toHaveBeenCalledWith('c1', 'm1', 'order_delivered', expect.objectContaining({ shipmentId: 's1' }))
  })
})

describe('pollShipment — returned transition', () => {
  it('marks the COD order returned and fires the return trigger', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(shipment({ status: ShipmentStatus.OUT_FOR_DELIVERY }) as never)
    vi.mocked(getCourierAdapter).mockReturnValue(
      adapterReturning({
        configured: true, ok: true,
        tracking: {
          status: ShipmentStatus.RETURNED,
          events: [{ status: ShipmentStatus.RETURNED, occurredAt: new Date('2026-07-02T10:00:00Z') }],
          returnedAt: new Date('2026-07-02T10:00:00Z'),
          returnReason: 'Customer refused',
        },
      }) as never,
    )

    const outcome = await pollShipment('m1', 's1')

    expect(outcome).toMatchObject({ result: 'updated', status: ShipmentStatus.RETURNED })
    expect(prisma.codOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: CodOrderStatus.RETURNED }) }),
    )
    expect(checkJourneyEntry).toHaveBeenCalledWith('c1', 'm1', 'order_returned', expect.anything())
  })
})

describe('pollShipment — skips', () => {
  it('skips a terminal shipment without calling the adapter', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(shipment({ status: ShipmentStatus.DELIVERED }) as never)
    const outcome = await pollShipment('m1', 's1')
    expect(outcome).toMatchObject({ result: 'skipped' })
    expect(getCourierAdapter).not.toHaveBeenCalled()
  })

  it('skips when there is no tracking number', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(shipment({ trackingNumber: null }) as never)
    const outcome = await pollShipment('m1', 's1')
    expect(outcome).toEqual({ result: 'skipped', reason: 'no tracking number' })
  })

  it('skips when the merchant has no integration', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(shipment() as never)
    vi.mocked(getCourierAdapter).mockReturnValue(adapterReturning({}) as never)
    vi.mocked(loadCourierIntegration).mockResolvedValue({ ok: false, reason: 'no-integration' } as never)
    const outcome = await pollShipment('m1', 's1')
    expect(outcome).toMatchObject({ result: 'skipped' })
    expect(prisma.courierShipment.update).not.toHaveBeenCalled()
  })

  it('returns not-found for a missing shipment', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(null as never)
    expect(await pollShipment('m1', 'nope')).toEqual({ result: 'skipped', reason: 'shipment not found' })
  })
})

describe('pollShipment — no change & failures', () => {
  it('is unchanged when the status is identical and the event already exists (dedup)', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(
      shipment({ events: [{ externalId: 'e1', status: ShipmentStatus.IN_TRANSIT, occurredAt: new Date('2026-07-01T09:00:00Z') }] }) as never,
    )
    vi.mocked(getCourierAdapter).mockReturnValue(
      adapterReturning({
        configured: true, ok: true,
        tracking: {
          status: ShipmentStatus.IN_TRANSIT,
          events: [{ status: ShipmentStatus.IN_TRANSIT, occurredAt: new Date('2026-07-01T09:00:00Z'), externalId: 'e1' }],
        },
      }) as never,
    )
    const outcome = await pollShipment('m1', 's1')
    expect(outcome).toEqual({ result: 'unchanged' })
    expect(prisma.courierShipment.update).not.toHaveBeenCalled()
    expect(checkJourneyEntry).not.toHaveBeenCalled()
  })

  it('reports a retryable failure without writing', async () => {
    vi.mocked(prisma.courierShipment.findFirst).mockResolvedValue(shipment() as never)
    vi.mocked(getCourierAdapter).mockReturnValue(
      adapterReturning({ configured: true, ok: false, retryable: true, error: 'PostEx HTTP 503' }) as never,
    )
    const outcome = await pollShipment('m1', 's1')
    expect(outcome).toEqual({ result: 'failed', error: 'PostEx HTTP 503', retryable: true })
    expect(prisma.courierShipment.update).not.toHaveBeenCalled()
  })
})

describe('enqueueSweep', () => {
  it('enqueues one poll job per active shipment and returns the count', async () => {
    vi.mocked(prisma.courierShipment.findMany).mockResolvedValue([
      { id: 's1', merchantId: 'm1', courier: 'POSTEX' },
      { id: 's2', merchantId: 'm1', courier: 'TCS' },
    ] as never)
    const n = await enqueueSweep('m1')
    expect(n).toBe(2)
    expect(courierPollQueue.add).toHaveBeenCalledTimes(2)
    expect(courierPollQueue.add).toHaveBeenCalledWith('courier-poll', expect.objectContaining({ type: 'poll', shipmentId: 's1' }))
  })
})
