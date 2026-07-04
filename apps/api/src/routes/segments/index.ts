import type { FastifyPluginAsync } from 'fastify'
import {
  createSegmentHandler,
  listSegmentsHandler,
  getSegmentHandler,
  updateSegmentHandler,
  deleteSegmentHandler,
  evaluateSegmentHandler,
} from './controller.js'
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

const segmentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'segments:read', write: 'segments:write' }))
  // lane:rbac END

  fastify.post('/', createSegmentHandler)
  fastify.get('/', listSegmentsHandler)

  // POST /:id/evaluate MUST be registered before GET /:id to avoid param wildcard conflict
  fastify.post('/:id/evaluate', evaluateSegmentHandler)
  fastify.get('/:id', getSegmentHandler)
  fastify.put('/:id', updateSegmentHandler)
  fastify.delete('/:id', deleteSegmentHandler)
}

export default segmentsRoutes
