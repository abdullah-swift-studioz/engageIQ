import type { FastifyPluginAsync } from 'fastify'
import {
  createTemplateHandler,
  listTemplatesHandler,
  getTemplateHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  submitTemplateHandler,
} from './controller.js'
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

const whatsappTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START — messaging is part of the Engage capability (campaigns:*)
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'campaigns:read', write: 'campaigns:write' }))
  // lane:rbac END

  fastify.post('/', createTemplateHandler)
  fastify.get('/', listTemplatesHandler)

  // Static sub-path before the /:id wildcard.
  fastify.post('/:id/submit', submitTemplateHandler)
  fastify.get('/:id', getTemplateHandler)
  fastify.put('/:id', updateTemplateHandler)
  fastify.delete('/:id', deleteTemplateHandler)
}

export default whatsappTemplatesRoutes
