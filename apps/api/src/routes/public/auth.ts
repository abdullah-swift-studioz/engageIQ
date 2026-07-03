import bcrypt from 'bcryptjs'
import { prisma } from '@engageiq/db'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PublicApiScope } from '../settings/scopes.js'

declare module 'fastify' {
  interface FastifyRequest {
    publicMerchantId?: string
    publicScopes?: string[]
  }
}

/**
 * Authenticate a public-API request via `Authorization: Bearer eiq_...`.
 * Sets `request.publicMerchantId` + `request.publicScopes`. Rejects on bad/expired/
 * inactive keys. Scope enforcement is a separate per-route preHandler (see requireScope).
 */
export async function publicApiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.send(reply.unauthorized('Missing API key'))
  }
  const key = authHeader.slice(7)
  if (!key.startsWith('eiq_') || key.length < 16) {
    return reply.send(reply.unauthorized('Invalid API key format'))
  }
  const keyPrefix = key.slice(0, 12)
  const apiKey = await prisma.apiKey.findFirst({
    where: { keyPrefix, isActive: true },
    select: { id: true, keyHash: true, merchantId: true, scopes: true, expiresAt: true },
  })
  if (!apiKey) return reply.send(reply.unauthorized('Invalid API key'))

  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
    return reply.send(reply.unauthorized('API key expired'))
  }

  const valid = await bcrypt.compare(key, apiKey.keyHash)
  if (!valid) return reply.send(reply.unauthorized('Invalid API key'))

  request.publicMerchantId = apiKey.merchantId
  request.publicScopes = apiKey.scopes

  // Best-effort last-used stamp; never block the request on it.
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined)
}

/** Per-route preHandler: require a specific scope on the authenticated key. */
export function requireScope(scope: PublicApiScope) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (reply.sent) return
    if (!request.publicScopes || !request.publicScopes.includes(scope)) {
      return reply.send(
        reply.forbidden(`This API key is missing the required scope: ${scope}`),
      )
    }
  }
}

/** The resolved tenant for a public request (throws if the auth hook did not run). */
export function publicMerchant(request: FastifyRequest): string {
  if (!request.publicMerchantId) throw new Error('publicApiKeyAuth did not run')
  return request.publicMerchantId
}
