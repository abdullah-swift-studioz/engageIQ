import { prisma } from '@engageiq/db'
import { isAgencyRole, type Role, type AccessibleMerchant } from '@engageiq/shared'

/**
 * Agency access resolution (roadmap 8.3 / guide §9.4).
 *
 * An "agency" is a Merchant that owns child (client) merchants via the
 * `Merchant.agencyId` self-relation. Agency dashboard users belong to the agency
 * (parent) merchant. Which clients a user may act on:
 *   - AGENCY_ADMIN  → every child of the agency (Merchant.agencyId === home)
 *   - AGENCY_MEMBER → only children granted via AgencyAssignment(userId, child)
 *   - any other role → only its own home merchant (no cross-tenant access)
 *
 * This module is the single authority that decides whether a user may operate on
 * a given merchant. The acting-merchant preHandler and the agency routes both go
 * through it, so tenant safety lives in exactly one place.
 */

export interface AgencyUser {
  userId: string
  /** the user's home merchant (the agency container, for agency users) */
  merchantId: string
  role: Role
}

/** Thrown when a user tries to act on a merchant they cannot access. */
export class AgencyAccessError extends Error {
  readonly statusCode = 403
  readonly code = 'AGENCY_ACCESS_DENIED'
  constructor(message = 'You do not have access to this account') {
    super(message)
    this.name = 'AgencyAccessError'
  }
}

interface MerchantRow {
  id: string
  name: string
  shopifyDomain: string | null
  isActive: boolean
}

const MERCHANT_SELECT = { id: true, name: true, shopifyDomain: true, isActive: true } as const

function toAccessible(row: MerchantRow, isHome: boolean): AccessibleMerchant {
  return {
    id: row.id,
    name: row.name,
    shopifyDomain: row.shopifyDomain,
    isActive: row.isActive,
    isHome,
  }
}

/** The full list of merchants this user can switch into, home first. */
export async function listAccessibleMerchants(user: AgencyUser): Promise<AccessibleMerchant[]> {
  const home = await prisma.merchant.findUnique({
    where: { id: user.merchantId },
    select: MERCHANT_SELECT,
  })
  const homeEntry: AccessibleMerchant[] = home ? [toAccessible(home, true)] : []

  if (!isAgencyRole(user.role)) {
    return homeEntry
  }

  const children = await listChildMerchants(user)
  return [...homeEntry, ...children.map((c) => toAccessible(c, false))]
}

/** The child (client) merchants this agency user may access — excludes the home container. */
async function listChildMerchants(user: AgencyUser): Promise<MerchantRow[]> {
  if (user.role === 'AGENCY_ADMIN') {
    return prisma.merchant.findMany({
      where: { agencyId: user.merchantId },
      select: MERCHANT_SELECT,
      orderBy: { name: 'asc' },
    })
  }
  if (user.role === 'AGENCY_MEMBER') {
    const assignments = await prisma.agencyAssignment.findMany({
      where: { userId: user.userId, agencyMerchantId: user.merchantId },
      select: { childMerchant: { select: MERCHANT_SELECT } },
      orderBy: { childMerchant: { name: 'asc' } },
    })
    return assignments.map((a) => a.childMerchant)
  }
  return []
}

/**
 * Throw AgencyAccessError unless `user` may act on `merchantId`.
 * Accessing your own home merchant is always allowed.
 */
export async function assertChildAccess(user: AgencyUser, merchantId: string): Promise<void> {
  if (merchantId === user.merchantId) return

  if (user.role === 'AGENCY_ADMIN') {
    const child = await prisma.merchant.findFirst({
      where: { id: merchantId, agencyId: user.merchantId },
      select: { id: true },
    })
    if (!child) throw new AgencyAccessError()
    return
  }

  if (user.role === 'AGENCY_MEMBER') {
    const assignment = await prisma.agencyAssignment.findUnique({
      where: { userId_childMerchantId: { userId: user.userId, childMerchantId: merchantId } },
      select: { agencyMerchantId: true },
    })
    // Belt-and-braces: the assignment must belong to THIS user's agency.
    if (!assignment || assignment.agencyMerchantId !== user.merchantId) {
      throw new AgencyAccessError()
    }
    return
  }

  // Non-agency roles cannot reach any merchant other than their home.
  throw new AgencyAccessError()
}

/**
 * Resolve the effective merchant a request should be scoped to.
 * Returns the home merchant when no child is requested; otherwise validates
 * access and returns the requested child.
 */
export async function resolveActingMerchant(
  user: AgencyUser,
  requestedMerchantId: string | undefined | null,
): Promise<string> {
  if (!requestedMerchantId || requestedMerchantId === user.merchantId) {
    return user.merchantId
  }
  await assertChildAccess(user, requestedMerchantId)
  return requestedMerchantId
}

/** The child-merchant ids an agency user can run cross-client reports across. */
export async function getReportableMerchantIds(user: AgencyUser): Promise<string[]> {
  if (!isAgencyRole(user.role)) return []
  const children = await listChildMerchants(user)
  return children.map((c) => c.id)
}
