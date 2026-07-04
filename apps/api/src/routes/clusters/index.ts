import type { FastifyPluginAsync } from 'fastify'
import { listClustersHandler, promoteClusterHandler } from './controller.js'

// lane:ai-wiring — AI segment-discovery clusters (roadmap 5.3).
//   GET  /api/v1/clusters                 — latest discovery run's clusters
//   POST /api/v1/clusters/:runId/promote  — promote a cluster into an official Segment
const clustersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', listClustersHandler)
  fastify.post('/:runId/promote', promoteClusterHandler)
}

export default clustersRoutes
