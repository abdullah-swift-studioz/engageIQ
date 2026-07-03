import type { FastifyRequest, FastifyReply } from 'fastify'
import { ROLE_PERMISSIONS } from '@engageiq/shared'
import {
  listTeam,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  isAppError,
} from '../../services/rbac/index.js'
import {
  CreateTeamMemberBodySchema,
  UpdateTeamMemberBodySchema,
  UserParamsSchema,
} from './schema.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

function sendAppError(reply: FastifyReply, err: unknown) {
  if (isAppError(err)) {
    return reply.status(err.statusCode).send({
      success: false,
      error: { code: err.code, message: err.message },
    })
  }
  throw err
}

/** The serialized RBAC matrix, so the dashboard can render role capabilities. */
export async function getRolesHandler(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const roles = Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms].sort()]),
  )
  await reply.send({ success: true, data: { roles } })
}

export async function listTeamHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const members = await listTeam(request.user.merchantId)
  await reply.send({ success: true, data: { members } })
}

export async function createTeamMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CreateTeamMemberBodySchema.safeParse(request.body)
  if (!parsed.success) {
    return validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
  }
  try {
    const member = await createTeamMember(request.user.merchantId, parsed.data, {
      userId: request.user.userId,
      role: request.user.role,
    })
    await reply.status(201).send({ success: true, data: { member } })
  } catch (err) {
    await sendAppError(reply, err)
  }
}

export async function updateTeamMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = UserParamsSchema.safeParse(request.params)
  if (!params.success) return validationError(reply, 'Invalid user id')
  const parsed = UpdateTeamMemberBodySchema.safeParse(request.body)
  if (!parsed.success) {
    return validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
  }
  try {
    const member = await updateTeamMember(request.user.merchantId, params.data.id, parsed.data, {
      userId: request.user.userId,
      role: request.user.role,
    })
    await reply.send({ success: true, data: { member } })
  } catch (err) {
    await sendAppError(reply, err)
  }
}

export async function deleteTeamMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = UserParamsSchema.safeParse(request.params)
  if (!params.success) return validationError(reply, 'Invalid user id')
  try {
    await deleteTeamMember(request.user.merchantId, params.data.id, {
      userId: request.user.userId,
      role: request.user.role,
    })
    await reply.send({ success: true, data: { deleted: true } })
  } catch (err) {
    await sendAppError(reply, err)
  }
}
