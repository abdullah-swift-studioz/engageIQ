import type { FastifyPluginAsync } from 'fastify'
import {
  createJourneyHandler,
  listJourneysHandler,
  getJourneyHandler,
  updateJourneyHandler,
  deleteJourneyHandler,
  activateJourneyHandler,
  pauseJourneyHandler,
  saveJourneyGraphHandler,
  archiveJourneyHandler,
  listEnrollmentsHandler,
} from './controller.js'
// lane:rbac
import { requirePermissionByMethod } from '../../services/rbac/index.js'

const journeysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  // lane:rbac START
  fastify.addHook('onRequest', requirePermissionByMethod({ read: 'journeys:read', write: 'journeys:write' }))
  // lane:rbac END

  fastify.post('/', createJourneyHandler)
  fastify.get('/', listJourneysHandler)

  // POST /:id/activate and /:id/pause MUST be registered before GET /:id to avoid param wildcard conflict
  fastify.post('/:id/activate', activateJourneyHandler)
  fastify.post('/:id/pause', pauseJourneyHandler)
  fastify.post('/:id/archive', archiveJourneyHandler)
  fastify.put('/:id/graph', saveJourneyGraphHandler)
  fastify.get('/:id/enrollments', listEnrollmentsHandler)

  fastify.get('/:id', getJourneyHandler)
  fastify.put('/:id', updateJourneyHandler)
  fastify.delete('/:id', deleteJourneyHandler)
}

export default journeysRoutes
