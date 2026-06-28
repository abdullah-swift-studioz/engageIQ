import type { FastifyPluginAsync } from 'fastify'
import { listMessagesHandler, messageStatsHandler } from './controller.js'

const messagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  // Static path before any wildcard.
  fastify.get('/stats', messageStatsHandler)
  fastify.get('/', listMessagesHandler)
}

export default messagesRoutes
