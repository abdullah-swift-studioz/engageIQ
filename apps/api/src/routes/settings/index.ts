import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { hasPermission } from '@engageiq/shared'
import {
  getMetaHandler,
  listApiKeysHandler,
  createApiKeyHandler,
  updateApiKeyHandler,
  revokeApiKeyHandler,
  listWebhooksHandler,
  getWebhookHandler,
  createWebhookHandler,
  updateWebhookHandler,
  rotateWebhookSecretHandler,
  deleteWebhookHandler,
  testWebhookHandler,
  listDeliveriesHandler,
} from './controller.js'

/**
 * Settings routes: manage public API keys + outbound webhooks.
 * Dashboard (JWT) auth. Gated on the `api_keys:manage` permission (Owner / Admin /
 * Agency Admin per the RBAC matrix) — read + write both require it, since key/secret
 * management is privileged.
 */
const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent) return
    if (!request.user || !hasPermission(request.user.role, 'api_keys:manage')) {
      return reply.send(reply.forbidden('You do not have permission to manage API settings'))
    }
  })

  fastify.get('/meta', getMetaHandler)

  // API keys
  fastify.get('/api-keys', listApiKeysHandler)
  fastify.post('/api-keys', createApiKeyHandler)
  fastify.patch('/api-keys/:id', updateApiKeyHandler)
  fastify.delete('/api-keys/:id', revokeApiKeyHandler)

  // Outbound webhooks — static/sub-paths before the /:id wildcard
  fastify.get('/webhooks', listWebhooksHandler)
  fastify.post('/webhooks', createWebhookHandler)
  fastify.post('/webhooks/:id/test', testWebhookHandler)
  fastify.post('/webhooks/:id/rotate-secret', rotateWebhookSecretHandler)
  fastify.get('/webhooks/:id/deliveries', listDeliveriesHandler)
  fastify.get('/webhooks/:id', getWebhookHandler)
  fastify.patch('/webhooks/:id', updateWebhookHandler)
  fastify.delete('/webhooks/:id', deleteWebhookHandler)
}

export default settingsRoutes
