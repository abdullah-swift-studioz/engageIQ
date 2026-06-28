import type { FastifyPluginAsync } from 'fastify'
import {
  createTemplateHandler,
  listTemplatesHandler,
  getTemplateHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  submitTemplateHandler,
} from './controller.js'

const whatsappTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createTemplateHandler)
  fastify.get('/', listTemplatesHandler)

  // Static sub-path before the /:id wildcard.
  fastify.post('/:id/submit', submitTemplateHandler)
  fastify.get('/:id', getTemplateHandler)
  fastify.put('/:id', updateTemplateHandler)
  fastify.delete('/:id', deleteTemplateHandler)
}

export default whatsappTemplatesRoutes
