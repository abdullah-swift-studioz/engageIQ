import { describe, it, expect, vi, beforeEach } from 'vitest'

// lane:ai-wiring — tests for the DELIVERED/READ campaign-recipient propagation added to the
// WhatsApp webhook. Own test file (does not touch lane:channels' whatsapp.test.ts).
vi.mock('@engageiq/shared', () => ({ env: { META_APP_SECRET: '', META_WEBHOOK_VERIFY_TOKEN: 't' } }))
vi.mock('@engageiq/db', () => ({
  prisma: {
    campaignRecipient: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    message: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    customer: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@engageiq/db'
import { propagateCampaignRecipient } from './whatsapp.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('propagateCampaignRecipient', () => {
  it('advances SENT → DELIVERED', async () => {
    ;(prisma.campaignRecipient.findUnique as any).mockResolvedValue({ id: 'r1', status: 'SENT' })
    await propagateCampaignRecipient('msg1', 'DELIVERED')
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'DELIVERED' },
    })
  })

  it('advances DELIVERED → READ', async () => {
    ;(prisma.campaignRecipient.findUnique as any).mockResolvedValue({ id: 'r1', status: 'DELIVERED' })
    await propagateCampaignRecipient('msg1', 'READ')
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'READ' },
    })
  })

  it('never regresses (READ recipient, DELIVERED event)', async () => {
    ;(prisma.campaignRecipient.findUnique as any).mockResolvedValue({ id: 'r1', status: 'READ' })
    await propagateCampaignRecipient('msg1', 'DELIVERED')
    expect(prisma.campaignRecipient.update).not.toHaveBeenCalled()
  })

  it('marks FAILED + stamps failedAt on a post-send failure', async () => {
    ;(prisma.campaignRecipient.findUnique as any).mockResolvedValue({ id: 'r1', status: 'SENT' })
    await propagateCampaignRecipient('msg1', 'FAILED')
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  it('leaves terminal statuses (SKIPPED) untouched', async () => {
    ;(prisma.campaignRecipient.findUnique as any).mockResolvedValue({ id: 'r1', status: 'SKIPPED' })
    await propagateCampaignRecipient('msg1', 'READ')
    expect(prisma.campaignRecipient.update).not.toHaveBeenCalled()
  })

  it('ignores non-delivery statuses and messages not tied to a campaign', async () => {
    await propagateCampaignRecipient('msg1', 'SENT')
    expect(prisma.campaignRecipient.findUnique).not.toHaveBeenCalled()

    ;(prisma.campaignRecipient.findUnique as any).mockResolvedValue(null)
    await propagateCampaignRecipient('msg1', 'READ')
    expect(prisma.campaignRecipient.update).not.toHaveBeenCalled()
  })
})
