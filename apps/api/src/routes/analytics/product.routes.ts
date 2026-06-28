import type { FastifyPluginAsync } from 'fastify'

// STUB — implemented by the analytics sub-area build. Replaced with real handlers.
const productRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/product/__stub', async (_req, reply) => {
    await reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'product analytics not implemented yet' },
    })
  })
}

export default productRoutes
