import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    merchant: { findFirst: vi.fn() },
    agencyAssignment: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
}))

import { createAssignment, removeAssignment } from './assignments.service.js'
import { isAppError } from '../rbac/errors.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> }
  merchant: { findFirst: ReturnType<typeof vi.fn> }
  agencyAssignment: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> }
}

const AGENCY = 'agency_home'
const MEMBER = 'member_1'
const CHILD = 'child_a'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createAssignment', () => {
  it('rejects a user who is not part of this agency', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)
    await expect(
      createAssignment(AGENCY, { userId: MEMBER, childMerchantId: CHILD }, 'admin'),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'USER_NOT_FOUND')
  })

  it('rejects assigning a non-member (admins already have full access)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: MEMBER, role: 'AGENCY_ADMIN' })
    await expect(
      createAssignment(AGENCY, { userId: MEMBER, childMerchantId: CHILD }, 'admin'),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'INVALID_ASSIGNEE')
  })

  it('rejects a child that is not owned by this agency (tenant safety)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: MEMBER, role: 'AGENCY_MEMBER' })
    mockPrisma.merchant.findFirst.mockResolvedValue(null)
    await expect(
      createAssignment(AGENCY, { userId: MEMBER, childMerchantId: 'foreign_child' }, 'admin'),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'CHILD_NOT_FOUND')
  })

  it('creates when member + child both belong to the agency', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: MEMBER, role: 'AGENCY_MEMBER' })
    mockPrisma.merchant.findFirst.mockResolvedValue({ id: CHILD })
    mockPrisma.agencyAssignment.upsert.mockResolvedValue({
      id: 'asg_1',
      userId: MEMBER,
      childMerchantId: CHILD,
      createdAt: new Date('2026-07-03'),
      childMerchant: { name: 'Client A' },
    })
    const view = await createAssignment(AGENCY, { userId: MEMBER, childMerchantId: CHILD }, 'admin')
    expect(view).toMatchObject({ id: 'asg_1', childMerchantName: 'Client A' })
    // scoped create carries the agency id + createdBy
    expect(mockPrisma.agencyAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ agencyMerchantId: AGENCY, createdBy: 'admin' }),
      }),
    )
  })
})

describe('removeAssignment', () => {
  it('deletes scoped by agency', async () => {
    mockPrisma.agencyAssignment.deleteMany.mockResolvedValue({ count: 1 })
    await expect(
      removeAssignment(AGENCY, { userId: MEMBER, childMerchantId: CHILD }),
    ).resolves.toBeUndefined()
    expect(mockPrisma.agencyAssignment.deleteMany).toHaveBeenCalledWith({
      where: { agencyMerchantId: AGENCY, userId: MEMBER, childMerchantId: CHILD },
    })
  })

  it('404s when nothing was deleted (wrong agency / no such row)', async () => {
    mockPrisma.agencyAssignment.deleteMany.mockResolvedValue({ count: 0 })
    await expect(
      removeAssignment(AGENCY, { userId: MEMBER, childMerchantId: CHILD }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'ASSIGNMENT_NOT_FOUND')
  })
})
