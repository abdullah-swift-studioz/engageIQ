import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { publicApiKeyAuth, requireScope } from './auth.js'
import {
  listCustomersHandler,
  getCustomerHandler,
  getCustomerSegmentsHandler,
  listSegmentsHandler,
  getSegmentHandler,
  createSegmentHandler,
  updateSegmentHandler,
  deleteSegmentHandler,
  pushEventHandler,
  listCampaignsHandler,
  getCampaignHandler,
  triggerCampaignHandler,
  analyticsOverviewHandler,
  analyticsRevenueHandler,
} from './controller.js'

// Rate-limit per API key (falls back to IP). Keyed on the bearer token so limits are
// per-credential, independent of which of our auth hooks has run yet.
function keyByApiKey(request: FastifyRequest): string {
  return request.headers.authorization ?? request.ip
}
const standardLimit = { max: 600, timeWindow: '1 minute', keyGenerator: keyByApiKey }
const eventsLimit = { max: 1000, timeWindow: '1 minute', keyGenerator: keyByApiKey }

/**
 * Public REST API — versioned under /api/v1/public. Authenticated with an EngageIQ
 * API key (Bearer eiq_...) and gated per-route by the key's granted scopes. All
 * queries are scoped to the key's merchant (multi-tenant safe).
 */
const publicApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', publicApiKeyAuth)

  // Customers (read)
  fastify.get('/customers', { preHandler: requireScope('customers:read'), config: { rateLimit: standardLimit } }, listCustomersHandler)
  fastify.get('/customers/:id/segments', { preHandler: requireScope('customers:read'), config: { rateLimit: standardLimit } }, getCustomerSegmentsHandler)
  fastify.get('/customers/:id', { preHandler: requireScope('customers:read'), config: { rateLimit: standardLimit } }, getCustomerHandler)

  // Segments (read + write)
  fastify.get('/segments', { preHandler: requireScope('segments:read'), config: { rateLimit: standardLimit } }, listSegmentsHandler)
  fastify.post('/segments', { preHandler: requireScope('segments:write'), config: { rateLimit: standardLimit } }, createSegmentHandler)
  fastify.get('/segments/:id', { preHandler: requireScope('segments:read'), config: { rateLimit: standardLimit } }, getSegmentHandler)
  fastify.put('/segments/:id', { preHandler: requireScope('segments:write'), config: { rateLimit: standardLimit } }, updateSegmentHandler)
  fastify.delete('/segments/:id', { preHandler: requireScope('segments:write'), config: { rateLimit: standardLimit } }, deleteSegmentHandler)

  // Custom events (write)
  fastify.post('/events', { preHandler: requireScope('events:write'), config: { rateLimit: eventsLimit } }, pushEventHandler)

  // Campaigns (read + trigger)
  fastify.get('/campaigns', { preHandler: requireScope('campaigns:read'), config: { rateLimit: standardLimit } }, listCampaignsHandler)
  fastify.post('/campaigns/:id/trigger', { preHandler: requireScope('campaigns:trigger'), config: { rateLimit: standardLimit } }, triggerCampaignHandler)
  fastify.get('/campaigns/:id', { preHandler: requireScope('campaigns:read'), config: { rateLimit: standardLimit } }, getCampaignHandler)

  // Analytics (read)
  fastify.get('/analytics/overview', { preHandler: requireScope('analytics:read'), config: { rateLimit: standardLimit } }, analyticsOverviewHandler)
  fastify.get('/analytics/revenue', { preHandler: requireScope('analytics:read'), config: { rateLimit: standardLimit } }, analyticsRevenueHandler)
}

export default publicApiRoutes
