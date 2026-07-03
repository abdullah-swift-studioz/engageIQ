import type { FastifyPluginAsync } from 'fastify'
import {
  createDomainHandler,
  listDomainsHandler,
  getDomainHandler,
  verifyDomainHandler,
  deleteDomainHandler,
} from './controller.js'

const sendingDomainsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createDomainHandler)
  fastify.get('/', listDomainsHandler)

  // Static sub-path before the /:id wildcard.
  fastify.post('/:id/verify', verifyDomainHandler)
  fastify.get('/:id', getDomainHandler)
  fastify.delete('/:id', deleteDomainHandler)
}

export default sendingDomainsRoutes
