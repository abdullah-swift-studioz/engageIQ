import type { FastifyPluginAsync } from 'fastify'

// STUB — implemented by the analytics sub-area build. Replaced with real handlers.
const codRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/cod/__stub', async (_req, reply) => {
    await reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'cod analytics not implemented yet' },
    })
  })
}

export default codRoutes
