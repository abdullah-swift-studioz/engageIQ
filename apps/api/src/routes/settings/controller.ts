import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  createApiKeySchema,
  updateApiKeySchema,
  createWebhookSchema,
  updateWebhookSchema,
} from './schema.js'
import { PUBLIC_API_SCOPES } from './scopes.js'
import { ALL_OUTBOUND_EVENTS } from '../../services/webhooks-outbound/events.js'
import {
  listApiKeys,
  createApiKey,
  updateApiKey,
  revokeApiKey,
} from './api-keys.service.js'
import {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  rotateWebhookSecret,
  deleteWebhook,
  sendTestPing,
  listDeliveries,
} from './webhooks.service.js'
import { ROLE_PERMISSIONS } from '@engageiq/shared'
import {
  listTeam,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  isAppError,
} from '../../services/rbac/index.js'
import {
  CreateTeamMemberBodySchema,
  UpdateTeamMemberBodySchema,
  UserParamsSchema,
} from './schema.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}
function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message } })
}
function merchantOf(request: FastifyRequest): string {
  return request.user!.merchantId
}

// ─── Metadata (scopes + subscribable events) — powers the settings UI ─────────
export async function getMetaHandler(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await reply.send({ success: true, data: { scopes: PUBLIC_API_SCOPES, events: ALL_OUTBOUND_EVENTS } })
}

// ─── API keys ─────────────────────────────────────────────────────────────────
export async function listApiKeysHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const keys = await listApiKeys(merchantOf(request))
  await reply.send({ success: true, data: keys })
}

export async function createApiKeyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = createApiKeySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const { key, record } = await createApiKey(merchantOf(request), parsed.data)
  // `key` is returned exactly once — the client must store it now.
  await reply.status(201).send({ success: true, data: { key, apiKey: record } })
}

export async function updateApiKeyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const parsed = updateApiKeySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const updated = await updateApiKey(merchantOf(request), id, parsed.data)
  if (!updated) {
    await notFound(reply, 'API key not found')
    return
  }
  await reply.send({ success: true, data: updated })
}

export async function revokeApiKeyHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const ok = await revokeApiKey(merchantOf(request), id)
  if (!ok) {
    await notFound(reply, 'API key not found')
    return
  }
  await reply.send({ success: true, data: { id } })
}

// ─── Outbound webhooks ──────────────────────────────────────────────────────────
export async function listWebhooksHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const webhooks = await listWebhooks(merchantOf(request))
  await reply.send({ success: true, data: webhooks })
}

export async function getWebhookHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const result = await getWebhook(merchantOf(request), id)
  if (!result) {
    await notFound(reply, 'Webhook not found')
    return
  }
  await reply.send({ success: true, data: result })
}

export async function createWebhookHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = createWebhookSchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const { webhook, secret } = await createWebhook(merchantOf(request), parsed.data)
  // `secret` is returned exactly once — the merchant needs it to verify signatures.
  await reply.status(201).send({ success: true, data: { webhook, secret } })
}

export async function updateWebhookHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const parsed = updateWebhookSchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const updated = await updateWebhook(merchantOf(request), id, parsed.data)
  if (!updated) {
    await notFound(reply, 'Webhook not found')
    return
  }
  await reply.send({ success: true, data: updated })
}

export async function rotateWebhookSecretHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const secret = await rotateWebhookSecret(merchantOf(request), id)
  if (!secret) {
    await notFound(reply, 'Webhook not found')
    return
  }
  await reply.send({ success: true, data: { secret } })
}

export async function deleteWebhookHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const ok = await deleteWebhook(merchantOf(request), id)
  if (!ok) {
    await notFound(reply, 'Webhook not found')
    return
  }
  await reply.send({ success: true, data: { id } })
}

export async function testWebhookHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const deliveryId = await sendTestPing(merchantOf(request), id)
  if (!deliveryId) {
    await notFound(reply, 'Webhook not found')
    return
  }
  await reply.status(202).send({ success: true, data: { deliveryId } })
}

export async function listDeliveriesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string }
  const query = request.query as { limit?: string }
  const limit = query.limit ? Math.max(1, Math.min(200, Number(query.limit) || 50)) : 50
  const deliveries = await listDeliveries(merchantOf(request), id, limit)
  await reply.send({ success: true, data: deliveries })
}

function sendAppError(reply: FastifyReply, err: unknown) {
  if (isAppError(err)) {
    return reply.status(err.statusCode).send({
      success: false,
      error: { code: err.code, message: err.message },
    })
  }
  throw err
}

/** The serialized RBAC matrix, so the dashboard can render role capabilities. */
export async function getRolesHandler(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const roles = Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms].sort()]),
  )
  await reply.send({ success: true, data: { roles } })
}

export async function listTeamHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const members = await listTeam(request.user.merchantId)
  await reply.send({ success: true, data: { members } })
}

export async function createTeamMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CreateTeamMemberBodySchema.safeParse(request.body)
  if (!parsed.success) {
    return validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
  }
  try {
    const member = await createTeamMember(request.user.merchantId, parsed.data, {
      userId: request.user.userId,
      role: request.user.role,
    })
    await reply.status(201).send({ success: true, data: { member } })
  } catch (err) {
    await sendAppError(reply, err)
  }
}

export async function updateTeamMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = UserParamsSchema.safeParse(request.params)
  if (!params.success) return validationError(reply, 'Invalid user id')
  const parsed = UpdateTeamMemberBodySchema.safeParse(request.body)
  if (!parsed.success) {
    return validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
  }
  try {
    const member = await updateTeamMember(request.user.merchantId, params.data.id, parsed.data, {
      userId: request.user.userId,
      role: request.user.role,
    })
    await reply.send({ success: true, data: { member } })
  } catch (err) {
    await sendAppError(reply, err)
  }
}

export async function deleteTeamMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = UserParamsSchema.safeParse(request.params)
  if (!params.success) return validationError(reply, 'Invalid user id')
  try {
    await deleteTeamMember(request.user.merchantId, params.data.id, {
      userId: request.user.userId,
      role: request.user.role,
    })
    await reply.send({ success: true, data: { deleted: true } })
  } catch (err) {
    await sendAppError(reply, err)
  }
}
