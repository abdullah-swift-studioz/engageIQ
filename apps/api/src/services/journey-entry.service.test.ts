import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journey: { findMany: vi.fn() },
    journeyEnrollment: { findMany: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  journeyExecutorQueue: { add: vi.fn() },
}))

vi.mock('@engageiq/shared', () => ({
  JOURNEY_EXECUTOR: 'journey-executor',
}))

import { checkJourneyEntry } from './journey-entry.service.js'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue } from '@engageiq/queue'

const mockPrisma = prisma as unknown as {
  journey: { findMany: ReturnType<typeof vi.fn> }
  journeyEnrollment: { findMany: ReturnType<typeof vi.fn> }
}
const mockQueue = journeyExecutorQueue as unknown as { add: ReturnType<typeof vi.fn> }

const MERCHANT = 'merchant_1'
const CUSTOMER = 'customer_1'
const JOURNEY_ID = 'journey_1'

const baseJourney = {
  id: JOURNEY_ID,
  reEntryRule: 'DISALLOW',
  triggerConfig: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.journey.findMany.mockResolvedValue([])
  mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])
  mockQueue.add.mockResolvedValue(undefined)
})

describe('checkJourneyEntry', () => {
  it('enqueues enroll_customer when customer has no prior enrollment and DISALLOW', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'DISALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'enroll_customer', journeyId: JOURNEY_ID, customerId: CUSTOMER }),
    )
  })

  it('skips enrollment when DISALLOW and prior enrollment exists', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'DISALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'COMPLETED' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('enqueues when ALLOW even if prior enrollment exists', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'ALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'COMPLETED' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).toHaveBeenCalled()
  })

  it('skips when ALLOW but customer is currently ACTIVE', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'ALLOW' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'ACTIVE' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('enqueues when RE_ENROLL_AFTER_EXIT and prior enrollment is EXITED', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'RE_ENROLL_AFTER_EXIT' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([{ id: 'enroll_1', status: 'EXITED' }])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).toHaveBeenCalled()
  })

  it('skips when RE_ENROLL_AFTER_EXIT but no prior enrollment exists', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([{ ...baseJourney, reEntryRule: 'RE_ENROLL_AFTER_EXIT' }])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'order_placed', {})

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('filters segment_entered journeys by segmentId', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([
      { ...baseJourney, reEntryRule: 'ALLOW', triggerConfig: { segmentId: 'seg_a' } },
    ])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'segment_entered', { segmentId: 'seg_b' })

    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('filters custom_event journeys by eventName', async () => {
    mockPrisma.journey.findMany.mockResolvedValue([
      { ...baseJourney, reEntryRule: 'ALLOW', triggerConfig: { eventName: 'purchase_complete' } },
    ])
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyEntry(CUSTOMER, MERCHANT, 'custom_event', { eventName: 'page_view' })

    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
