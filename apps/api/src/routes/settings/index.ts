import type { FastifyPluginAsync } from 'fastify'
import { requirePermission } from '../../services/rbac/index.js'
import {
  getRolesHandler,
  listTeamHandler,
  createTeamMemberHandler,
  updateTeamMemberHandler,
  deleteTeamMemberHandler,
} from './controller.js'

/**
 * Settings — Team & Roles (guide §9.4), mounted at /api/v1/settings.
 * All routes require a dashboard JWT (group hook). Team mutations additionally
 * require the `users:manage` permission (Owner / Admin / Agency Admin). Team
 * operations are scoped to `request.user.merchantId` — which, for an agency user
 * who has switched into a client, is that client's account.
 */
const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  const manageUsers = { onRequest: requirePermission('users:manage') }

  // Readable by any authenticated user (renders role labels/capabilities).
  fastify.get('/roles', getRolesHandler)

  fastify.get('/team', manageUsers, listTeamHandler)
  fastify.post('/team', manageUsers, createTeamMemberHandler)
  fastify.patch('/team/:id', manageUsers, updateTeamMemberHandler)
  fastify.delete('/team/:id', manageUsers, deleteTeamMemberHandler)
}

export default settingsRoutes
