import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @engageiq/db BEFORE importing the service (Vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    segmentMembership: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    journeyEnrollment: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      updateMany: vi.fn(),
    },
    codOrder: {
      updateMany: vi.fn(),
    },
    abandonedCheckout: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@engageiq/db'
import type { MergeResult } from '@engageiq/shared'
import { mergeCustomers } from '../services/merge.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCustomer(overrides?: Partial<{
  id: string
  merchantId: string
  createdAt: Date
  mergedIntoId: string | null
  anonIds: string[]
}>) {
  return {
    id: overrides?.id ?? 'customer-1',
    merchantId: overrides?.merchantId ?? 'merchant-1',
    createdAt: overrides?.createdAt ?? new Date('2024-01-01T00:00:00Z'),
    mergedIntoId: overrides?.mergedIntoId ?? null,
    anonIds: overrides?.anonIds ?? [],
  }
}

/**
 * Sets up the standard happy-path mocks for prisma.$transaction.
 * The transaction callback receives prisma itself as the tx client.
 * All inner tx calls resolve to sensible defaults unless overridden.
 */
function setupTransactionMock() {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    // Pass prisma itself as the tx mock so inner tx.* calls use the same spies
    return (callback as (tx: typeof prisma) => Promise<unknown>)(prisma)
  })

  // Default: canonical has no overlapping segment memberships
  vi.mocked(prisma.segmentMembership.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.segmentMembership.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.segmentMembership.updateMany).mockResolvedValue({ count: 0 } as never)

  // Default: canonical has no overlapping journey enrollments
  vi.mocked(prisma.journeyEnrollment.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.journeyEnrollment.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.journeyEnrollment.updateMany).mockResolvedValue({ count: 0 } as never)

  vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.codOrder.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.abandonedCheckout.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.customer.update).mockResolvedValue({} as never)
}

// ---------------------------------------------------------------------------
// Tests: mergeCustomers
// ---------------------------------------------------------------------------

