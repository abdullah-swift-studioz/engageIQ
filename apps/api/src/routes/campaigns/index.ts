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
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

const campaignsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'campaigns:read', write: 'campaigns:write' }))
  // lane:rbac END

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
