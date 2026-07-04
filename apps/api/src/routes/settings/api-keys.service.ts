import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@engageiq/db'
import type { CreateApiKeyInput, UpdateApiKeyInput } from './schema.js'

/** Public-safe projection of an API key — never includes keyHash or the raw key. */
export interface ApiKeySafe {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

function toSafe(k: {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}): ApiKeySafe {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    scopes: k.scopes,
    isActive: k.isActive,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  }
}

const SAFE_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  isActive: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
} as const

export async function listApiKeys(merchantId: string): Promise<ApiKeySafe[]> {
  const keys = await prisma.apiKey.findMany({
    where: { merchantId },
    select: SAFE_SELECT,
    orderBy: { createdAt: 'desc' },
  })
  return keys.map(toSafe)
}

/** Create a key. Returns the plaintext key ONCE (never stored) plus the safe record. */
export async function createApiKey(
  merchantId: string,
  input: CreateApiKeyInput,
): Promise<{ key: string; record: ApiKeySafe }> {
  const key = `eiq_${randomBytes(32).toString('hex')}`
  const keyPrefix = key.slice(0, 12)
  const keyHash = await bcrypt.hash(key, 12)

  const record = await prisma.apiKey.create({
    data: {
      merchantId,
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: input.scopes,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
    select: SAFE_SELECT,
  })

  return { key, record: toSafe(record) }
}

export async function updateApiKey(
  merchantId: string,
  id: string,
  input: UpdateApiKeyInput,
): Promise<ApiKeySafe | null> {
  const existing = await prisma.apiKey.findFirst({ where: { id, merchantId }, select: { id: true } })
  if (!existing) return null

  const updated = await prisma.apiKey.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: SAFE_SELECT,
  })
  return toSafe(updated)
}

/** Permanently revoke (delete) a key. Returns false if not found for this merchant. */
export async function revokeApiKey(merchantId: string, id: string): Promise<boolean> {
  const result = await prisma.apiKey.deleteMany({ where: { id, merchantId } })
  return result.count > 0
}
