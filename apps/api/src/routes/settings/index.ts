import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { hasPermission } from '@engageiq/shared'
import { requirePermission } from '../../services/rbac/index.js'
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
  getRolesHandler,
  listTeamHandler,
  createTeamMemberHandler,
  updateTeamMemberHandler,
  deleteTeamMemberHandler,
} from './controller.js'

/**
 * Settings routes, mounted at /api/v1/settings. All routes require a dashboard JWT (group hook).
 *
 * lane:public-api — API keys + outbound webhooks: gated per-route on `api_keys:manage`
 *   (Owner / Admin / Agency Admin), since key/secret management is privileged. Applied
 *   per-route (not as a group hook) so it does not over-gate the team/roles routes below.
 * lane:rbac — Team & Roles (guide §9.4): `/roles` is readable by any authenticated user;
 *   team mutations require `users:manage`. Team ops are scoped to `request.user.merchantId`
 *   (for an agency user switched into a client, that client's account).
 */
const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  // lane:public-api — privileged API-settings gate, applied per-route.
  const manageApiKeys = {
    onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
      if (reply.sent) return
      if (!request.user || !hasPermission(request.user.role, 'api_keys:manage')) {
        return reply.send(reply.forbidden('You do not have permission to manage API settings'))
      }
    },
  }

  fastify.get('/meta', manageApiKeys, getMetaHandler)

  // API keys
  fastify.get('/api-keys', manageApiKeys, listApiKeysHandler)
  fastify.post('/api-keys', manageApiKeys, createApiKeyHandler)
  fastify.patch('/api-keys/:id', manageApiKeys, updateApiKeyHandler)
  fastify.delete('/api-keys/:id', manageApiKeys, revokeApiKeyHandler)

  // Outbound webhooks — static/sub-paths before the /:id wildcard
  fastify.get('/webhooks', manageApiKeys, listWebhooksHandler)
  fastify.post('/webhooks', manageApiKeys, createWebhookHandler)
  fastify.post('/webhooks/:id/test', manageApiKeys, testWebhookHandler)
  fastify.post('/webhooks/:id/rotate-secret', manageApiKeys, rotateWebhookSecretHandler)
  fastify.get('/webhooks/:id/deliveries', manageApiKeys, listDeliveriesHandler)
  fastify.get('/webhooks/:id', manageApiKeys, getWebhookHandler)
  fastify.patch('/webhooks/:id', manageApiKeys, updateWebhookHandler)
  fastify.delete('/webhooks/:id', manageApiKeys, deleteWebhookHandler)

  // lane:rbac — Team & Roles
  const manageUsers = { onRequest: requirePermission('users:manage') }
  // Readable by any authenticated user (renders role labels/capabilities).
  fastify.get('/roles', getRolesHandler)
  fastify.get('/team', manageUsers, listTeamHandler)
  fastify.post('/team', manageUsers, createTeamMemberHandler)
  fastify.patch('/team/:id', manageUsers, updateTeamMemberHandler)
  fastify.delete('/team/:id', manageUsers, deleteTeamMemberHandler)
}

export default settingsRoutes
