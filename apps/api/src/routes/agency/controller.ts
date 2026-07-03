import type { FastifyRequest, FastifyReply } from 'fastify'
import { isAgencyRole, type AgencyContext } from '@engageiq/shared'
import {
  listAccessibleMerchants,
  resolveActingMerchant,
  listAssignments,
  createAssignment,
  removeAssignment,
  buildAgencyClientReport,
  AgencyAccessError,
  type AgencyUser,
} from '../../services/agency/index.js'
import { isAppError } from '../../services/rbac/index.js'
import {
  SwitchBodySchema,
  AssignmentBodySchema,
  ListAssignmentsQuerySchema,
} from './schema.js'

/**
 * Build the "home" agency user for structure operations (list children, manage
 * assignments, report). We use `request.homeMerchantId` — set by the global
 * acting-merchant preHandler — so these operations always run against the agency
 * container, never a client the user has switched into.
 */
function homeUser(request: FastifyRequest): AgencyUser {
  return {
    userId: request.user.userId,
    merchantId: request.homeMerchantId ?? request.user.merchantId,
    role: request.user.role,
  }
}

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof AgencyAccessError) {
    return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } })
  }
  if (isAppError(err)) {
    return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } })
  }
  throw err
}

/** The agency context for the switcher: accessible accounts + which is active. */
export async function getContextHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = homeUser(request)
  const accessibleMerchants = await listAccessibleMerchants(user)
  const context: AgencyContext = {
    isAgency: isAgencyRole(user.role),
    homeMerchantId: user.merchantId,
    // The effective merchant the current request resolved to (post-switch).
    activeMerchantId: request.actingMerchantId ?? request.user.merchantId,
    accessibleMerchants,
  }
  await reply.send({ success: true, data: context })
}

/** Validate that the user may switch to `merchantId`; the client then sends it as the header. */
export async function switchHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = SwitchBodySchema.safeParse(request.body)
  if (!parsed.success) return validationError(reply, 'merchantId is required')
  try {
    const activeMerchantId = await resolveActingMerchant(homeUser(request), parsed.data.merchantId)
    await reply.send({ success: true, data: { activeMerchantId } })
  } catch (err) {
    await sendError(reply, err)
  }
}

export async function listAssignmentsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = ListAssignmentsQuerySchema.safeParse(request.query)
  if (!query.success) return validationError(reply, 'Invalid query')
  const user = homeUser(request)
  const assignments = await listAssignments(user.merchantId, query.data.userId)
  await reply.send({ success: true, data: { assignments } })
}

export async function createAssignmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = AssignmentBodySchema.safeParse(request.body)
  if (!parsed.success) return validationError(reply, 'userId and childMerchantId are required')
  const user = homeUser(request)
  try {
    const assignment = await createAssignment(user.merchantId, parsed.data, user.userId)
    await reply.status(201).send({ success: true, data: { assignment } })
  } catch (err) {
    await sendError(reply, err)
  }
}

export async function deleteAssignmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = AssignmentBodySchema.safeParse(request.body)
  if (!parsed.success) return validationError(reply, 'userId and childMerchantId are required')
  const user = homeUser(request)
  try {
    await removeAssignment(user.merchantId, parsed.data)
    await reply.send({ success: true, data: { deleted: true } })
  } catch (err) {
    await sendError(reply, err)
  }
}

export async function reportHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const report = await buildAgencyClientReport(homeUser(request))
  await reply.send({ success: true, data: report })
}
