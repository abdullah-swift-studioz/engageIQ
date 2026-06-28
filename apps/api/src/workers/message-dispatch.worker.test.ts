import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnrecoverableError } from 'bullmq'

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: { findFirst: vi.fn() },
    whatsAppTemplate: { findFirst: vi.fn() },
    message: { create: vi.fn() },
    campaignRecipient: { updateMany: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  messageDispatchQueue: { add: vi.fn() },
  redisConnection: {},
}))

vi.mock('@engageiq/shared', () => ({
  MESSAGE_DISPATCH: 'message-dispatch',
}))

const sendMock = vi.fn()
vi.mock('../lib/channels/registry.js', () => ({
  getAdapter: vi.fn(() => ({ channel: 'WHATSAPP', send: sendMock })),
}))

vi.mock('../lib/channels/rate-limit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  jitteredReEnqueueDelay: vi.fn().mockReturnValue(1234),
}))

import { processMessageDispatchJob } from './message-dispatch.worker.js'
import { prisma } from '@engageiq/db'
import { messageDispatchQueue } from '@engageiq/queue'
import { checkRateLimit } from '../lib/channels/rate-limit.js'
import type { MessageDispatchJob } from '@engageiq/shared'

const mockPrisma = prisma as unknown as {
  customer: { findFirst: ReturnType<typeof vi.fn> }
  whatsAppTemplate: { findFirst: ReturnType<typeof vi.fn> }
  message: { create: ReturnType<typeof vi.fn> }
  campaignRecipient: { updateMany: ReturnType<typeof vi.fn> }
}
const mockQueue = messageDispatchQueue as unknown as { add: ReturnType<typeof vi.fn> }
const mockCheckRate = checkRateLimit as unknown as ReturnType<typeof vi.fn>

const MERCHANT = 'merchant_1'
const CUSTOMER = 'customer_1'

const baseJob: MessageDispatchJob = {
  type: 'send',
  channel: 'WHATSAPP',
  merchantId: MERCHANT,
  customerId: CUSTOMER,
  content: { body: 'Hello' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRate.mockResolvedValue(true)
  mockPrisma.customer.findFirst.mockResolvedValue({
    id: CUSTOMER,
    merchantId: MERCHANT,
    phone: '+923001234567',
    firstName: 'Fatima',
    city: 'Lahore',
    isSubscribedWhatsapp: true,
  })
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_1' })
  sendMock.mockResolvedValue({ ok: true, providerMessageId: 'wamid.OK' })
})

describe('processMessageDispatchJob — consent', () => {
  it('skips an opted-out customer with no Message row', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER, merchantId: MERCHANT, phone: '+92300', isSubscribedWhatsapp: false,
    })
    await processMessageDispatchJob(baseJob)
    expect(sendMock).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('throws UnrecoverableError when the customer does not exist', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null)
    await expect(processMessageDispatchJob(baseJob)).rejects.toBeInstanceOf(UnrecoverableError)
  })
})

describe('processMessageDispatchJob — stub channels', () => {
  it('skips non-WhatsApp channels without sending', async () => {
    await processMessageDispatchJob({ ...baseJob, channel: 'SMS' })
    expect(sendMock).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })
})

describe('processMessageDispatchJob — success', () => {
  it('persists a SENT Message with the wamid for a free-form send', async () => {
    await processMessageDispatchJob(baseJob)
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'WHATSAPP', toPhone: '+923001234567', freeFormText: 'Hello' }),
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT', providerMessageId: 'wamid.OK', direction: 'OUTBOUND' }),
      }),
    )
  })

  it('substitutes template variables (with default) and sends a template payload', async () => {
    mockPrisma.whatsAppTemplate.findFirst.mockResolvedValue({
      id: 'tmpl_1', name: 'order_update', language: 'ur', category: 'UTILITY', status: 'APPROVED',
      variableMap: [{ index: 1, field: 'firstName', default: 'there' }, { index: 2, field: 'city' }],
    })
    await processMessageDispatchJob({ ...baseJob, templateId: 'tmpl_1' })
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'order_update', languageCode: 'ur', variables: ['Fatima', 'Lahore'] }),
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', templateId: 'tmpl_1' }) }),
    )
  })
})

