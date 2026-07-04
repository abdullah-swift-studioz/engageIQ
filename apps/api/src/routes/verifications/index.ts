import type { FastifyPluginAsync } from 'fastify'
import {
  listVerificationsHandler,
  verificationStatsHandler,
  getVerificationHandler,
  startVerificationHandler,
  confirmVerificationHandler,
  cancelVerificationHandler,
} from './controller.js'

// COD verification read API + manual agent actions (guide §7.4). The escalation itself runs in the
// cod-verification worker; these routes surface the queue/analytics and let an agent act on an order.
const verificationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', listVerificationsHandler)
  // static /stats MUST be registered before the /:id wildcard (route-ordering rule).
  fastify.get('/stats', verificationStatsHandler)
  fastify.get('/:id', getVerificationHandler)
  fastify.post('/:id/start', startVerificationHandler)
  fastify.post('/:id/confirm', confirmVerificationHandler)
  fastify.post('/:id/cancel', cancelVerificationHandler)
}

export default verificationsRoutes
