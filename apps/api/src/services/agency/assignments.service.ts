import { prisma } from '@engageiq/db'
import type { AgencyAssignmentView } from '@engageiq/shared'
import { appError } from '../rbac/errors.js'

/**
 * Agency-member ⇄ child-merchant assignments (guide §9.4). An AGENCY_ADMIN grants
 * an AGENCY_MEMBER access to specific client accounts. All queries are scoped by
 * the acting agency merchant (`agencyMerchantId`) for tenant safety.
 */

function toView(row: {
  id: string
  userId: string
  childMerchantId: string
  createdAt: Date
  childMerchant: { name: string }
}): AgencyAssignmentView {
  return {
    id: row.id,
    userId: row.userId,
    childMerchantId: row.childMerchantId,
    childMerchantName: row.childMerchant.name,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listAssignments(
  agencyMerchantId: string,
  userId?: string,
): Promise<AgencyAssignmentView[]> {
  const rows = await prisma.agencyAssignment.findMany({
    where: { agencyMerchantId, ...(userId ? { userId } : {}) },
    select: {
      id: true,
      userId: true,
      childMerchantId: true,
      createdAt: true,
      childMerchant: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toView)
}

export async function createAssignment(
  agencyMerchantId: string,
  input: { userId: string; childMerchantId: string },
  createdBy: string,
): Promise<AgencyAssignmentView> {
  // The member must be a user of THIS agency (the parent merchant).
  const member = await prisma.user.findFirst({
    where: { id: input.userId, merchantId: agencyMerchantId },
    select: { id: true, role: true },
  })
  if (!member) throw appError(404, 'USER_NOT_FOUND', 'That user is not part of this agency')
  if (member.role !== 'AGENCY_MEMBER') {
    throw appError(
      400,
      'INVALID_ASSIGNEE',
      'Only AGENCY_MEMBER users are assigned to specific clients; agency admins already have access to all clients',
    )
  }

  // The child must be a client (child merchant) of this agency.
  const child = await prisma.merchant.findFirst({
    where: { id: input.childMerchantId, agencyId: agencyMerchantId },
    select: { id: true },
  })
  if (!child) throw appError(404, 'CHILD_NOT_FOUND', 'That client account does not belong to this agency')

  const row = await prisma.agencyAssignment.upsert({
    where: {
      userId_childMerchantId: { userId: input.userId, childMerchantId: input.childMerchantId },
    },
    update: {},
    create: {
      agencyMerchantId,
      userId: input.userId,
      childMerchantId: input.childMerchantId,
      createdBy,
    },
    select: {
      id: true,
      userId: true,
      childMerchantId: true,
      createdAt: true,
      childMerchant: { select: { name: true } },
    },
  })
  return toView(row)
}

export async function removeAssignment(
  agencyMerchantId: string,
  input: { userId: string; childMerchantId: string },
): Promise<void> {
  // Scope the delete by agency so an admin can never touch another agency's rows.
  const result = await prisma.agencyAssignment.deleteMany({
    where: {
      agencyMerchantId,
      userId: input.userId,
      childMerchantId: input.childMerchantId,
    },
  })
  if (result.count === 0) {
    throw appError(404, 'ASSIGNMENT_NOT_FOUND', 'No such assignment')
  }
}
