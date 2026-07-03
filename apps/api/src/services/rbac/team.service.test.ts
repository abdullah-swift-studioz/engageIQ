import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}))
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed') } }))

import {
  assertActorCanAssignRole,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from './team.service.js'
import { isAppError } from './errors.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  user: Record<'findFirst' | 'findUnique' | 'create' | 'update' | 'delete' | 'count', ReturnType<typeof vi.fn>>
}

const M = 'merchant_1'
beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertActorCanAssignRole', () => {
  it('allows OWNER to assign OWNER', () => {
    expect(() => assertActorCanAssignRole('OWNER', 'OWNER')).not.toThrow()
  })
  it('blocks ADMIN from assigning OWNER', () => {
    expect(() => assertActorCanAssignRole('ADMIN', 'OWNER')).toThrow()
  })
  it('allows ADMIN to assign MARKETER', () => {
    expect(() => assertActorCanAssignRole('ADMIN', 'MARKETER')).not.toThrow()
  })
})

describe('createTeamMember', () => {
  it('rejects a duplicate email with 409', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'exists' })
    await expect(
      createTeamMember(M, { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'MARKETER', password: 'x' }, { userId: 'admin', role: 'ADMIN' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'EMAIL_IN_USE')
  })

  it('blocks a non-owner from creating an OWNER', async () => {
    await expect(
      createTeamMember(M, { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'OWNER', password: 'x' }, { userId: 'admin', role: 'ADMIN' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'OWNER_ONLY')
  })

  it('creates when valid', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    mockPrisma.user.create.mockResolvedValue({
      id: 'u2', email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'MARKETER', isActive: true, lastLoginAt: null, createdAt: new Date('2026-01-01'),
    })
    const m = await createTeamMember(M, { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'MARKETER', password: 'x' }, { userId: 'owner', role: 'OWNER' })
    expect(m.role).toBe('MARKETER')
    expect(m.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('updateTeamMember — owner safety', () => {
  it('blocks demoting the last active owner', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'owner1', role: 'OWNER', isActive: true })
    mockPrisma.user.count.mockResolvedValue(0) // no other active owners
    await expect(
      updateTeamMember(M, 'owner1', { role: 'ADMIN' }, { userId: 'owner1', role: 'OWNER' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'LAST_OWNER')
  })

  it('allows demoting an owner when another active owner exists', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'owner1', role: 'OWNER', isActive: true })
    mockPrisma.user.count.mockResolvedValue(1)
    mockPrisma.user.update.mockResolvedValue({
      id: 'owner1', email: 'o@b.com', firstName: 'O', lastName: 'B', role: 'ADMIN', isActive: true, lastLoginAt: null, createdAt: new Date('2026-01-01'),
    })
    const m = await updateTeamMember(M, 'owner1', { role: 'ADMIN' }, { userId: 'owner2', role: 'OWNER' })
    expect(m.role).toBe('ADMIN')
  })

  it('blocks an ADMIN from changing an existing OWNER', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'owner1', role: 'OWNER', isActive: true })
    await expect(
      updateTeamMember(M, 'owner1', { role: 'ADMIN' }, { userId: 'admin', role: 'ADMIN' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'OWNER_ONLY')
  })

  it('blocks deactivating your own account', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'me', role: 'ADMIN', isActive: true })
    await expect(
      updateTeamMember(M, 'me', { isActive: false }, { userId: 'me', role: 'ADMIN' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'CANNOT_DEACTIVATE_SELF')
  })
})

describe('deleteTeamMember', () => {
  it('blocks deleting yourself', async () => {
    await expect(
      deleteTeamMember(M, 'me', { userId: 'me', role: 'OWNER' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'CANNOT_DELETE_SELF')
  })

  it('blocks deleting the last owner', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'owner1', role: 'OWNER' })
    mockPrisma.user.count.mockResolvedValue(0)
    await expect(
      deleteTeamMember(M, 'owner1', { userId: 'owner2', role: 'OWNER' }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === 'LAST_OWNER')
  })
})
