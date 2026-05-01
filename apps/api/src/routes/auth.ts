import { prisma } from '@engageiq/db'
import type { FastifyInstance } from 'fastify'
import { loginUser, refreshUserTokens } from '../services/auth.service.js'

function authRoutes(fastify: FastifyInstance): void {
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
          merchantDomain: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { email, password, merchantDomain } = request.body as {
        email: string
        password: string
        merchantDomain?: string
      }
      const result = await loginUser(email, password, fastify, merchantDomain)
      return reply.send(result)
    },
  })

  fastify.post('/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken: string }
      const result = await refreshUserTokens(refreshToken, fastify)
      return reply.send(result)
    },
  })

  fastify.post('/logout', {
    handler: (_request, reply) => {
      return reply.send({ ok: true })
    },
  })

  fastify.get('/me', {
    preHandler: [(req, rep) => fastify.authenticate(req, rep)],
    handler: async (request, reply) => {
      const { userId } = request.user
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          merchantId: true,
        },
      })
      return reply.send(user)
    },
  })
}
export default authRoutes
