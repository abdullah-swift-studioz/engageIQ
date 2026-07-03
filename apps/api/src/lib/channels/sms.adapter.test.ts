import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mutable env mock — tests toggle which providers are configured per case.
vi.mock('@engageiq/shared', () => ({
  env: {
    SMS_PRIMARY_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'tok',
    TWILIO_FROM_NUMBER: '+15550001111',
  },
}))

import { SmsAdapter } from './sms.adapter.js'
import { env } from '@engageiq/shared'
import type { ChannelSendPayload } from '@engageiq/shared'

const mutableEnv = env as unknown as Record<string, string | undefined>

// Sequential fetch responses: call N returns queue[N]. Twilio is fetched before PK.
function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.body,
    })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

const adapter = new SmsAdapter()
const smsPayload: ChannelSendPayload = { channel: 'SMS', toPhone: '+923001234567', body: 'Order confirmed' }

beforeEach(() => {
  mutableEnv.SMS_PRIMARY_PROVIDER = 'twilio'
  mutableEnv.TWILIO_ACCOUNT_SID = 'AC123'
  mutableEnv.TWILIO_AUTH_TOKEN = 'tok'
  mutableEnv.TWILIO_FROM_NUMBER = '+15550001111'
  mutableEnv.TWILIO_MESSAGING_SERVICE_SID = undefined
  mutableEnv.PK_SMS_API_URL = undefined
  mutableEnv.PK_SMS_API_KEY = undefined
  mutableEnv.PK_SMS_SENDER_ID = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SmsAdapter.send — not configured', () => {
  it('returns a clean non-retryable failure when no provider has credentials', async () => {
    mutableEnv.TWILIO_ACCOUNT_SID = undefined
    mutableEnv.TWILIO_AUTH_TOKEN = undefined
    const fetchMock = mockFetchSequence([])

    const result = await adapter.send(smsPayload)

    expect(result).toEqual({ ok: false, retryable: false, errorTitle: 'SMS not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SmsAdapter.send — success', () => {
  it('sends via Twilio (primary) and returns its sid', async () => {
    mockFetchSequence([{ ok: true, body: { sid: 'SM123' } }])
    const result = await adapter.send(smsPayload)
    expect(result).toEqual({ ok: true, providerMessageId: 'SM123' })
  })
})

describe('SmsAdapter.send — failover', () => {
  it('falls over to the PK aggregator when Twilio returns a 5xx', async () => {
    mutableEnv.PK_SMS_API_URL = 'https://pk.example/send'
    mutableEnv.PK_SMS_API_KEY = 'pk-key'
    // 1st fetch = Twilio 503, 2nd fetch = PK 200.
    const fetchMock = mockFetchSequence([
      { ok: false, status: 503, body: { message: 'Twilio down' } },
      { ok: true, body: { id: 'abc' } },
    ])

    const result = await adapter.send(smsPayload)

    expect(result).toEqual({ ok: true, providerMessageId: 'pk_abc' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports retryable when every provider fails transiently', async () => {
    mutableEnv.PK_SMS_API_URL = 'https://pk.example/send'
    mutableEnv.PK_SMS_API_KEY = 'pk-key'
    mockFetchSequence([
      { ok: false, status: 503, body: { message: 'Twilio down' } },
      { ok: false, status: 500, body: { error: 'PK down' } },
    ])

    const result = await adapter.send(smsPayload)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })

  it('reports permanent failure when every provider rejects with a 4xx', async () => {
    mutableEnv.PK_SMS_API_URL = 'https://pk.example/send'
    mutableEnv.PK_SMS_API_KEY = 'pk-key'
    mockFetchSequence([
      { ok: false, status: 400, body: { code: 21211, message: 'Invalid To' } },
      { ok: false, status: 400, body: { error: 'bad number' } },
    ])

    const result = await adapter.send(smsPayload)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(false)
  })
})

describe('SmsAdapter.send — wrong channel guard', () => {
  it('rejects a non-SMS payload without calling a provider', async () => {
    const fetchMock = mockFetchSequence([])
    const result = await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'x' })
    expect(result).toEqual({ ok: false, retryable: false, errorTitle: 'SmsAdapter received non-SMS payload' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
