import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@engageiq/db'
import { assignGroupCustomerId, getGroupMembers } from './multi-store.service.js'

describe('assignGroupCustomerId', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does nothing for a standalone merchant (no agency, no children)', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ id: 'm1', agencyId: null } as never)
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([])

    await assignGroupCustomerId('c1', 'm1', 'a@b.com', null)

    expect(prisma.customer.findFirst).not.toHaveBeenCalled()
    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('does nothing when no cross-store match found', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ id: 'm1', agencyId: 'agency-1' } as never)
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([{ id: 'm2' }, { id: 'm1' }] as never)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)

    await assignGroupCustomerId('c1', 'm1', 'a@b.com', null)

    expect(prisma.customer.update).not.toHaveBeenCalled()
  })

  it('creates a new groupCustomerId and assigns to both when match has no existing group', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ id: 'm1', agencyId: 'agency-1' } as never)
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([{ id: 'm2' }, { id: 'm1' }] as never)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'c2', groupCustomerId: null } as never)
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never)

    await assignGroupCustomerId('c1', 'm1', 'a@b.com', null)

    expect(prisma.customer.update).toHaveBeenCalledTimes(2)
    const call1 = vi.mocked(prisma.customer.update).mock.calls[0]![0]
    const call2 = vi.mocked(prisma.customer.update).mock.calls[1]![0]
    expect(call1.data.groupCustomerId).toBeTruthy()
    expect(call1.data.groupCustomerId).toBe(call2.data.groupCustomerId)
    const ids = [call1.where.id, call2.where.id]
    expect(ids).toContain('c1')
    expect(ids).toContain('c2')
  })

  it('joins the existing group when the match already has a groupCustomerId', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ id: 'm1', agencyId: 'agency-1' } as never)
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([{ id: 'm2' }, { id: 'm1' }] as never)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'c2', groupCustomerId: 'existing-group-uuid' } as never)
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never)

    await assignGroupCustomerId('c1', 'm1', 'a@b.com', null)

    expect(prisma.customer.update).toHaveBeenCalledOnce()
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { groupCustomerId: 'existing-group-uuid' },
    })
  })

  it('does nothing when neither email nor phone provided', async () => {
    await assignGroupCustomerId('c1', 'm1', null, null)
    expect(prisma.merchant.findUnique).not.toHaveBeenCalled()
  })
})

describe('getGroupMembers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns group members from accessible merchants only', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ id: 'm1', agencyId: 'agency-1' } as never)
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([{ id: 'm2' }, { id: 'm1' }] as never)
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      {
        id: 'c1',
        merchantId: 'm1',
        email: 'a@b.com',
        phone: null,
        firstName: 'Ali',
        lastName: 'Khan',
        totalOrders: 3,
        totalSpent: { toString: () => '1500.00' },
        createdAt: new Date('2024-01-01T00:00:00Z'),
        merchant: { id: 'm1', name: 'Store A' },
      },
      {
        id: 'c2',
        merchantId: 'm2',
        email: 'a@b.com',
        phone: null,
        firstName: 'Ali',
        lastName: 'Khan',
        totalOrders: 1,
        totalSpent: { toString: () => '500.00' },
        createdAt: new Date('2024-02-01T00:00:00Z'),
        merchant: { id: 'm2', name: 'Store B' },
      },
    ] as never)

    const members = await getGroupMembers('group-uuid-1', 'm1')

    expect(members).toHaveLength(2)
    expect(members[0]).toMatchObject({
      customerId: 'c1',
      merchantId: 'm1',
      merchantName: 'Store A',
      totalSpent: '1500.00',
    })
    expect(members[1]).toMatchObject({ customerId: 'c2', merchantName: 'Store B' })
  })

  it('returns empty array when group has no accessible members', async () => {
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ id: 'm1', agencyId: null } as never)
    vi.mocked(prisma.merchant.findMany).mockResolvedValue([])
    vi.mocked(prisma.customer.findMany).mockResolvedValue([])

    const members = await getGroupMembers('group-uuid-1', 'm1')
    expect(members).toEqual([])
  })
})
