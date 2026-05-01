import type { FastifyPluginAsync } from 'fastify'
import { getCustomerHandler, listCustomersHandler } from './controller.js'

const customersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', listCustomersHandler)

  fastify.get('/:id', getCustomerHandler)
}

export default customersRoutes