describe('processMessageDispatchJob — failures', () => {
  it('records FAILED + throws UnrecoverableError when a variable is empty with no default', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER, merchantId: MERCHANT, phone: '+92300', firstName: null, isSubscribedWhatsapp: true,
    })
    mockPrisma.whatsAppTemplate.findFirst.mockResolvedValue({
      id: 'tmpl_1', name: 't', language: 'en', category: 'UTILITY', status: 'APPROVED',
      variableMap: [{ index: 1, field: 'firstName' }],
    })
    await expect(processMessageDispatchJob({ ...baseJob, templateId: 'tmpl_1' })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMock).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  it('records FAILED + throws when the template is not APPROVED', async () => {
    mockPrisma.whatsAppTemplate.findFirst.mockResolvedValue({
      id: 'tmpl_1', name: 't', language: 'en', category: 'UTILITY', status: 'PENDING', variableMap: [],
    })
    await expect(processMessageDispatchJob({ ...baseJob, templateId: 'tmpl_1' })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  it('rethrows (no FAILED row) on a retryable adapter failure so BullMQ retries', async () => {
    sendMock.mockResolvedValue({ ok: false, retryable: true, errorTitle: 'Service unavailable' })
    await expect(processMessageDispatchJob(baseJob)).rejects.toThrow('Service unavailable')
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('records FAILED on a non-retryable adapter failure', async () => {
    sendMock.mockResolvedValue({ ok: false, retryable: false, errorCode: '131009', errorTitle: 'Invalid number' })
    await expect(processMessageDispatchJob(baseJob)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorTitle: 'Invalid number' }) }),
    )
  })
})

describe('processMessageDispatchJob — rate limit', () => {
  it('re-enqueues with a jittered delay when over cap, without sending', async () => {
    mockCheckRate.mockResolvedValue(false)
    await processMessageDispatchJob(baseJob, { jobId: 'job-9' })
    expect(sendMock).not.toHaveBeenCalled()
    expect(mockQueue.add).toHaveBeenCalledWith(
      'message-dispatch',
      baseJob,
      expect.objectContaining({ delay: 1234 }),
    )
  })
})

// Lane A ⇄ Lane B: a campaign-originated job carries campaignRecipientId, so the
// worker must flip the originating CampaignRecipient and stamp messageId. A
// non-campaign job (no campaignRecipientId — every test above) must never touch it.
describe('processMessageDispatchJob — campaign recipient flip', () => {
  const campaignJob: MessageDispatchJob = {
    ...baseJob,
    campaignId: 'camp_1',
    campaignRecipientId: 'cr_1',
  }

  it('does not touch CampaignRecipient for a non-campaign (journey) send', async () => {
    await processMessageDispatchJob(baseJob)
    expect(mockPrisma.campaignRecipient.updateMany).not.toHaveBeenCalled()
  })

  it('flips the recipient to SENT and stamps messageId on a successful send', async () => {
    await processMessageDispatchJob(campaignJob)
    expect(mockPrisma.campaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr_1', merchantId: MERCHANT },
        data: expect.objectContaining({ status: 'SENT', messageId: 'msg_1' }),
      }),
    )
  })

  it('flips the recipient to FAILED on a non-retryable adapter failure', async () => {
    sendMock.mockResolvedValue({ ok: false, retryable: false, errorCode: '131009', errorTitle: 'Invalid number' })
    await expect(processMessageDispatchJob(campaignJob)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mockPrisma.campaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr_1', merchantId: MERCHANT },
        data: expect.objectContaining({ status: 'FAILED', messageId: 'msg_1' }),
      }),
    )
  })

  it('flips the recipient to SKIPPED (no Message row) when consent is withdrawn', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER, merchantId: MERCHANT, phone: '+92300', isSubscribedWhatsapp: false,
    })
    await processMessageDispatchJob(campaignJob)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
    expect(mockPrisma.campaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr_1', merchantId: MERCHANT },
        data: expect.objectContaining({ status: 'SKIPPED' }),
      }),
    )
  })
})
