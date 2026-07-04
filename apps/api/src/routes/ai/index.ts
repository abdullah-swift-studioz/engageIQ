import type { FastifyPluginAsync } from 'fastify'
import { generateCopyHandler, predictSubjectHandler } from './controller.js'

// AI Copywriter routes (roadmap 7.4 / feature-guide §8.3). Synchronous (no queue) — a merchant
// clicks "Generate with AI" and waits for the response. Every route requires an authenticated
// dashboard user; the service layer scopes all reads/writes by request.user.merchantId.
const aiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/generate', generateCopyHandler)
  fastify.post('/predict-subject', predictSubjectHandler)
}

export default aiRoutes
