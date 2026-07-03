import type { FastifyPluginAsync } from 'fastify'
import { listMessagesHandler, messageStatsHandler } from './controller.js'
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

const messagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START — message log is part of the Engage capability (campaigns:*)
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'campaigns:read', write: 'campaigns:write' }))
  // lane:rbac END

  // Static path before any wildcard.
  fastify.get('/stats', messageStatsHandler)
  fastify.get('/', listMessagesHandler)
}

export default messagesRoutes
