import fastifyJwt from '@fastify/jwt'
import { env } from '@engageiq/shared'
import type { Role } from '@engageiq/shared'
import type { FastifyInstance } from 'fastify'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // role is optional to allow refresh tokens (which don't carry role)
    payload: { sub: string; merchantId: string; role?: Role; type: 'access' | 'refresh' }
    user: { userId: string; merchantId: string; role: Role }
  }
}

async function jwtPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
  })
}
;(jwtPlugin as unknown as { [key: symbol]: boolean })[Symbol.for('skip-override')] = true
export default jwtPlugin

export function signAccessToken(
  fastify: FastifyInstance,
  payload: { sub: string; merchantId: string; role: Role }
): string {
  return fastify.jwt.sign(
    { sub: payload.sub, merchantId: payload.merchantId, role: payload.role, type: 'access' },
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  )
}

export function signRefreshToken(
  fastify: FastifyInstance,
  payload: { sub: string; merchantId: string }
): string {
  return fastify.jwt.sign(
    { sub: payload.sub, merchantId: payload.merchantId, type: 'refresh' },
    { key: env.JWT_REFRESH_SECRET, expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  )
}

export function verifyRefreshToken(
  fastify: FastifyInstance,
  token: string
): { sub: string; merchantId: string } {
  const decoded = fastify.jwt.verify<{ sub: string; merchantId: string; type: string }>(
    token,
    { key: env.JWT_REFRESH_SECRET }
  )
  if (decoded.type !== 'refresh') throw new Error('Invalid token type')
  return { sub: decoded.sub, merchantId: decoded.merchantId }
}
