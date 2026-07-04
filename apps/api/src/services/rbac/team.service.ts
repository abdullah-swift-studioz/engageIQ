import { prisma } from '@engageiq/db'
import bcrypt from 'bcryptjs'
import type {
  Role,
  TeamMember,
  CreateTeamMemberInput,
  UpdateTeamMemberInput,
} from '@engageiq/shared'
import { appError } from './errors.js'

/**
 * Team (users & roles) management for a single merchant (guide §9.4).
 * All queries are scoped by merchantId. Owner-safety rules:
 *   - only an OWNER may grant or change the OWNER role,
 *   - the last active OWNER can't be demoted/deactivated/deleted (lock-out guard),
 *   - a user can't deactivate or delete themselves.
 */

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const

interface UserRow {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Role
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

function toMember(row: UserRow): TeamMember {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Pure guard: only an OWNER may hand out (or move a user to) the OWNER role. */
export function assertActorCanAssignRole(actorRole: Role, targetRole: Role): void {
  if (targetRole === 'OWNER' && actorRole !== 'OWNER') {
    throw appError(403, 'OWNER_ONLY', 'Only an owner can grant the Owner role')
  }
}

export async function listTeam(merchantId: string): Promise<TeamMember[]> {
  const rows = await prisma.user.findMany({
    where: { merchantId },
    select: USER_SELECT,
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toMember)
}

export async function createTeamMember(
  merchantId: string,
  input: CreateTeamMemberInput,
  actor: { userId: string; role: Role },
): Promise<TeamMember> {
  assertActorCanAssignRole(actor.role, input.role)

  const existing = await prisma.user.findUnique({
    where: { merchantId_email: { merchantId, email: input.email } },
    select: { id: true },
  })
  if (existing) throw appError(409, 'EMAIL_IN_USE', 'A user with that email already exists')

  const passwordHash = await bcrypt.hash(input.password, 12)
  const row = await prisma.user.create({
    data: {
      merchantId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      passwordHash,
    },
    select: USER_SELECT,
  })
  return toMember(row)
}

export async function updateTeamMember(
  merchantId: string,
  targetUserId: string,
  input: UpdateTeamMemberInput,
  actor: { userId: string; role: Role },
): Promise<TeamMember> {
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, merchantId },
    select: { id: true, role: true, isActive: true },
  })
  if (!target) throw appError(404, 'USER_NOT_FOUND', 'No such user')

  const deactivating = input.isActive === false && target.isActive
  const changingRole = input.role !== undefined && input.role !== target.role
  const demotingOwner = target.role === 'OWNER' && changingRole && input.role !== 'OWNER'

  if (changingRole && input.role) assertActorCanAssignRole(actor.role, input.role)
  // Only an owner may change an existing owner's role.
  if (target.role === 'OWNER' && changingRole && actor.role !== 'OWNER') {
    throw appError(403, 'OWNER_ONLY', 'Only an owner can change another owner')
  }

  // Lock-out guard: never remove the last active owner.
  if (demotingOwner || (deactivating && target.role === 'OWNER')) {
    await assertNotLastOwner(merchantId, targetUserId)
  }

  // Self-deactivation guard.
  if (deactivating && targetUserId === actor.userId) {
    throw appError(400, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account')
  }

  const row = await prisma.user.update({
    where: { id: targetUserId },
    data: {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    },
    select: USER_SELECT,
  })
  return toMember(row)
}

export async function deleteTeamMember(
  merchantId: string,
  targetUserId: string,
  actor: { userId: string; role: Role },
): Promise<void> {
  if (targetUserId === actor.userId) {
    throw appError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account')
  }
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, merchantId },
    select: { id: true, role: true },
  })
  if (!target) throw appError(404, 'USER_NOT_FOUND', 'No such user')
  if (target.role === 'OWNER') {
    if (actor.role !== 'OWNER') {
      throw appError(403, 'OWNER_ONLY', 'Only an owner can remove another owner')
    }
    await assertNotLastOwner(merchantId, targetUserId)
  }
  await prisma.user.delete({ where: { id: targetUserId } })
}

async function assertNotLastOwner(merchantId: string, excludingUserId: string): Promise<void> {
  const otherOwners = await prisma.user.count({
    where: {
      merchantId,
      role: 'OWNER',
      isActive: true,
      id: { not: excludingUserId },
    },
  })
  if (otherOwners === 0) {
    throw appError(400, 'LAST_OWNER', 'This is the last active owner — assign another owner first')
  }
}
