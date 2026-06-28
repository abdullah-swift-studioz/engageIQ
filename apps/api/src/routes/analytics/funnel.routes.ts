import type { FastifyPluginAsync } from 'fastify'

// STUB — implemented by the analytics sub-area build. Replaced with real handlers.
const funnelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/funnel/__stub', async (_req, reply) => {
    await reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'funnel analytics not implemented yet' },
    })
  })
}

export default funnelRoutes
