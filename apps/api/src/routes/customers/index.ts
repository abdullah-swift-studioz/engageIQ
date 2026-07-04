import type { FastifyPluginAsync } from 'fastify'
import { getCustomerHandler, listCustomersHandler, mergeCustomersHandler, getGroupHandler } from './controller.js'
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

const customersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START — read for GET, write (merge) for mutations; Analyst is read-only
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'customers:read', write: 'customers:write' }))
  // lane:rbac END

  fastify.get('/', listCustomersHandler)

  fastify.post('/merge', mergeCustomersHandler)

  // GET /:id/group MUST be registered BEFORE GET /:id to prevent Fastify
  // from matching 'group' as the :id param
  fastify.get('/:id/group', getGroupHandler)

  fastify.get('/:id', getCustomerHandler)
}

export default customersRoutes
