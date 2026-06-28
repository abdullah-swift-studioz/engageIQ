import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    campaign: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    segment: { findFirst: vi.fn() },
  },
}))

import {
  prepareSend,
  cancelCampaign,
  updateCampaign,
  deleteCampaign,
} from './service.js'
import { prisma } from '@engageiq/db'

const mockPrisma = prisma as unknown as {
  campaign: {
    findFirst: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  segment: { findFirst: ReturnType<typeof vi.fn> }
}

const MERCHANT = 'merchant_1'
const ID = 'campaign_1'
const SEGMENT_ID = 'segment_1'
const NOW = 1_700_000_000_000

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    merchantId: MERCHANT,
    status: 'DRAFT',
    segmentId: SEGMENT_ID,
    subject: null,
    content: { body: 'hello' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.campaign.update.mockImplementation(({ data }) => Promise.resolve(campaign(data)))
  mockPrisma.campaign.delete.mockResolvedValue({})
  mockPrisma.segment.findFirst.mockResolvedValue({ id: SEGMENT_ID })
})

describe('prepareSend', () => {
  it('returns 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null)
    const r = await prepareSend(MERCHANT, ID, null, NOW)
    expect(r).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' })
  })

  it('rejects a campaign already SENT', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'SENT' }))
    const r = await prepareSend(MERCHANT, ID, null, NOW)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'INVALID_STATE' })
  })

  it('rejects when no target segment', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ segmentId: null }))
    const r = await prepareSend(MERCHANT, ID, null, NOW)
    expect(r).toMatchObject({ ok: false, status: 400, code: 'NO_SEGMENT' })
  })

  it('rejects when no message body', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ content: {} }))
    const r = await prepareSend(MERCHANT, ID, null, NOW)
    expect(r).toMatchObject({ ok: false, status: 400, code: 'NO_CONTENT' })
  })

  it('rejects when the target segment is not owned by the merchant', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign())
    mockPrisma.segment.findFirst.mockResolvedValue(null)
    const r = await prepareSend(MERCHANT, ID, null, NOW)
    expect(r).toMatchObject({ ok: false, status: 400, code: 'SEGMENT_NOT_FOUND' })
  })

  it('send-now (no sendAt) yields delayMs 0 and SCHEDULED status', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign())
    const r = await prepareSend(MERCHANT, ID, null, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.delayMs).toBe(0)
      expect(mockPrisma.campaign.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: expect.objectContaining({ status: 'SCHEDULED' }),
      })
    }
  })

  it('future sendAt yields a positive delayMs', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign())
    const future = new Date(NOW + 60_000).toISOString()
    const r = await prepareSend(MERCHANT, ID, future, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.delayMs).toBe(60_000)
  })

  it('past sendAt clamps delayMs to 0', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign())
    const past = new Date(NOW - 60_000).toISOString()
    const r = await prepareSend(MERCHANT, ID, past, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.delayMs).toBe(0)
  })
})

describe('cancelCampaign', () => {
  it('cancels a SCHEDULED campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'SCHEDULED' }))
    const r = await cancelCampaign(MERCHANT, ID)
    expect(r.ok).toBe(true)
    expect(mockPrisma.campaign.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { status: 'CANCELLED' },
    })
  })

  it('refuses to cancel a DRAFT campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'DRAFT' }))
    const r = await cancelCampaign(MERCHANT, ID)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'INVALID_STATE' })
  })

  it('returns 404 for an unknown campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null)
    const r = await cancelCampaign(MERCHANT, ID)
    expect(r).toMatchObject({ ok: false, status: 404 })
  })
})

describe('updateCampaign', () => {
  it('merges body into the content JSON on a DRAFT', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ content: { body: 'old' } }))
    const r = await updateCampaign(MERCHANT, ID, { body: 'new' })
    expect(r.ok).toBe(true)
    expect(mockPrisma.campaign.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: expect.objectContaining({ content: { body: 'new' } }),
    })
  })

  it('refuses to edit a SENT campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'SENT' }))
    const r = await updateCampaign(MERCHANT, ID, { name: 'x' })
    expect(r).toMatchObject({ ok: false, status: 409, code: 'INVALID_STATE' })
  })
})

describe('deleteCampaign', () => {
  it('refuses to delete a SENDING campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'SENDING' }))
    const r = await deleteCampaign(MERCHANT, ID)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'INVALID_STATE' })
  })

  it('deletes a DRAFT campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'DRAFT' }))
    const r = await deleteCampaign(MERCHANT, ID)
    expect(r.ok).toBe(true)
    expect(mockPrisma.campaign.delete).toHaveBeenCalledWith({ where: { id: ID } })
  })
})
