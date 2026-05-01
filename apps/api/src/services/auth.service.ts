import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '@engageiq/db'
import type { FastifyInstance } from 'fastify'
import type { Role } from '@engageiq/shared'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../plugins/jwt.js'

type ApiKeyRecord = Awaited<ReturnType<typeof prisma.apiKey.create>>

export type SafeUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  merchantId: string
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export async function loginUser(
  email: string,
  password: string,
  fastify: FastifyInstance,
  merchantDomain?: string
): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
  let user: Awaited<ReturnType<typeof prisma.user.findFirst>>

  if (merchantDomain) {
    const merchant = await prisma.merchant.findUnique({
      where: { shopifyDomain: merchantDomain },
      select: { id: true },
    })
    if (!merchant) throw fastify.httpErrors.unauthorized('Invalid credentials')
    user = await prisma.user.findUnique({
      where: { merchantId_email: { merchantId: merchant.id, email } },
    })
  } else {
    const users = await prisma.user.findMany({
      where: { email },
    })
    if (users.length > 1) {
      throw fastify.httpErrors.badRequest('Multiple accounts found — specify merchantDomain')
    }
    user = users[0] ?? null
  }

  if (!user || !user.isActive) throw fastify.httpErrors.unauthorized('Invalid credentials')

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw fastify.httpErrors.unauthorized('Invalid credentials')

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  const accessToken = signAccessToken(fastify, {
    sub: user.id,
    merchantId: user.merchantId,
    role: user.role as Role,
  })
  const refreshToken = signRefreshToken(fastify, {
    sub: user.id,
    merchantId: user.merchantId,
  })

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      merchantId: user.merchantId,
    },
  }
}

export async function refreshUserTokens(
  refreshToken: string,
  fastify: FastifyInstance
): Promise<{ accessToken: string; refreshToken: string }> {
  const decoded = verifyRefreshToken(fastify, refreshToken)

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: { id: true, merchantId: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) throw fastify.httpErrors.unauthorized('Account is inactive')

  const accessToken = signAccessToken(fastify, {
    sub: user.id,
    merchantId: user.merchantId,
    role: user.role as Role,
  })
  const newRefreshToken = signRefreshToken(fastify, {
    sub: user.id,
    merchantId: user.merchantId,
  })

  return { accessToken, refreshToken: newRefreshToken }
}

export async function generateApiKey(
  merchantId: string,
  name: string
): Promise<{ key: string; record: ApiKeyRecord }> {
  const raw = randomBytes(32).toString('hex')
  const key = `eiq_${raw}`
  const keyPrefix = key.slice(0, 12)
  const keyHash = await bcrypt.hash(key, 12)

  const record = await prisma.apiKey.create({
    data: {
      merchantId,
      name,
      keyHash,
      keyPrefix,
    },
  })

  return { key, record }
}
