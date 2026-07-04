import type { FastifyPluginAsync } from 'fastify'
import { getRecommendationsHandler } from './controller.js'
// lane:rbac
import { requirePermission } from '../../services/rbac/index.js'

// lane:ml — GET /api/v1/recommendations/:customerId (milestone 7.2)
const recommendationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START — read-only insight data
  fastify.addHook('onRequest', requirePermission('analytics:read'))
  // lane:rbac END

  fastify.get('/:customerId', getRecommendationsHandler)
}

export default recommendationsRoutes
