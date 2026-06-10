import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journeyEnrollment: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import { checkJourneyExit } from './journey-exit.service.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  journeyEnrollment: {
    findMany: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

const MERCHANT = 'merchant_1'
const CUSTOMER = 'customer_1'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])
  mockPrisma.journeyEnrollment.updateMany.mockResolvedValue({ count: 0 })
})

describe('checkJourneyExit', () => {
  it('exits enrollments whose journey exitTrigger matches', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: MERCHANT, exitTrigger: 'order_placed' },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['enroll_1'] } },
        data: expect.objectContaining({ status: 'EXITED' }),
      }),
    )
  })

  it('does not exit enrollments with a different exitTrigger', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: MERCHANT, exitTrigger: 'segment_entered' },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('does not exit enrollments with null exitTrigger', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: MERCHANT, exitTrigger: null },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('does not exit enrollments from a different merchant', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([
      {
        id: 'enroll_1',
        journey: { merchantId: 'other_merchant', exitTrigger: 'order_placed' },
      },
    ])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing when no active enrollments exist', async () => {
    mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])

    await checkJourneyExit(CUSTOMER, MERCHANT, 'order_placed')

    expect(mockPrisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })
})
