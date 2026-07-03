import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    outboundWebhook: { findMany: vi.fn() },
    webhookDelivery: { create: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  webhookDeliveryQueue: { add: vi.fn() },
}))

vi.mock('@engageiq/shared', () => ({
  WEBHOOK_DELIVERY: 'webhook-delivery',
}))

import { emitOutboundEvent } from './emit.js'
import { prisma } from '@engageiq/db'
import { webhookDeliveryQueue } from '@engageiq/queue'

const mockPrisma = prisma as unknown as {
  outboundWebhook: { findMany: ReturnType<typeof vi.fn> }
  webhookDelivery: { create: ReturnType<typeof vi.fn> }
}
const mockQueue = webhookDeliveryQueue as unknown as { add: ReturnType<typeof vi.fn> }

const MERCHANT = 'merchant_1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('emitOutboundEvent', () => {
  it('creates a delivery row and enqueues a job per matching webhook', async () => {
    mockPrisma.outboundWebhook.findMany.mockResolvedValue([{ id: 'wh_1' }, { id: 'wh_2' }])
    mockPrisma.webhookDelivery.create
      .mockResolvedValueOnce({ id: 'del_1' })
      .mockResolvedValueOnce({ id: 'del_2' })

    await emitOutboundEvent(MERCHANT, 'segment.entered', { segmentId: 's1', customerId: 'c1' })

    // scoped by merchantId + active + event subscription
    expect(mockPrisma.outboundWebhook.findMany).toHaveBeenCalledWith({
      where: { merchantId: MERCHANT, isActive: true, events: { has: 'segment.entered' } },
      select: { id: true },
    })
    expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledTimes(2)
    expect(mockQueue.add).toHaveBeenCalledTimes(2)
    expect(mockQueue.add).toHaveBeenCalledWith(
      'webhook-delivery',
      expect.objectContaining({ type: 'deliver', merchantId: MERCHANT, webhookId: 'wh_1', deliveryId: 'del_1' }),
      { jobId: 'whd_del_1' },
    )
  })

  it('does nothing when no webhook subscribes to the event', async () => {
    mockPrisma.outboundWebhook.findMany.mockResolvedValue([])
    await emitOutboundEvent(MERCHANT, 'campaign.completed', {})
    expect(mockPrisma.webhookDelivery.create).not.toHaveBeenCalled()
    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('never throws into the caller even if the DB errors', async () => {
    mockPrisma.outboundWebhook.findMany.mockRejectedValue(new Error('db down'))
    await expect(emitOutboundEvent(MERCHANT, 'segment.exited', {})).resolves.toBeUndefined()
  })
})
