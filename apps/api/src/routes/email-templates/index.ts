import type { FastifyPluginAsync } from 'fastify'
import {
  createTemplateHandler,
  listTemplatesHandler,
  getTemplateHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  previewTemplateHandler,
  spamCheckTemplateHandler,
  testSendTemplateHandler,
  sendTemplateHandler,
} from './controller.js'

const emailTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createTemplateHandler)
  fastify.get('/', listTemplatesHandler)

  // Static sub-paths registered before the /:id wildcard (route-ordering rule).
  fastify.post('/:id/preview', previewTemplateHandler)
  fastify.post('/:id/spam-check', spamCheckTemplateHandler)
  fastify.post('/:id/test-send', testSendTemplateHandler)
  fastify.post('/:id/send', sendTemplateHandler)

  fastify.get('/:id', getTemplateHandler)
  fastify.put('/:id', updateTemplateHandler)
  fastify.delete('/:id', deleteTemplateHandler)
}

export default emailTemplatesRoutes
