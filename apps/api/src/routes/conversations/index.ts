import type { FastifyPluginAsync } from 'fastify'
import {
  listConversationsHandler,
  conversationStatsHandler,
  getConversationHandler,
} from './controller.js'

const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', listConversationsHandler)
  // static /stats MUST be registered before the /:id wildcard
  fastify.get('/stats', conversationStatsHandler)
  fastify.get('/:id', getConversationHandler)
}

export default conversationsRoutes
