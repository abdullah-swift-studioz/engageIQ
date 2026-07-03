import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    merchant: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    agencyAssignment: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))

import {
  listAccessibleMerchants,
  assertChildAccess,
  resolveActingMerchant,
  getReportableMerchantIds,
  AgencyAccessError,
} from './access.service.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  merchant: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
  agencyAssignment: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
}

const HOME = 'agency_home'
const CHILD_A = 'child_a'
const CHILD_B = 'child_b'

function homeRow() {
  return { id: HOME, name: 'Acme Agency', shopifyDomain: null, isActive: true }
}
function childRow(id: string, name: string) {
  return { id, name, shopifyDomain: `${name}.myshopify.com`, isActive: true }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.merchant.findUnique.mockResolvedValue(homeRow())
})

describe('listAccessibleMerchants', () => {
  it('non-agency role sees only its home merchant', async () => {
    const owner = { userId: 'u1', merchantId: HOME, role: 'OWNER' as const }
    const list = await listAccessibleMerchants(owner)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: HOME, isHome: true })
    expect(mockPrisma.merchant.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.agencyAssignment.findMany).not.toHaveBeenCalled()
  })

  it('AGENCY_ADMIN sees home + all children of the agency', async () => {
    mockPrisma.merchant.findMany.mockResolvedValue([childRow(CHILD_A, 'a'), childRow(CHILD_B, 'b')])
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    const list = await listAccessibleMerchants(admin)
    expect(mockPrisma.merchant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agencyId: HOME } }),
    )
    expect(list.map((m) => m.id)).toEqual([HOME, CHILD_A, CHILD_B])
    expect(list[0]).toMatchObject({ isHome: true })
    expect(list[1]).toMatchObject({ isHome: false })
  })

  it('AGENCY_MEMBER sees home + only assigned children', async () => {
    mockPrisma.agencyAssignment.findMany.mockResolvedValue([
      { childMerchant: childRow(CHILD_A, 'a') },
    ])
    const member = { userId: 'u3', merchantId: HOME, role: 'AGENCY_MEMBER' as const }
    const list = await listAccessibleMerchants(member)
    expect(mockPrisma.agencyAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u3', agencyMerchantId: HOME } }),
    )
    expect(list.map((m) => m.id)).toEqual([HOME, CHILD_A])
  })
})

describe('assertChildAccess', () => {
  it('AGENCY_ADMIN may access a child that belongs to its agency', async () => {
    mockPrisma.merchant.findFirst.mockResolvedValue(childRow(CHILD_A, 'a'))
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    await expect(assertChildAccess(admin, CHILD_A)).resolves.toBeUndefined()
    expect(mockPrisma.merchant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CHILD_A, agencyId: HOME } }),
    )
  })

  it('AGENCY_ADMIN is denied a child of a DIFFERENT agency', async () => {
    mockPrisma.merchant.findFirst.mockResolvedValue(null)
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    await expect(assertChildAccess(admin, 'other_child')).rejects.toBeInstanceOf(AgencyAccessError)
  })

  it('AGENCY_MEMBER may access an assigned child', async () => {
    mockPrisma.agencyAssignment.findUnique.mockResolvedValue({
      userId: 'u3',
      childMerchantId: CHILD_A,
      agencyMerchantId: HOME,
    })
    const member = { userId: 'u3', merchantId: HOME, role: 'AGENCY_MEMBER' as const }
    await expect(assertChildAccess(member, CHILD_A)).resolves.toBeUndefined()
  })

  it('AGENCY_MEMBER is denied an unassigned child', async () => {
    mockPrisma.agencyAssignment.findUnique.mockResolvedValue(null)
    const member = { userId: 'u3', merchantId: HOME, role: 'AGENCY_MEMBER' as const }
    await expect(assertChildAccess(member, CHILD_B)).rejects.toBeInstanceOf(AgencyAccessError)
  })

  it('AGENCY_MEMBER is denied a child assigned under a different agency (tenant safety)', async () => {
    mockPrisma.agencyAssignment.findUnique.mockResolvedValue({
      userId: 'u3',
      childMerchantId: CHILD_A,
      agencyMerchantId: 'some_other_agency',
    })
    const member = { userId: 'u3', merchantId: HOME, role: 'AGENCY_MEMBER' as const }
    await expect(assertChildAccess(member, CHILD_A)).rejects.toBeInstanceOf(AgencyAccessError)
  })

  it('a non-agency role is denied any child that is not its home', async () => {
    const owner = { userId: 'u1', merchantId: HOME, role: 'OWNER' as const }
    await expect(assertChildAccess(owner, CHILD_A)).rejects.toBeInstanceOf(AgencyAccessError)
  })

  it('accessing your own home merchant is always allowed', async () => {
    const owner = { userId: 'u1', merchantId: HOME, role: 'OWNER' as const }
    await expect(assertChildAccess(owner, HOME)).resolves.toBeUndefined()
  })
})

describe('resolveActingMerchant', () => {
  it('returns home when no child is requested', async () => {
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    expect(await resolveActingMerchant(admin, undefined)).toBe(HOME)
    expect(await resolveActingMerchant(admin, '')).toBe(HOME)
  })

  it('returns the child when access is verified', async () => {
    mockPrisma.merchant.findFirst.mockResolvedValue(childRow(CHILD_A, 'a'))
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    expect(await resolveActingMerchant(admin, CHILD_A)).toBe(CHILD_A)
  })

  it('throws when access is not verified', async () => {
    mockPrisma.merchant.findFirst.mockResolvedValue(null)
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    await expect(resolveActingMerchant(admin, 'nope')).rejects.toBeInstanceOf(AgencyAccessError)
  })
})

describe('getReportableMerchantIds', () => {
  it('returns the accessible child ids (excluding the agency container home)', async () => {
    mockPrisma.merchant.findMany.mockResolvedValue([childRow(CHILD_A, 'a'), childRow(CHILD_B, 'b')])
    const admin = { userId: 'u2', merchantId: HOME, role: 'AGENCY_ADMIN' as const }
    const ids = await getReportableMerchantIds(admin)
    expect(ids).toEqual([CHILD_A, CHILD_B])
  })
})
