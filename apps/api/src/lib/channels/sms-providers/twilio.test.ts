import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@engageiq/shared', () => ({
  env: {
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'tok',
    TWILIO_FROM_NUMBER: '+15550001111',
  },
}))

import { TwilioSmsProvider } from './twilio.js'
import { env } from '@engageiq/shared'

const mutableEnv = env as unknown as Record<string, string | undefined>

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.body,
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const provider = new TwilioSmsProvider()

beforeEach(() => {
  mutableEnv.TWILIO_ACCOUNT_SID = 'AC123'
  mutableEnv.TWILIO_AUTH_TOKEN = 'tok'
  mutableEnv.TWILIO_FROM_NUMBER = '+15550001111'
  mutableEnv.TWILIO_MESSAGING_SERVICE_SID = undefined
  mutableEnv.TWILIO_STATUS_CALLBACK_URL = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TwilioSmsProvider.send', () => {
  it('posts a form with To/From/Body and Basic auth, returns the sid', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, body: { sid: 'SM999' } })

    const result = await provider.send('+923001234567', 'hello')

    expect(result).toEqual({ ok: true, providerMessageId: 'SM999' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    const headers = (init as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('AC123:tok').toString('base64'))
    const form = new URLSearchParams((init as { body: string }).body)
    expect(form.get('To')).toBe('+923001234567')
    expect(form.get('From')).toBe('+15550001111')
    expect(form.get('Body')).toBe('hello')
  })

  it('prefers a Messaging Service SID over the From number', async () => {
    mutableEnv.TWILIO_MESSAGING_SERVICE_SID = 'MG123'
    const fetchMock = mockFetch({ ok: true, status: 201, body: { sid: 'SM1' } })

    await provider.send('+92300', 'x')

    const form = new URLSearchParams((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(form.get('MessagingServiceSid')).toBe('MG123')
    expect(form.get('From')).toBeNull()
  })

  it('maps a 429 to a retryable failure', async () => {
    mockFetch({ ok: false, status: 429, body: { code: 20429, message: 'Too many requests' } })
    const result = await provider.send('+92300', 'x')
    expect(result).toEqual({ ok: false, retryable: true, errorCode: '20429', errorTitle: 'Too many requests' })
  })

  it('maps a 4xx to a non-retryable failure', async () => {
    mockFetch({ ok: false, status: 400, body: { code: 21211, message: 'Invalid To number' } })
    const result = await provider.send('+92300', 'x')
    expect(result).toEqual({ ok: false, retryable: false, errorCode: '21211', errorTitle: 'Invalid To number' })
  })

  it('returns non-retryable "not configured" without calling fetch when creds are absent', async () => {
    mutableEnv.TWILIO_AUTH_TOKEN = undefined
    const fetchMock = mockFetch({ ok: true, body: {} })
    const result = await provider.send('+92300', 'x')
    expect(result).toEqual({ ok: false, retryable: false, errorTitle: 'Twilio not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
