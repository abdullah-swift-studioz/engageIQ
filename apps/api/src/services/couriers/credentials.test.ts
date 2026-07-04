import { describe, it, expect, vi, beforeEach } from 'vitest'

// A valid 32-byte key as 64 hex chars.
const KEY = 'a'.repeat(64)

// Load the module fresh with a chosen env + prisma mock (env is read at module load).
async function loadWithEnv(courierKey: string | undefined) {
  vi.resetModules()
  vi.doMock('@engageiq/shared', () => ({ env: { COURIER_CREDENTIALS_KEY: courierKey } }))
  vi.doMock('@engageiq/db', () => ({
    prisma: { merchantIntegration: { findUnique: vi.fn() } },
  }))
  const mod = await import('./credentials.js')
  const db = await import('@engageiq/db')
  return { mod, prisma: (db as unknown as { prisma: { merchantIntegration: { findUnique: ReturnType<typeof vi.fn> } } }).prisma }
}

describe('credential encryption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('round-trips an object through encrypt → decrypt', async () => {
    const { mod } = await loadWithEnv(KEY)
    const secret = { token: 'postex-secret', apiPassword: 'p@ss', n: 42 }
    const envelope = mod.encryptCredentials(secret)
    expect(typeof envelope.enc).toBe('string')
    expect(envelope.enc).not.toContain('postex-secret') // actually encrypted
    expect(mod.decryptCredentials(envelope)).toEqual(secret)
  })

  it('produces a different ciphertext each call (random IV) but same plaintext', async () => {
    const { mod } = await loadWithEnv(KEY)
    const a = mod.encryptCredentials({ token: 'x' })
    const b = mod.encryptCredentials({ token: 'x' })
    expect(a.enc).not.toEqual(b.enc)
    expect(mod.decryptCredentials(a)).toEqual(mod.decryptCredentials(b))
  })

  it('fails closed: decrypt returns null on tampered / malformed input', async () => {
    const { mod } = await loadWithEnv(KEY)
    expect(mod.decryptCredentials({ enc: 'not-base64-cipher' })).toBeNull()
    expect(mod.decryptCredentials({})).toBeNull()
    expect(mod.decryptCredentials(null)).toBeNull()
    expect(mod.decryptCredentials('nope')).toBeNull()
  })

  it('without a key: not configured, encrypt throws, decrypt null', async () => {
    const { mod } = await loadWithEnv(undefined)
    expect(mod.isCredentialKeyConfigured()).toBe(false)
    expect(() => mod.encryptCredentials({ token: 'x' })).toThrow()
    expect(mod.decryptCredentials({ enc: 'anything' })).toBeNull()
  })
})

describe('loadCourierIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no-integration when the row is missing', async () => {
    const { mod, prisma } = await loadWithEnv(KEY)
    prisma.merchantIntegration.findUnique.mockResolvedValue(null)
    expect(await mod.loadCourierIntegration('m1', 'POSTEX' as never)).toEqual({ ok: false, reason: 'no-integration' })
  })

  it('returns inactive when isActive=false', async () => {
    const { mod, prisma } = await loadWithEnv(KEY)
    prisma.merchantIntegration.findUnique.mockResolvedValue({ isActive: false, credentials: { enc: 'x' }, config: null })
    expect(await mod.loadCourierIntegration('m1', 'POSTEX' as never)).toEqual({ ok: false, reason: 'inactive' })
  })

  it('returns no-encryption-key when the app has no key', async () => {
    const { mod, prisma } = await loadWithEnv(undefined)
    prisma.merchantIntegration.findUnique.mockResolvedValue({ isActive: true, credentials: { enc: 'x' }, config: null })
    expect(await mod.loadCourierIntegration('m1', 'POSTEX' as never)).toEqual({ ok: false, reason: 'no-encryption-key' })
  })

  it('decrypts and returns the context on the happy path', async () => {
    const { mod, prisma } = await loadWithEnv(KEY)
    const enc = mod.encryptCredentials({ token: 'abc' })
    prisma.merchantIntegration.findUnique.mockResolvedValue({ isActive: true, credentials: enc, config: { baseUrl: 'https://x' } })
    const res = await mod.loadCourierIntegration('m1', 'POSTEX' as never)
    expect(res).toEqual({ ok: true, context: { credentials: { token: 'abc' }, config: { baseUrl: 'https://x' } } })
  })
})
