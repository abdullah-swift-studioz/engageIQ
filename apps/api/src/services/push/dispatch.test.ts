import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock state (vi.mock factories are hoisted above normal const declarations).
const h = vi.hoisted(() => ({
  customerFindFirst: vi.fn(),
  pushFindFirst: vi.fn(),
  messageCreate: vi.fn(),
  adapterSend: vi.fn(),
  getActiveSubscriptions: vi.fn(),
  pruneSubscription: vi.fn(),
  touchSubscription: vi.fn(),
}))

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: { findFirst: h.customerFindFirst },
    pushSubscription: { findFirst: h.pushFindFirst },
    message: { create: h.messageCreate },
  },
}))
vi.mock('../../lib/channels/push.adapter.js', () => ({ pushAdapter: { send: h.adapterSend } }))
vi.mock('./subscription.service.js', () => ({
  getActiveSubscriptions: h.getActiveSubscriptions,
  pruneSubscription: h.pruneSubscription,
  touchSubscription: h.touchSubscription,
}))

import { sendPushToCustomer } from './dispatch.js'

const opts = {
  merchantId: 'm1',
  customerId: 'c1',
  notification: { title: 'Hi', body: 'Order shipped' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.messageCreate.mockResolvedValue({ id: 'msg1' })
})

describe('sendPushToCustomer', () => {
  it('skips when the customer does not exist (no Message row)', async () => {
    h.customerFindFirst.mockResolvedValue(null)
    const r = await sendPushToCustomer(opts)
    expect(r).toMatchObject({ status: 'SKIPPED', reason: 'customer_not_found' })
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('skips an opted-out customer (respects isSubscribedPush)', async () => {
    h.customerFindFirst.mockResolvedValue({ id: 'c1', isSubscribedPush: false })
    const r = await sendPushToCustomer(opts)
    expect(r.status).toBe('SKIPPED')
    expect(r.reason).toBe('unsubscribed')
    expect(h.getActiveSubscriptions).not.toHaveBeenCalled()
  })

  it('bypasses consent when respectConsent is false', async () => {
    h.customerFindFirst.mockResolvedValue({ id: 'c1', isSubscribedPush: false })
    h.getActiveSubscriptions.mockResolvedValue([])
    const r = await sendPushToCustomer({ ...opts, respectConsent: false })
    expect(r.reason).toBe('no_active_subscription')
    expect(h.getActiveSubscriptions).toHaveBeenCalled()
  })

  it('skips when there are no active subscriptions', async () => {
    h.customerFindFirst.mockResolvedValue({ id: 'c1', isSubscribedPush: true })
    h.getActiveSubscriptions.mockResolvedValue([])
    const r = await sendPushToCustomer(opts)
    expect(r.status).toBe('SKIPPED')
    expect(r.reason).toBe('no_active_subscription')
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('fans out, prunes a GONE subscription, and logs a SENT Message', async () => {
    h.customerFindFirst.mockResolvedValue({ id: 'c1', isSubscribedPush: true })
    h.getActiveSubscriptions.mockResolvedValue([
      { id: 's1', endpoint: 'e1', keys: { p256dh: 'p', auth: 'a' } },
      { id: 's2', endpoint: 'e2', keys: { p256dh: 'p', auth: 'a' } },
    ])
    h.adapterSend
      .mockResolvedValueOnce({ ok: true, providerMessageId: 'e1' })
      .mockResolvedValueOnce({ ok: false, retryable: false, errorCode: 'GONE', errorTitle: 'gone' })

    const r = await sendPushToCustomer(opts)

    expect(r).toMatchObject({ status: 'SENT', messageId: 'msg1', sent: 1, failed: 1, pruned: 1 })
    expect(h.pruneSubscription).toHaveBeenCalledWith('s2')
    expect(h.touchSubscription).toHaveBeenCalledWith('s1')
    const createArg = h.messageCreate.mock.calls[0][0]
    expect(createArg.data).toMatchObject({ channel: 'PUSH', direction: 'OUTBOUND', status: 'SENT', toPhone: '' })
  })

  it('logs a FAILED Message when every subscription fails', async () => {
    h.customerFindFirst.mockResolvedValue({ id: 'c1', isSubscribedPush: true })
    h.getActiveSubscriptions.mockResolvedValue([{ id: 's1', endpoint: 'e1', keys: { p256dh: 'p', auth: 'a' } }])
    h.adapterSend.mockResolvedValue({ ok: false, retryable: true, errorTitle: 'busy' })

    const r = await sendPushToCustomer(opts)

    expect(r.status).toBe('FAILED')
    expect(h.pruneSubscription).not.toHaveBeenCalled()
    const createArg = h.messageCreate.mock.calls[0][0]
    expect(createArg.data.status).toBe('FAILED')
  })
})
