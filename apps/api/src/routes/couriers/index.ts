// apps/api/src/routes/couriers/index.ts
//
// Courier routes (roadmap 8.1 / guide §9.2), mounted at /api/v1/couriers. All routes
// require a dashboard JWT; static/sub-paths are registered before the /:id wildcard.
import type { FastifyPluginAsync } from 'fastify'
import {
  listShipmentsHandler,
  getShipmentHandler,
  createShipmentHandler,
  syncShipmentHandler,
  sweepHandler,
  listIntegrationsHandler,
  upsertIntegrationHandler,
} from './controller.js'

const couriersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  // Integrations (register before any /shipments/:id-style wildcard is moot here, but
  // keep the concrete groups grouped and ordered).
  fastify.get('/integrations', listIntegrationsHandler)
  fastify.put('/integrations/:provider', upsertIntegrationHandler)

  // Merchant-wide sweep (enqueue a poll per active shipment).
  fastify.post('/sync', sweepHandler)

  // Shipments — static/sub-paths before the /:id wildcard.
  fastify.get('/shipments', listShipmentsHandler)
  fastify.post('/shipments', createShipmentHandler)
  fastify.post('/shipments/:id/sync', syncShipmentHandler)
  fastify.get('/shipments/:id', getShipmentHandler)
}

export default couriersRoutes
