import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock state (vi.mock factories are hoisted above normal const declarations).
const h = vi.hoisted(() => ({ sendNotification: vi.fn(), configured: true }))
vi.mock('web-push', () => ({ default: { sendNotification: h.sendNotification, setVapidDetails: vi.fn() } }))
vi.mock('../../services/push/vapid.js', () => ({ ensureVapidConfigured: () => h.configured }))

import { PushAdapter } from './push.adapter.js'
import type { ChannelSendPayload } from '@engageiq/shared'

const adapter = new PushAdapter()
const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }
const payload: ChannelSendPayload = {
  channel: 'PUSH',
  subscription: sub,
  notification: { title: 'Hi', body: 'Your order shipped', url: 'https://shop/orders/1' },
}

beforeEach(() => {
  h.configured = true
  h.sendNotification.mockReset()
})

describe('PushAdapter.send', () => {
  it('returns "Push not configured" without calling web-push when VAPID is absent', async () => {
    h.configured = false
    const result = await adapter.send(payload)
    expect(result).toEqual({ ok: false, retryable: false, errorTitle: 'Push not configured' })
    expect(h.sendNotification).not.toHaveBeenCalled()
  })

  it('serializes the notification and reports success', async () => {
    h.sendNotification.mockResolvedValue({ statusCode: 201, headers: {} })
    const result = await adapter.send(payload)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.providerMessageId).toBe(sub.endpoint)

    const [sentSub, body] = h.sendNotification.mock.calls[0]
    expect(sentSub).toEqual({ endpoint: sub.endpoint, keys: sub.keys })
    expect(JSON.parse(body as string)).toEqual({
      title: 'Hi',
      body: 'Your order shipped',
      url: 'https://shop/orders/1',
    })
  })

  it('maps 404/410 to a non-retryable GONE result (caller prunes)', async () => {
    h.sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    const result = await adapter.send(payload)
    expect(result).toEqual({ ok: false, retryable: false, errorCode: 'GONE', errorTitle: 'gone' })
  })

  it('maps 5xx to a retryable failure', async () => {
    h.sendNotification.mockRejectedValue(Object.assign(new Error('busy'), { statusCode: 503 }))
    const result = await adapter.send(payload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryable).toBe(true)
  })

  it('maps a network error (no statusCode) to a retryable failure', async () => {
    h.sendNotification.mockRejectedValue(new Error('ECONNRESET'))
    const result = await adapter.send(payload)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.retryable).toBe(true)
      expect(result.errorCode).toBeUndefined()
    }
  })

  it('rejects a non-PUSH payload defensively', async () => {
    const result = await adapter.send({ channel: 'SMS', toPhone: '+92300', body: 'x' })
    expect(result.ok).toBe(false)
  })
})
