import type { FastifyPluginAsync } from 'fastify'
import {
  createJourneyHandler,
  listJourneysHandler,
  getJourneyHandler,
  updateJourneyHandler,
  deleteJourneyHandler,
  activateJourneyHandler,
  pauseJourneyHandler,
  listEnrollmentsHandler,
} from './controller.js'

const journeysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', createJourneyHandler)
  fastify.get('/', listJourneysHandler)

  // POST /:id/activate and /:id/pause MUST be registered before GET /:id to avoid param wildcard conflict
  fastify.post('/:id/activate', activateJourneyHandler)
  fastify.post('/:id/pause', pauseJourneyHandler)
  fastify.get('/:id/enrollments', listEnrollmentsHandler)

  fastify.get('/:id', getJourneyHandler)
  fastify.put('/:id', updateJourneyHandler)
  fastify.delete('/:id', deleteJourneyHandler)
}

export default journeysRoutes
