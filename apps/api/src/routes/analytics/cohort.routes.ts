import type { FastifyPluginAsync } from 'fastify'

// STUB — implemented by the analytics sub-area build. Replaced with real handlers.
const cohortRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/cohort/__stub', async (_req, reply) => {
    await reply.status(501).send({
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'cohort analytics not implemented yet' },
    })
  })
}

export default cohortRoutes
