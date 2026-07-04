import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnrecoverableError } from 'bullmq'

vi.mock('@engageiq/db', () => ({
  prisma: {
    emailSuppression: { findUnique: vi.fn() },
    emailTemplate: { findFirst: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    campaignRecipient: { updateMany: vi.fn() },
  },
}))

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('../../lib/channels/email.adapter.js', () => ({
  emailAdapter: { channel: 'EMAIL', send: sendMock },
}))

vi.mock('./context.js', () => ({
  buildEmailRenderContext: vi.fn().mockResolvedValue({
    customer: {},
    merchant: { name: 'Acme' },
    segmentIds: [],
    productsByBlockId: {},
  }),
}))

vi.mock('./render.js', () => ({
  renderEmail: vi.fn().mockReturnValue({ html: '<html>hi</html>', text: 'hi' }),
}))

import { dispatchEmail } from './dispatch.js'
import { prisma } from '@engageiq/db'
import type { MessageDispatchJob } from '@engageiq/shared'

const mock = prisma as unknown as {
  emailSuppression: { findUnique: ReturnType<typeof vi.fn> }
  emailTemplate: { findFirst: ReturnType<typeof vi.fn> }
  message: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  campaignRecipient: { updateMany: ReturnType<typeof vi.fn> }
}

const MERCHANT = 'm_1'
const customer = { id: 'c_1', email: 'a@b.com', isSubscribedEmail: true, firstName: 'Aya' }

const plainJob: MessageDispatchJob = {
  type: 'send',
  channel: 'EMAIL',
  merchantId: MERCHANT,
  customerId: 'c_1',
  content: { body: 'Hello {{customer.first_name}}', subject: 'Hi' },
  campaignId: 'camp_1',
  campaignRecipientId: 'cr_1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.emailSuppression.findUnique.mockResolvedValue(null)
  mock.message.findFirst.mockResolvedValue(null)
  mock.message.create.mockResolvedValue({ id: 'msg_1' })
  mock.message.update.mockResolvedValue({})
  mock.campaignRecipient.updateMany.mockResolvedValue({ count: 1 })
  sendMock.mockResolvedValue({ ok: true, providerMessageId: 'ses-1' })
})

describe('dispatchEmail', () => {
  it('skips (no send, recipient SKIPPED) when the customer is not subscribed', async () => {
    await dispatchEmail(plainJob, { ...customer, isSubscribedEmail: false })
    expect(sendMock).not.toHaveBeenCalled()
    expect(mock.campaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) }),
    )
  })

  it('skips when the address is on the suppression list', async () => {
    mock.emailSuppression.findUnique.mockResolvedValue({ id: 'sup_1' })
    await dispatchEmail(plainJob, customer)
    expect(sendMock).not.toHaveBeenCalled()
    expect(mock.campaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) }),
    )
  })

  it('sends a plain-body email and marks Message SENT + recipient SENT', async () => {
    await dispatchEmail(plainJob, customer)
    expect(mock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'EMAIL', status: 'QUEUED', toEmail: 'a@b.com', toPhone: '' }) }),
    )
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'EMAIL', toEmail: 'a@b.com', html: '<html>hi</html>' }),
    )
    expect(mock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg_1' }, data: expect.objectContaining({ status: 'SENT', providerMessageId: 'ses-1' }) }),
    )
    expect(mock.campaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', messageId: 'msg_1' }) }),
    )
  })

  it('throws (retry) without a terminal row on a retryable send failure', async () => {
    sendMock.mockResolvedValue({ ok: false, retryable: true, errorTitle: 'throttled' })
    await expect(dispatchEmail(plainJob, customer)).rejects.toThrow('throttled')
    // The QUEUED row is left as-is (no FAILED update); recipient not flipped to terminal.
    expect(mock.campaignRecipient.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  it('marks FAILED + throws UnrecoverableError on a permanent send failure', async () => {
    sendMock.mockResolvedValue({ ok: false, retryable: false, errorTitle: 'bad address', errorCode: '400' })
    await expect(dispatchEmail(plainJob, customer)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorTitle: 'bad address' }) }),
    )
  })

  it('renders a template when emailTemplateId is set, failing permanently if missing', async () => {
    mock.emailTemplate.findFirst.mockResolvedValue(null)
    const templJob: MessageDispatchJob = { ...plainJob, emailTemplateId: 'tmpl_x', content: { body: '' } }
    await expect(dispatchEmail(templJob, customer)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })
})
