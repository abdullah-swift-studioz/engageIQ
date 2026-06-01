import type { FastifyPluginAsync } from 'fastify'
import { getCustomerHandler, listCustomersHandler, mergeCustomersHandler, getGroupHandler } from './controller.js'

const customersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', listCustomersHandler)

  fastify.post('/merge', mergeCustomersHandler)

  // GET /:id/group MUST be registered BEFORE GET /:id to prevent Fastify
  // from matching 'group' as the :id param
  fastify.get('/:id/group', getGroupHandler)

  fastify.get('/:id', getCustomerHandler)
}

export default customersRoutes
