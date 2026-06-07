import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
    },
  },
  insertEvents: vi.fn().mockResolvedValue(undefined),
}))

import { prisma, insertEvents } from '@engageiq/db'
import { ingestCustomEvent } from './service.js'

describe('ingestCustomEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts event to ClickHouse with correct fields', async () => {
    const result = await ingestCustomEvent('merchant-1', {
      event_name: 'quiz_completed',
      properties: { quiz_id: 'q1', score: 95 },
    })

    // No customer_id provided — findFirst must NOT be called
    expect(prisma.customer.findFirst).not.toHaveBeenCalled()
    expect(insertEvents).toHaveBeenCalledOnce()
    const [events] = vi.mocked(insertEvents).mock.calls[0]!
    expect(events).toHaveLength(1)
    expect(events![0]).toMatchObject({
      merchant_id: 'merchant-1',
      event_type: 'quiz_completed',
      customer_id: null,
      anon_id: null,
    })
    expect(events![0]!.properties).toEqual({ quiz_id: 'q1', score: 95 })
    expect(result.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('throws CUSTOMER_NOT_FOUND when customer_id does not belong to merchant', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)

    await expect(
      ingestCustomEvent('merchant-1', {
        event_name: 'purchase',
        customer_id: 'clabcdefghij0123456789ab',
        properties: {},
      }),
    ).rejects.toThrow('CUSTOMER_NOT_FOUND')
    expect(insertEvents).not.toHaveBeenCalled()
  })

  it('includes customer_id in the event when customer exists', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never)

    await ingestCustomEvent('merchant-1', {
      event_name: 'loyalty_earned',
      customer_id: 'clabcdefghij0123456789ab',
      properties: { points: 100 },
    })

    const [events] = vi.mocked(insertEvents).mock.calls[0]!
    expect(events![0]!.customer_id).toBe('clabcdefghij0123456789ab')
  })

  it('uses provided timestamp when given', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)
    const ts = '2024-06-01T12:00:00.000Z'

    await ingestCustomEvent('merchant-1', {
      event_name: 'page_viewed',
      properties: {},
      timestamp: ts,
    })

    const [events] = vi.mocked(insertEvents).mock.calls[0]!
    expect(events![0]!.timestamp).toEqual(new Date(ts))
  })

  it('defaults to current time when timestamp is omitted', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)
    const before = new Date()

    await ingestCustomEvent('merchant-1', {
      event_name: 'button_clicked',
      properties: {},
    })

    const after = new Date()
    const [events] = vi.mocked(insertEvents).mock.calls[0]!
    const ts = events![0]!.timestamp
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})
