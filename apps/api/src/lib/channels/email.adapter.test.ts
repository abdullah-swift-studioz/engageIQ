import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ChannelSendPayload } from '@engageiq/shared'

const emailPayload: ChannelSendPayload = {
  channel: 'EMAIL',
  toEmail: 'ayesha@example.com',
  subject: 'Sale',
  html: '<p>hi</p>',
  text: 'hi',
}

// Re-import the adapter with a patched env so we can exercise each provider branch.
async function adapterWithEnv(overrides: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock('@engageiq/shared', async (orig) => {
    const actual = (await orig()) as Record<string, unknown>
    return { ...actual, env: { ...(actual.env as object), ...overrides } }
  })
  const mod = await import('./email.adapter.js')
  return mod.emailAdapter
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@engageiq/shared')
  vi.resetModules()
})

describe('EmailAdapter', () => {
  it('returns a clean non-retryable result when no provider is configured', async () => {
    const adapter = await adapterWithEnv({
      AWS_SES_FROM_EMAIL: 'no-reply@shop.com',
      EMAIL_FROM_NAME: 'Shop',
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      RESEND_API_KEY: undefined,
    })
    const res = await adapter.send(emailPayload)
    expect(res).toEqual({ ok: false, retryable: false, errorTitle: 'Email not configured' })
  })

  it('fails cleanly when no from address is set', async () => {
    const adapter = await adapterWithEnv({ AWS_SES_FROM_EMAIL: undefined })
    const res = await adapter.send(emailPayload)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.retryable).toBe(false)
  })

  it('sends via SES and returns the MessageId on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ MessageId: 'ses-123' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = await adapterWithEnv({
      AWS_REGION: 'us-east-1',
      AWS_SES_FROM_EMAIL: 'no-reply@shop.com',
      EMAIL_FROM_NAME: 'Shop',
      AWS_ACCESS_KEY_ID: 'AKIA_TEST',
      AWS_SECRET_ACCESS_KEY: 'secret_test',
    })
    const res = await adapter.send(emailPayload)
    expect(res).toEqual({ ok: true, providerMessageId: 'ses-123' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('email.us-east-1.amazonaws.com')
    expect((init as RequestInit).headers).toHaveProperty('Authorization')
  })

  it('marks a 4xx SES failure permanent and a 5xx transient', async () => {
    for (const [status, retryable] of [
      [400, false],
      [500, true],
      [429, true],
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'boom' }), { status }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const adapter = await adapterWithEnv({
        AWS_REGION: 'us-east-1',
        AWS_SES_FROM_EMAIL: 'no-reply@shop.com',
        AWS_ACCESS_KEY_ID: 'AKIA_TEST',
        AWS_SECRET_ACCESS_KEY: 'secret_test',
      })
      const res = await adapter.send(emailPayload)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.retryable).toBe(retryable)
    }
  })

  it('falls back to Resend when SES creds are absent but RESEND_API_KEY is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-9' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = await adapterWithEnv({
      AWS_SES_FROM_EMAIL: 'no-reply@shop.com',
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      RESEND_API_KEY: 're_test',
    })
    const res = await adapter.send(emailPayload)
    expect(res).toEqual({ ok: true, providerMessageId: 'resend-9' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails')
  })
})
