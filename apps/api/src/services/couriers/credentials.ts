// apps/api/src/services/couriers/credentials.ts
//
// Per-merchant courier credentials live in MerchantIntegration.credentials, which MUST
// be encrypted at rest (schema comment: SECURITY — app-layer/KMS). This module owns the
// app-layer crypto: AES-256-GCM with a key from env.COURIER_CREDENTIALS_KEY.
//
// The stored Json shape is { enc: "<base64(iv|tag|ciphertext)>" } — never plaintext.
// If the key is absent the app still boots; encryption/decryption fail closed and the
// courier sync layer no-ops with a clear status instead of leaking or crashing.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type { Courier } from '@prisma/client'
import type { CourierAdapterContext } from './types.js'

const IV_BYTES = 12 // GCM standard nonce length
const KEY_BYTES = 32 // AES-256

// Parse env.COURIER_CREDENTIALS_KEY as 64 hex chars or base64 → a 32-byte key, else null.
function getKey(): Buffer | null {
  const raw = env.COURIER_CREDENTIALS_KEY
  if (!raw) return null
  try {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
    const b = Buffer.from(raw, 'base64')
    if (b.length === KEY_BYTES) return b
  } catch {
    return null
  }
  return null
}

export function isCredentialKeyConfigured(): boolean {
  return getKey() !== null
}

// Encrypt an arbitrary credentials object into the { enc } envelope stored on the row.
// Throws if no key is configured — callers (the integration write route) must guard first.
export function encryptCredentials(credentials: Record<string, unknown>): { enc: string } {
  const key = getKey()
  if (!key) throw new Error('COURIER_CREDENTIALS_KEY is not configured; cannot encrypt credentials')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { enc: Buffer.concat([iv, tag, ciphertext]).toString('base64') }
}

// Decrypt the { enc } envelope. Returns null on any failure (no key, tampered payload,
// legacy/unknown shape) so callers fail closed rather than throwing.
export function decryptCredentials(stored: unknown): Record<string, unknown> | null {
  const key = getKey()
  if (!key) return null
  if (typeof stored !== 'object' || stored === null) return null
  const enc = (stored as { enc?: unknown }).enc
  if (typeof enc !== 'string') return null
  try {
    const buf = Buffer.from(enc, 'base64')
    const iv = buf.subarray(0, IV_BYTES)
    const tag = buf.subarray(IV_BYTES, IV_BYTES + 16)
    const ciphertext = buf.subarray(IV_BYTES + 16)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

// The provider string stored on MerchantIntegration for a courier = the enum value.
export function courierProvider(courier: Courier): string {
  return courier
}

// Why an integration can't be used to poll — surfaced to the UI/logs verbatim.
export type IntegrationSkipReason =
  | 'no-integration'
  | 'inactive'
  | 'no-encryption-key'
  | 'decrypt-failed'

export type LoadIntegrationResult =
  | { ok: true; context: CourierAdapterContext }
  | { ok: false; reason: IntegrationSkipReason }

// Load + decrypt a merchant's courier integration. Tenant-scoped by merchantId. Returns
// a typed skip reason (never throws) when the integration is missing, disabled, or
// undecryptable, so the sync layer can no-op with a clear status.
export async function loadCourierIntegration(
  merchantId: string,
  courier: Courier,
): Promise<LoadIntegrationResult> {
  const row = await prisma.merchantIntegration.findUnique({
    where: { merchantId_provider: { merchantId, provider: courierProvider(courier) } },
  })
  if (!row) return { ok: false, reason: 'no-integration' }
  if (!row.isActive) return { ok: false, reason: 'inactive' }
  if (!isCredentialKeyConfigured()) return { ok: false, reason: 'no-encryption-key' }
  const credentials = decryptCredentials(row.credentials)
  if (!credentials) return { ok: false, reason: 'decrypt-failed' }
  const config = (row.config ?? null) as Record<string, unknown> | null
  return { ok: true, context: { credentials, config } }
}
