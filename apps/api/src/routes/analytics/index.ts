import type { FastifyPluginAsync } from 'fastify'
import realtimeRoutes from './realtime.routes.js'
import rfmRoutes from './rfm.routes.js'
import funnelRoutes from './funnel.routes.js'
import cohortRoutes from './cohort.routes.js'
import attributionRoutes from './attribution.routes.js'
import productRoutes from './product.routes.js'
import codRoutes from './cod.routes.js'

/**
 * Analytics Engine route group (roadmap Phase 4), mounted at /api/v1/analytics.
 * All sub-routes require a dashboard JWT and are tenant-scoped by request.user.merchantId.
 *
 * Sub-areas:
 *   /realtime      4.1 Real-Time Dashboard
 *   /rfm           4.2 RFM dashboard view (read-only; scores written by the ML lane)
 *   /funnel        4.3 Funnel Analysis
 *   /cohort        4.4 Cohort Retention
 *   /attribution   4.5 Revenue Attribution
 *   /products      4.5 Product-Level Retention
 *   /cod           4.5 COD Analytics
 */
const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  await fastify.register(realtimeRoutes)
  await fastify.register(rfmRoutes)
  await fastify.register(funnelRoutes)
  await fastify.register(cohortRoutes)
  await fastify.register(attributionRoutes)
  await fastify.register(productRoutes)
  await fastify.register(codRoutes)
}

export default analyticsRoutes
