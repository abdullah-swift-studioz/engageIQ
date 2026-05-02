import type { FastifyPluginAsync } from 'fastify'
import { getCustomerHandler, listCustomersHandler, mergeCustomersHandler } from './controller.js'

const customersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', listCustomersHandler)

  fastify.post('/merge', mergeCustomersHandler)

  fastify.get('/:id', getCustomerHandler)
}

export default customersRoutes
