import type { FastifyPluginAsync } from 'fastify'
import { requirePermission } from '../../services/rbac/index.js'
import {
  getContextHandler,
  switchHandler,
  listAssignmentsHandler,
  createAssignmentHandler,
  deleteAssignmentHandler,
  reportHandler,
} from './controller.js'

/**
 * Agency accounts (roadmap 8.3 / guide §9.4), mounted at /api/v1/agency.
 *
 * - /context, /switch   any authenticated user (non-agency users see only home).
 * - /assignments, /report  require `agency:manage` (Agency Admin) — these manage
 *   which clients a member can access, and run cross-client reports.
 *
 * The account SWITCH itself is stateless: /switch validates access and the client
 * then sends `x-acting-merchant-id` on subsequent calls; the global preHandler
 * re-scopes the tenant. These routes always operate on the agency home merchant.
 */
const agencyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  const manageAgency = { onRequest: requirePermission('agency:manage') }

  fastify.get('/context', getContextHandler)
  fastify.post('/switch', switchHandler)

  fastify.get('/assignments', manageAgency, listAssignmentsHandler)
  fastify.post('/assignments', manageAgency, createAssignmentHandler)
  fastify.delete('/assignments', manageAgency, deleteAssignmentHandler)

  fastify.get('/report', manageAgency, reportHandler)
}

export default agencyRoutes