describe('mergeCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Test 1 — Older customer becomes canonical
  // -------------------------------------------------------------------------
  it('makes the older customer canonical', async () => {
    const yesterday = new Date('2024-01-01T00:00:00Z')
    const today = new Date('2024-06-01T00:00:00Z')

    const customer1 = makeCustomer({ id: 'customer-1', createdAt: today })
    const customer2 = makeCustomer({ id: 'customer-2', createdAt: yesterday })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(customer1 as never)
      .mockResolvedValueOnce(customer2 as never)

    setupTransactionMock()

    const result = await mergeCustomers('merchant-1', 'customer-1', 'customer-2')

    // customer2 is older (yesterday) — it should be canonical
    expect(result.canonicalId).toBe('customer-2')
    expect(result.secondaryId).toBe('customer-1')
  })

  // -------------------------------------------------------------------------
  // Test 2 — id1 is canonical on tie (same createdAt)
  // -------------------------------------------------------------------------
  it('makes id1 canonical when both customers have the same createdAt', async () => {
    const sameDate = new Date('2024-03-15T12:00:00Z')

    const customer1 = makeCustomer({ id: 'customer-1', createdAt: sameDate })
    const customer2 = makeCustomer({ id: 'customer-2', createdAt: sameDate })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(customer1 as never)
      .mockResolvedValueOnce(customer2 as never)

    setupTransactionMock()

    const result = await mergeCustomers('merchant-1', 'customer-1', 'customer-2')

    expect(result.canonicalId).toBe('customer-1')
    expect(result.secondaryId).toBe('customer-2')
  })

  // -------------------------------------------------------------------------
  // Test 3 — All relation types are migrated to the canonical customer
  // -------------------------------------------------------------------------
  it('migrates order, codOrder, and abandonedCheckout records to canonical', async () => {
    const canonical = makeCustomer({ id: 'canonical-id', createdAt: new Date('2023-01-01') })
    const secondary = makeCustomer({ id: 'secondary-id', createdAt: new Date('2024-01-01') })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(canonical as never)
      .mockResolvedValueOnce(secondary as never)

    setupTransactionMock()

    await mergeCustomers('merchant-1', 'canonical-id', 'secondary-id')

    const migrationArgs = { where: { customerId: 'secondary-id' }, data: { customerId: 'canonical-id' } }

    expect(prisma.order.updateMany).toHaveBeenCalledWith(migrationArgs)
    expect(prisma.codOrder.updateMany).toHaveBeenCalledWith(migrationArgs)
    expect(prisma.abandonedCheckout.updateMany).toHaveBeenCalledWith(migrationArgs)
  })

  // -------------------------------------------------------------------------
  // Test 4 — anonIds are merged and deduplicated
  // -------------------------------------------------------------------------
  it('merges and deduplicates anonIds from both customers on the canonical', async () => {
    const canonical = makeCustomer({
      id: 'canonical-id',
      createdAt: new Date('2023-01-01'),
      anonIds: ['anon-a', 'anon-b'],
    })
    const secondary = makeCustomer({
      id: 'secondary-id',
      createdAt: new Date('2024-01-01'),
      anonIds: ['anon-b', 'anon-c'],
    })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(canonical as never)
      .mockResolvedValueOnce(secondary as never)

    setupTransactionMock()

    await mergeCustomers('merchant-1', 'canonical-id', 'secondary-id')

    // Find the customer.update call for the canonical (anonIds merge)
    const updateCalls = vi.mocked(prisma.customer.update).mock.calls
    const canonicalUpdateCall = updateCalls.find(
      (call) => (call[0] as { where: { id: string } }).where.id === 'canonical-id',
    )

    expect(canonicalUpdateCall).toBeDefined()
    const updatedAnonIds: string[] = (canonicalUpdateCall![0] as { data: { anonIds: string[] } }).data.anonIds
    expect(updatedAnonIds).toHaveLength(3)
    expect(updatedAnonIds).toContain('anon-a')
    expect(updatedAnonIds).toContain('anon-b')
    expect(updatedAnonIds).toContain('anon-c')
  })

  // -------------------------------------------------------------------------
  // Test 5 — Secondary is marked as merged
  // -------------------------------------------------------------------------
  it('sets mergedIntoId and mergedAt on the secondary customer', async () => {
    const canonical = makeCustomer({ id: 'canonical-id', createdAt: new Date('2023-01-01') })
    const secondary = makeCustomer({ id: 'secondary-id', createdAt: new Date('2024-01-01') })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(canonical as never)
      .mockResolvedValueOnce(secondary as never)

    setupTransactionMock()

    await mergeCustomers('merchant-1', 'canonical-id', 'secondary-id')

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'secondary-id' },
        data: expect.objectContaining({
          mergedIntoId: 'canonical-id',
          mergedAt: expect.any(Date),
        }),
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Test 6 — Returns correct MergeResult shape
  // -------------------------------------------------------------------------
  it('returns a MergeResult with correct shape and types', async () => {
    const canonical = makeCustomer({ id: 'canonical-id', createdAt: new Date('2023-01-01') })
    const secondary = makeCustomer({ id: 'secondary-id', createdAt: new Date('2024-01-01') })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(canonical as never)
      .mockResolvedValueOnce(secondary as never)

    setupTransactionMock()

    const result: MergeResult = await mergeCustomers(
      'merchant-1',
      'canonical-id',
      'secondary-id',
      'manual_dashboard_merge',
    )

    expect(result).toMatchObject({
      canonicalId: 'canonical-id',
      secondaryId: 'secondary-id',
      mergedAt: expect.any(String),
      mergeReason: 'manual_dashboard_merge',
    })

    // mergedAt must be a valid ISO 8601 string
    expect(() => new Date(result.mergedAt)).not.toThrow()
    expect(new Date(result.mergedAt).toISOString()).toBe(result.mergedAt)
  })

  // -------------------------------------------------------------------------
  // Test 7 — Throws MERGE_SAME_CUSTOMER when id1 === id2
  // -------------------------------------------------------------------------
  it('throws MERGE_SAME_CUSTOMER when id1 and id2 are identical', async () => {
    await expect(
      mergeCustomers('merchant-1', 'same-id', 'same-id'),
    ).rejects.toThrow('MERGE_SAME_CUSTOMER')

    // Should not reach the DB at all
    expect(prisma.customer.findFirst).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Test 8 — Throws CUSTOMER_NOT_FOUND when a customer doesn't exist
  // -------------------------------------------------------------------------
  it('throws CUSTOMER_NOT_FOUND when one of the customers does not exist', async () => {
    // First findFirst returns null — customer doesn't exist
    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeCustomer({ id: 'customer-2' }) as never)

    await expect(
      mergeCustomers('merchant-1', 'nonexistent-id', 'customer-2'),
    ).rejects.toThrow('CUSTOMER_NOT_FOUND')

    // Transaction should not have been attempted
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Test 9 — Throws CUSTOMER_ALREADY_MERGED when customer has mergedIntoId
  // -------------------------------------------------------------------------
  it('throws CUSTOMER_ALREADY_MERGED when a customer is already merged into another', async () => {
    const alreadyMerged = makeCustomer({
      id: 'customer-1',
      mergedIntoId: 'some-other-customer-id',
    })
    const validCustomer = makeCustomer({ id: 'customer-2' })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(alreadyMerged as never)
      .mockResolvedValueOnce(validCustomer as never)

    await expect(
      mergeCustomers('merchant-1', 'customer-1', 'customer-2'),
    ).rejects.toThrow('CUSTOMER_ALREADY_MERGED')

    // Transaction should not have been attempted
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Test 10 — SegmentMembership deduplication: deletes conflicting secondary memberships
  // -------------------------------------------------------------------------
  it('deletes secondary segment memberships that overlap with canonical before migrating', async () => {
    const canonical = makeCustomer({ id: 'canonical-id', createdAt: new Date('2023-01-01') })
    const secondary = makeCustomer({ id: 'secondary-id', createdAt: new Date('2024-01-01') })

    vi.mocked(prisma.customer.findFirst)
      .mockResolvedValueOnce(canonical as never)
      .mockResolvedValueOnce(secondary as never)

    setupTransactionMock()

    // Override: canonical already has an active membership for segment-1
    vi.mocked(prisma.segmentMembership.findMany).mockResolvedValue([
      { segmentId: 'segment-1' },
    ] as never)

    await mergeCustomers('merchant-1', 'canonical-id', 'secondary-id')

    // Secondary's conflicting membership for segment-1 must be deleted first
    expect(prisma.segmentMembership.deleteMany).toHaveBeenCalledWith({
      where: {
        customerId: 'secondary-id',
        segmentId: { in: ['segment-1'] },
      },
    })

    // Then remaining secondary memberships are migrated to canonical
    expect(prisma.segmentMembership.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'secondary-id' },
      data: { customerId: 'canonical-id' },
    })
  })
})
