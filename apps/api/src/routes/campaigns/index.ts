import type { FastifyPluginAsync } from 'fastify'
import {
  createCampaignHandler,
  listCampaignsHandler,
  getCampaignHandler,
  updateCampaignHandler,
  deleteCampaignHandler,
  sendCampaignHandler,
  cancelCampaignHandler,
} from './controller.js'

const campaignsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createCampaignHandler)
  fastify.get('/', listCampaignsHandler)

  // Sub-paths MUST be registered before the GET /:id wildcard to avoid param conflicts.
  fastify.post('/:id/send', sendCampaignHandler)
  fastify.post('/:id/cancel', cancelCampaignHandler)

  fastify.get('/:id', getCampaignHandler)
  fastify.put('/:id', updateCampaignHandler)
  fastify.delete('/:id', deleteCampaignHandler)
}

export default campaignsRoutes
