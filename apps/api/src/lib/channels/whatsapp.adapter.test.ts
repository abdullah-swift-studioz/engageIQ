import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mutable env mock — tests tweak fields (e.g. clear the token) per case.
vi.mock('@engageiq/shared', () => ({
  env: {
    META_WHATSAPP_TOKEN: 'test-token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'phone-123',
    META_API_VERSION: 'v21.0',
  },
}))

import { WhatsAppAdapter } from './whatsapp.adapter.js'
import { env } from '@engageiq/shared'
import type { ChannelSendPayload } from '@engageiq/shared'

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

const adapter = new WhatsAppAdapter()

beforeEach(() => {
  mutableEnv.META_WHATSAPP_TOKEN = 'test-token'
  mutableEnv.META_WHATSAPP_PHONE_NUMBER_ID = 'phone-123'
  mutableEnv.META_API_VERSION = 'v21.0'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WhatsAppAdapter.send — template', () => {
  it('builds a template payload and parses the wamid', async () => {
    const fetchMock = mockFetch({ ok: true, body: { messages: [{ id: 'wamid.ABC' }] } })
    const payload: ChannelSendPayload = {
      channel: 'WHATSAPP',
      toPhone: '+923001234567',
      templateName: 'order_update',
      languageCode: 'ur',
      category: 'UTILITY',
      variables: ['Fatima', 'Lahore'],
    }

    const result = await adapter.send(payload)

    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.ABC' })
    const [, init] = fetchMock.mock.calls[0]
    const sent = JSON.parse((init as { body: string }).body)
    expect(sent.type).toBe('template')
    expect(sent.template.name).toBe('order_update')
    expect(sent.template.language).toEqual({ code: 'ur' })
    expect(sent.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Fatima' },
      { type: 'text', text: 'Lahore' },
    ])
  })

  it('builds the endpoint from META_API_VERSION (no hardcoded version)', async () => {
    mutableEnv.META_API_VERSION = 'v19.0'
    const fetchMock = mockFetch({ ok: true, body: { messages: [{ id: 'wamid.X' }] } })

    await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'hi' })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v19.0/phone-123/messages')
  })
})

describe('WhatsAppAdapter.send — free-form', () => {
  it('builds a text payload', async () => {
    const fetchMock = mockFetch({ ok: true, body: { messages: [{ id: 'wamid.T' }] } })

    await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'Hello there' })

    const [, init] = fetchMock.mock.calls[0]
    const sent = JSON.parse((init as { body: string }).body)
    expect(sent.type).toBe('text')
    expect(sent.text).toEqual({ body: 'Hello there' })
  })
})

describe('WhatsAppAdapter.send — error mapping', () => {
  it('maps a 5xx to a retryable failure', async () => {
    mockFetch({ ok: false, status: 503, body: { error: { code: 131000, message: 'Service unavailable' } } })
    const result = await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'x' })
    expect(result).toEqual({ ok: false, retryable: true, errorCode: '131000', errorTitle: 'Service unavailable' })
  })

  it('maps a 4xx to a non-retryable failure', async () => {
    mockFetch({ ok: false, status: 400, body: { error: { code: 131009, message: 'Invalid parameter' } } })
    const result = await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'x' })
    expect(result).toEqual({ ok: false, retryable: false, errorCode: '131009', errorTitle: 'Invalid parameter' })
  })

  it('maps a 429 to a retryable failure', async () => {
    mockFetch({ ok: false, status: 429, body: { error: { code: 130429, message: 'Rate limit hit' } } })
    const result = await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })
})

describe('WhatsAppAdapter.send — not configured', () => {
  it('returns a clean non-retryable failure without calling fetch', async () => {
    mutableEnv.META_WHATSAPP_TOKEN = undefined
    const fetchMock = mockFetch({ ok: true, body: {} })

    const result = await adapter.send({ channel: 'WHATSAPP', toPhone: '+92300', freeFormText: 'x' })

    expect(result).toEqual({ ok: false, retryable: false, errorTitle: 'WhatsApp not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
