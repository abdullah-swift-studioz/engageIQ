import type { FastifyPluginAsync } from 'fastify'
import {
  createSegmentHandler,
  listSegmentsHandler,
  getSegmentHandler,
  updateSegmentHandler,
  deleteSegmentHandler,
  evaluateSegmentHandler,
} from './controller.js'

const segmentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createSegmentHandler)
  fastify.get('/', listSegmentsHandler)

  // POST /:id/evaluate MUST be registered before GET /:id to avoid param wildcard conflict
  fastify.post('/:id/evaluate', evaluateSegmentHandler)
  fastify.get('/:id', getSegmentHandler)
  fastify.put('/:id', updateSegmentHandler)
  fastify.delete('/:id', deleteSegmentHandler)
}

export default segmentsRoutes
