import type { FastifyPluginAsync } from 'fastify'
import { ingestCustomEventHandler } from './controller.js'

const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticateApiKey)

  fastify.post(
    '/',
    {
      config: { rateLimit: { max: 1000, timeWindow: '1 minute' } },
    },
    ingestCustomEventHandler,
  )
}

export default eventsRoutes
