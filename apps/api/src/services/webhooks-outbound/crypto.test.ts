import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'

// vi.mock is hoisted above imports, so the factory must not reference outer variables.
// Use a fixed, self-contained 32-byte key.
vi.mock('@engageiq/shared', () => ({
  env: {
    WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    NODE_ENV: 'test',
    JWT_SECRET: 'x'.repeat(32),
  },
}))

import { encryptSecret, decryptSecret, generateWebhookSecret, signPayload } from './crypto.js'

describe('webhook crypto', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = 'whsec_super_secret_value'
    const enc = encryptSecret(secret)
    expect(enc).not.toContain(secret) // ciphertext must not leak plaintext
    expect(enc.startsWith('v1:')).toBe(true)
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('produces different ciphertext each time (random IV) but both decrypt', () => {
    const secret = 'whsec_abc'
    const a = encryptSecret(secret)
    const b = encryptSecret(secret)
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(secret)
    expect(decryptSecret(b)).toBe(secret)
  })

  it('throws on a tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('whsec_tamper')
    const parts = enc.split(':')
    const data = Buffer.from(parts[3]!, 'base64')
    data[0] = data[0]! ^ 0xff
    parts[3] = data.toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })

  it('throws on a malformed stored value', () => {
    expect(() => decryptSecret('not-a-valid-blob')).toThrow('Malformed')
    expect(() => decryptSecret('v2:a:b:c')).toThrow('Malformed')
  })

  it('generates a prefixed webhook secret', () => {
    const s = generateWebhookSecret()
    expect(s.startsWith('whsec_')).toBe(true)
    expect(s.length).toBeGreaterThan(20)
    expect(generateWebhookSecret()).not.toBe(s)
  })

  it('signs deterministically and matches a raw HMAC-SHA256', () => {
    const secret = 'whsec_sign'
    const body = JSON.stringify({ id: 'd1', event: 'segment.entered', data: { x: 1 } })
    const sig = signPayload(secret, body)
    const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(sig).toBe(expected)
    expect(signPayload(secret, body)).toBe(sig) // deterministic
  })
})
