import type { FastifyPluginAsync } from 'fastify'
import {
  createElementHandler,
  listElementsHandler,
  getElementHandler,
  updateElementHandler,
  deleteElementHandler,
  elementStatsHandler,
  createAbTestHandler,
  stopAbTestHandler,
  decideAbTestHandler,
  deliverHandler,
} from './controller.js'

const onsiteRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Public delivery — called cross-origin from Shopify storefronts, no auth.
  // Identified by merchantId in the payload; rate-limited like the SDK routes.
  fastify.post('/deliver', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, deliverHandler)
  fastify.options('/deliver', { config: { rateLimit: false } }, (_request, reply) =>
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .status(204)
      .send(),
  )

  // ── Authenticated merchant config API (encapsulated child scope). ──────────
  fastify.register(async (authed) => {
    authed.addHook('onRequest', authed.authenticate)

    authed.post('/', createElementHandler)
    authed.get('/', listElementsHandler)

    // Static / sub-paths MUST be registered before the GET /:id wildcard.
    authed.post('/:id/ab-test', createAbTestHandler)
    authed.post('/:id/ab-test/:testId/stop', stopAbTestHandler)
    authed.post('/:id/ab-test/:testId/decide', decideAbTestHandler)
    authed.get('/:id/stats', elementStatsHandler)

    authed.get('/:id', getElementHandler)
    authed.put('/:id', updateElementHandler)
    authed.delete('/:id', deleteElementHandler)
  })
}

export default onsiteRoutes
