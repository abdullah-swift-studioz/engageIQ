import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    campaign: { findFirst: vi.fn(), update: vi.fn() },
    customer: { findMany: vi.fn() },
    campaignRecipient: { createMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  redisConnection: {},
}))

vi.mock('@engageiq/shared', () => ({
  MESSAGE_DISPATCH: 'message-dispatch',
}))

import { processCampaignSendJob, type DispatchMessageFn } from './campaign-send.worker.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  campaign: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  customer: { findMany: ReturnType<typeof vi.fn> }
  campaignRecipient: {
    createMany: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
}

const MERCHANT = 'merchant_1'
const CAMPAIGN_ID = 'campaign_1'
const SEGMENT_ID = 'segment_1'

function baseCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    merchantId: MERCHANT,
    name: 'Eid Blast',
    channel: 'WHATSAPP',
    status: 'SCHEDULED',
    segmentId: SEGMENT_ID,
    subject: null,
    content: { body: 'Eid Mubarak! 20% off today.' },
    ...overrides,
  }
}

let dispatch: Mock<Parameters<DispatchMessageFn>, ReturnType<DispatchMessageFn>>

beforeEach(() => {
  vi.clearAllMocks()
  dispatch = vi.fn<Parameters<DispatchMessageFn>, ReturnType<DispatchMessageFn>>()
  dispatch.mockResolvedValue(undefined)
  mockPrisma.campaign.update.mockResolvedValue({})
  mockPrisma.customer.findMany.mockResolvedValue([])
  mockPrisma.campaignRecipient.createMany.mockResolvedValue({ count: 0 })
  mockPrisma.campaignRecipient.findMany.mockResolvedValue([])
  mockPrisma.campaignRecipient.count.mockResolvedValue(0)
})

describe('processCampaignSendJob — happy path', () => {
  it('materializes recipients, dispatches one job per pending recipient, marks SENT', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign())
    mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust_1' }, { id: 'cust_2' }])
    mockPrisma.campaignRecipient.findMany.mockResolvedValue([
      { id: 'rec_1', customerId: 'cust_1' },
      { id: 'rec_2', customerId: 'cust_2' },
    ])
    mockPrisma.campaignRecipient.count.mockResolvedValue(2)

    const result = await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )

    expect(result).toEqual({ campaignId: CAMPAIGN_ID, recipientCount: 2, dispatched: 2, skipped: false })

    // CampaignRecipient rows created idempotently
    expect(mockPrisma.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        { merchantId: MERCHANT, campaignId: CAMPAIGN_ID, customerId: 'cust_1' },
        { merchantId: MERCHANT, campaignId: CAMPAIGN_ID, customerId: 'cust_2' },
      ],
      skipDuplicates: true,
    })

    // One dispatch per recipient, with attribution + dedup jobId
    expect(dispatch).toHaveBeenCalledTimes(2)
    const firstCall = dispatch.mock.calls[0]!
    const firstJob = firstCall[0]
    const firstOpts = firstCall[1]
    expect(firstJob).toEqual({
      type: 'send',
      channel: 'WHATSAPP',
      merchantId: MERCHANT,
      customerId: 'cust_1',
      content: { body: 'Eid Mubarak! 20% off today.' },
      campaignId: CAMPAIGN_ID,
      campaignRecipientId: 'rec_1',
    })
    expect(firstOpts).toEqual({ jobId: 'cr_rec_1' })

    // Final transition to SENT with recipientCount
    expect(mockPrisma.campaign.update).toHaveBeenLastCalledWith({
      where: { id: CAMPAIGN_ID },
      data: expect.objectContaining({ status: 'SENT', recipientCount: 2 }),
    })
  })

  it('includes subject in dispatch content for email campaigns', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(
      baseCampaign({ channel: 'EMAIL', subject: 'Eid Sale', content: { body: 'Shop now' } }),
    )
    mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust_1' }])
    mockPrisma.campaignRecipient.findMany.mockResolvedValue([{ id: 'rec_1', customerId: 'cust_1' }])
    mockPrisma.campaignRecipient.count.mockResolvedValue(1)

    await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )

    const job = dispatch.mock.calls[0]![0]
    expect(job.content).toEqual({ body: 'Shop now', subject: 'Eid Sale' })
    expect(job.channel).toBe('EMAIL')
  })
})

describe('processCampaignSendJob — eligibility / suppression', () => {
  it('filters recipients by channel subscription, block, merge, and active segment membership', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ channel: 'WHATSAPP' }))

    await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )

    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith({
      where: {
        merchantId: MERCHANT,
        mergedIntoId: null,
        isBlocked: false,
        segmentMemberships: { some: { segmentId: SEGMENT_ID, exitedAt: null } },
        isSubscribedWhatsapp: true,
        phone: { not: null },
      },
      select: { id: true },
    })
  })

  it('uses email subscription + email-present filter for EMAIL channel', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ channel: 'EMAIL' }))
    await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )
    const where = mockPrisma.customer.findMany.mock.calls[0]![0].where
    expect(where.isSubscribedEmail).toBe(true)
    expect(where.email).toEqual({ not: null })
  })

  it('does not dispatch when no eligible recipients', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign())
    mockPrisma.customer.findMany.mockResolvedValue([])
    mockPrisma.campaignRecipient.findMany.mockResolvedValue([])
    mockPrisma.campaignRecipient.count.mockResolvedValue(0)

    const result = await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )

    expect(dispatch).not.toHaveBeenCalled()
    expect(mockPrisma.campaignRecipient.createMany).not.toHaveBeenCalled()
    expect(result.dispatched).toBe(0)
    expect(mockPrisma.campaign.update).toHaveBeenLastCalledWith({
      where: { id: CAMPAIGN_ID },
      data: expect.objectContaining({ status: 'SENT' }),
    })
  })
})

describe('processCampaignSendJob — idempotency', () => {
  it('only dispatches PENDING recipients (skips already-sent ones on re-run)', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ status: 'SENDING' }))
    mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust_1' }, { id: 'cust_2' }])
    // Only one still pending; the other was already handed off by Lane A
    mockPrisma.campaignRecipient.findMany.mockResolvedValue([{ id: 'rec_2', customerId: 'cust_2' }])
    mockPrisma.campaignRecipient.count.mockResolvedValue(2)

    const result = await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]![0].campaignRecipientId).toBe('rec_2')
    expect(result.dispatched).toBe(1)
  })

  it('is a no-op for a campaign already CANCELLED', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ status: 'CANCELLED' }))

    const result = await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )

    expect(result.skipped).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    expect(mockPrisma.customer.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.campaign.update).not.toHaveBeenCalled()
  })

  it('is a no-op for a SENT campaign (duplicate job delivery)', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ status: 'SENT' }))
    const result = await processCampaignSendJob(
      { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
      { dispatch },
    )
    expect(result.skipped).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('processCampaignSendJob — invalid campaigns', () => {
  it('throws UnrecoverableError when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null)
    await expect(
      processCampaignSendJob(
        { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
        { dispatch },
      ),
    ).rejects.toThrow(/not found/)
  })

  it('throws UnrecoverableError when campaign has no segment', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ segmentId: null }))
    await expect(
      processCampaignSendJob(
        { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
        { dispatch },
      ),
    ).rejects.toThrow(/no target segment/)
  })

  it('throws UnrecoverableError when campaign has no body', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(baseCampaign({ content: {} }))
    await expect(
      processCampaignSendJob(
        { type: 'send_campaign', campaignId: CAMPAIGN_ID, merchantId: MERCHANT },
        { dispatch },
      ),
    ).rejects.toThrow(/no message body/)
  })
})
