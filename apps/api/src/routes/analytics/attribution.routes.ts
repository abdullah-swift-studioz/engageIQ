import type { FastifyPluginAsync } from 'fastify'

// STUB — implemented by the analytics sub-area build. Replaced with real handlers.
const attributionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/attribution/__stub', async (_req, reply) => {
    await reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'attribution analytics not implemented yet' },
    })
  })
}

export default attributionRoutes
