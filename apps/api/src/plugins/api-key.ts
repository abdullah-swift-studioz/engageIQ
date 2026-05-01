import bcrypt from 'bcryptjs'
import { prisma } from '@engageiq/db'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticateApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void>
  }
  interface FastifyRequest {
    apiKeyMerchantId?: string
  }
}

function apiKeyPlugin(fastify: FastifyInstance): void {
  fastify.decorate('authenticateApiKey', async function (request: FastifyRequest, reply: FastifyReply) {
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
      select: { keyHash: true, merchantId: true },
    })
    if (!apiKey) return reply.send(reply.unauthorized('Invalid API key'))
    const valid = await bcrypt.compare(key, apiKey.keyHash)
    if (!valid) return reply.send(reply.unauthorized('Invalid API key'))
    request.apiKeyMerchantId = apiKey.merchantId
    await prisma.apiKey.updateMany({
      where: { keyPrefix },
      data: { lastUsedAt: new Date() },
    })
  })
}
;(apiKeyPlugin as unknown as { [key: symbol]: boolean })[Symbol.for('skip-override')] = true
export default apiKeyPlugin
