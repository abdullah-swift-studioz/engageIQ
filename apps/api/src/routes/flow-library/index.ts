import type { FastifyPluginAsync } from 'fastify'
import {
  listFlowTemplatesHandler,
  getFlowTemplateHandler,
  useFlowTemplateHandler,
} from './controller.js'
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

// Pre-Built Flow Library (guide §7.6). Browsing/preview is read-only; "Use this flow"
// instantiates a real merchant Journey, so it is gated by journeys:write.
const flowLibraryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'journeys:read', write: 'journeys:write' }))
  // lane:rbac END

  fastify.get('/', listFlowTemplatesHandler)

  // POST sub-path registered before the GET /:key wildcard to avoid param conflicts.
  fastify.post('/:key/use', useFlowTemplateHandler)

  fastify.get('/:key', getFlowTemplateHandler)
}

export default flowLibraryRoutes
