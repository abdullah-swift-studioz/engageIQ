import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @engageiq/db BEFORE importing the service (Vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    segmentMembership: { findMany: vi.fn() },
    journeyEnrollment: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    abandonedCheckout: { findMany: vi.fn() },
    codOrder: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  clickhouse: {
    query: vi.fn(),
  },
}))

import { prisma, clickhouse } from '@engageiq/db'
import { recalculateCodProfile, syncSessionCount } from './profile-sync.service.js'

// ---------------------------------------------------------------------------
// Tests: recalculateCodProfile
// ---------------------------------------------------------------------------

describe('recalculateCodProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets codOrderCount, acceptance rate and rejection rate from COD order statuses', async () => {
    vi.mocked(prisma.codOrder.findMany).mockResolvedValue([
      { status: 'DELIVERED' },
      { status: 'DELIVERED' },
      { status: 'RETURNED' },
    ] as never)
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never)

    await recalculateCodProfile('merch_1', 'cust_1')

    expect(prisma.customer.update).toHaveBeenCalledTimes(1)
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust_1', merchantId: 'merch_1' },
        data: expect.objectContaining({
          codOrderCount: 3,
        }),
      }),
    )

    // Extract the actual data argument to check rates with toBeCloseTo
    const callArgs = vi.mocked(prisma.customer.update).mock.calls[0]
    // callArgs is [arg0] where arg0 is the Prisma update input object
    const updateInput = callArgs?.[0] as {
      data: { codAcceptanceRate: number; codRejectionRate: number }
    }
    expect(updateInput.data.codAcceptanceRate).toBeCloseTo(2 / 3, 10)
    expect(updateInput.data.codRejectionRate).toBeCloseTo(1 / 3, 10)
  })

  it('sets null rates when no COD orders exist', async () => {
    vi.mocked(prisma.codOrder.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never)

    await recalculateCodProfile('merch_1', 'cust_1')

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust_1', merchantId: 'merch_1' },
        data: expect.objectContaining({
          codOrderCount: 0,
          codAcceptanceRate: null,
          codRejectionRate: null,
        }),
      }),
    )
  })

  it('does not throw if prisma update fails', async () => {
    vi.mocked(prisma.codOrder.findMany).mockResolvedValue([{ status: 'DELIVERED' }] as never)
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('DB error'))

    // The service swallows errors (fire-and-forget pattern)
    await expect(recalculateCodProfile('merch_1', 'cust_1')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Tests: syncSessionCount
// ---------------------------------------------------------------------------

describe('syncSessionCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries ClickHouse and updates session count in PostgreSQL', async () => {
    vi.mocked(clickhouse.query).mockResolvedValue({
      json: async () => [{ session_count: '8' }],
    } as never)
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never)

    await syncSessionCount('merch_1', 'cust_1', [])

    expect(prisma.customer.update).toHaveBeenCalledTimes(1)
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust_1', merchantId: 'merch_1' },
        data: expect.objectContaining({
          sessionCount: 8,
        }),
      }),
    )
  })

  it('does not throw if ClickHouse is unavailable', async () => {
    vi.mocked(clickhouse.query).mockRejectedValue(new Error('ClickHouse connection refused'))

    // The service swallows errors (fire-and-forget pattern)
    await expect(syncSessionCount('merch_1', 'cust_1', [])).resolves.toBeUndefined()
  })
})
