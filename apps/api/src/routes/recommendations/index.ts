import type { FastifyPluginAsync } from 'fastify'
import { getRecommendationsHandler } from './controller.js'

// lane:ml — GET /api/v1/recommendations/:customerId (milestone 7.2)
const recommendationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/:customerId', getRecommendationsHandler)
}

export default recommendationsRoutes
