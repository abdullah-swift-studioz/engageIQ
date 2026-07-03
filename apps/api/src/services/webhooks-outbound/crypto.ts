import crypto from 'node:crypto'
import { env } from '@engageiq/shared'

/**
 * Crypto helpers for outbound webhooks.
 *
 * Two independent concerns:
 *  1. Secret-at-rest: a merchant's HMAC signing secret is stored ENCRYPTED in
 *     OutboundWebhook.secret (AES-256-GCM). Never store it in plaintext.
 *  2. Signing: each delivery POST is signed with HMAC-SHA256 over the raw body so
 *     the merchant can verify authenticity.
 */

const ENC_VERSION = 'v1'

let warnedDerivedKey = false

/**
 * Resolve the 32-byte AES key from WEBHOOK_ENCRYPTION_KEY (base64 or hex). When
 * unset, derive a NON-PRODUCTION key from JWT_SECRET so the app boots in dev — with
 * a one-time warning. In production the var must be set (secrets become unreadable
 * across restarts otherwise, since a derived key changes if JWT_SECRET changes).
 */
function getMasterKey(): Buffer {
  const raw = env.WEBHOOK_ENCRYPTION_KEY
  if (raw && raw.length > 0) {
    // Try base64 (44 chars for 32 bytes) then hex (64 chars).
    const asBase64 = Buffer.from(raw, 'base64')
    if (asBase64.length === 32) return asBase64
    const asHex = Buffer.from(raw, 'hex')
    if (asHex.length === 32) return asHex
    throw new Error(
      'WEBHOOK_ENCRYPTION_KEY must decode to 32 bytes (base64 or hex). Generate with `openssl rand -base64 32`.',
    )
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('WEBHOOK_ENCRYPTION_KEY is required in production to encrypt webhook secrets at rest.')
  }
  if (!warnedDerivedKey) {
    warnedDerivedKey = true
    // eslint-disable-next-line no-console
    console.warn(
      '[webhooks-outbound] WEBHOOK_ENCRYPTION_KEY not set — deriving a NON-PRODUCTION key from JWT_SECRET. Set it for production.',
    )
  }
  return crypto.scryptSync(env.JWT_SECRET, 'engageiq-webhook-secret-salt', 32)
}

/** Encrypt a plaintext secret for storage. Output: `v1:<iv>:<tag>:<ciphertext>` (base64 parts). */
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [ENC_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Decrypt a stored secret produced by {@link encryptSecret}. Throws if tampered/undecryptable. */
export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  const [version, ivB64, tagB64, dataB64] = parts
  if (parts.length !== 4 || version !== ENC_VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted webhook secret')
  }
  const key = getMasterKey()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}

/** Generate a fresh merchant-facing signing secret (shown once at creation). */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`
}

/** HMAC-SHA256 signature of the raw request body, hex-encoded. */
export function signPayload(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}
