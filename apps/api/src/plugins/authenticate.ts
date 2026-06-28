import { prisma } from '@engageiq/db'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Role } from '@engageiq/shared'

interface JwtRawPayload {
  sub: string
  merchantId: string
  role?: Role
  type: 'access' | 'refresh'
  iat?: number
  exp?: number
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>
    requireRole(roles: Role[]): (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

async function authenticatePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify()
      const raw = request.user as unknown as JwtRawPayload
      if (raw.type !== 'access' || !raw.role) {
        throw reply.unauthorized('Invalid token type')
      }
      request.user = { userId: raw.sub, merchantId: raw.merchantId, role: raw.role }
      const dbUser = await prisma.user.findUnique({
        where: { id: raw.sub },
        select: { isActive: true, merchantId: true },
      })
      if (!dbUser || !dbUser.isActive) throw reply.unauthorized('Account is inactive')
      if (dbUser.merchantId !== raw.merchantId) throw reply.unauthorized('Tenant mismatch')
    } catch (err) {
      return reply.send(err)
    }
  })

  fastify.decorate('requireRole', function (roles: Role[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      await fastify.authenticate(request, reply)
      if (reply.sent) return
      if (!request.user || !roles.includes(request.user.role)) {
        return reply.send(reply.forbidden('Insufficient permissions'))
      }
    }
  })
}
;(authenticatePlugin as unknown as { [key: symbol]: boolean })[Symbol.for('skip-override')] = true
export default authenticatePlugin
