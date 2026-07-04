import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB + the two seams the service calls (channel dispatch + conversation arm) so the
// orchestration logic is tested in isolation, without Redis / a real database.
vi.mock('@engageiq/db', () => ({
  prisma: {
    codOrder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    merchantSettings: { findUnique: vi.fn() },
    customer: { findFirst: vi.fn() },
    order: { findUnique: vi.fn() },
    verificationAttempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    whatsAppConversation: { updateMany: vi.fn() },
  },
}))
vi.mock('../../lib/channels/dispatcher.js', () => ({ dispatchChannel: vi.fn() }))
vi.mock('../../lib/conversations/state.js', () => ({ reuseOrArmConversation: vi.fn() }))
vi.mock('./ivr.js', () => ({ placeIvrCall: vi.fn() }))

import { prisma } from '@engageiq/db'
import { dispatchChannel } from '../../lib/channels/dispatcher.js'
import { reuseOrArmConversation } from '../../lib/conversations/state.js'
import { placeIvrCall } from './ivr.js'
import {
  runAttempt,
  applyVerificationDecision,
  finalizeVerification,
  scanPendingVerifications,
} from './verification.service.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any
const mockDispatch = dispatchChannel as ReturnType<typeof vi.fn>
const mockArm = reuseOrArmConversation as ReturnType<typeof vi.fn>
const mockIvr = placeIvrCall as ReturnType<typeof vi.fn>

const PENDING_ORDER = {
  id: 'co1',
  merchantId: 'm1',
  customerId: 'c1',
  shopifyOrderId: 'sh1',
  orderNumber: '1001',
  amount: 5000,
  city: 'Lahore',
  verificationStatus: 'PENDING_VERIFICATION',
  status: 'PENDING',
  verificationSentAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults; individual tests override.
  db.merchantSettings.findUnique.mockResolvedValue({ codVerification: null }) // → default ladder
  db.customer.findFirst.mockResolvedValue({ id: 'c1', phone: '+923001234567', firstName: 'Ali' })
  db.order.findUnique.mockResolvedValue({ lineItems: null })
  db.verificationAttempt.findUnique.mockResolvedValue(null)
  db.verificationAttempt.upsert.mockResolvedValue({})
  db.verificationAttempt.update.mockResolvedValue({})
  db.verificationAttempt.updateMany.mockResolvedValue({ count: 0 })
  db.codOrder.update.mockResolvedValue({})
  db.whatsAppConversation.updateMany.mockResolvedValue({ count: 0 })
  mockDispatch.mockResolvedValue(undefined)
  mockArm.mockResolvedValue({ status: 'armed' })
})

describe('runAttempt', () => {
  it('sends the WhatsApp prompt, arms the verification conversation, and schedules reminder #2', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })

    const result = await runAttempt('m1', 'co1', 1)

    expect(result.status).toBe('sent')
    // dispatched on WhatsApp for the right customer/merchant
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    const [channel, customerId, content, merchantId] = mockDispatch.mock.calls[0]!
    expect(channel).toBe('WHATSAPP')
    expect(customerId).toBe('c1')
    expect(merchantId).toBe('m1')
    expect(content.body).toContain('#1001')
    // conversation armed with the verification context + the order id
    expect(mockArm).toHaveBeenCalledTimes(1)
    expect(mockArm.mock.calls[0]![0]).toMatchObject({
      merchantId: 'm1',
      contextType: 'verification',
      contextId: 'co1',
      customerId: 'c1',
    })
    // attempt marked AWAITING
    expect(db.verificationAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'AWAITING' }) }),
    )
    // next tick is reminder #2 (default ladder has 3 attempts)
    expect(result.next?.job).toMatchObject({ type: 'reminder', attemptNumber: 2 })
  })

  it('is a no-op when the order is no longer PENDING_VERIFICATION', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER, verificationStatus: 'VERIFIED' })
    const result = await runAttempt('m1', 'co1', 1)
    expect(result.status).toBe('noop')
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('schedules the finalize timeout after the LAST attempt', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    // attempt 3 is the last in the default ladder; channel = SMS (one-way, no conversation arm)
    const result = await runAttempt('m1', 'co1', 3)
    expect(mockDispatch).toHaveBeenCalledWith('SMS', 'c1', expect.anything(), 'm1', expect.anything())
    expect(mockArm).not.toHaveBeenCalled()
    expect(result.next?.job).toMatchObject({ type: 'timeout' })
  })

  it('does not resend when the attempt row was already processed (job retry)', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.verificationAttempt.findUnique.mockResolvedValue({ status: 'AWAITING', attemptNumber: 1 })
    const result = await runAttempt('m1', 'co1', 1)
    expect(result.status).toBe('sent')
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(result.next?.job).toMatchObject({ type: 'reminder', attemptNumber: 2 })
  })

  it('marks the attempt FAILED but still escalates when the customer has no phone', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.customer.findFirst.mockResolvedValue({ id: 'c1', phone: null, firstName: 'Ali' })
    const result = await runAttempt('m1', 'co1', 1)
    expect(result.status).toBe('skipped')
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(db.verificationAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
    // escalation still scheduled
    expect(result.next?.job).toMatchObject({ type: 'reminder', attemptNumber: 2 })
  })

  it('treats a placed/mocked IVR call as AWAITING', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.merchantSettings.findUnique.mockResolvedValue({
      codVerification: { attempts: [{ delayMinutes: 5, channel: 'IVR' }], autoCancelDelayMinutes: 60 },
    })
    mockIvr.mockResolvedValue({ status: 'mocked' })
    const result = await runAttempt('m1', 'co1', 1)
    expect(mockIvr).toHaveBeenCalledTimes(1)
    expect(db.verificationAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'AWAITING' }) }),
    )
    // single-attempt ladder → next is the timeout
    expect(result.next?.job).toMatchObject({ type: 'timeout' })
  })
})

describe('applyVerificationDecision', () => {
  it('CONFIRM → order VERIFIED + status CONFIRMED, attempt CONFIRMED', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.verificationAttempt.findFirst.mockResolvedValue({ id: 'va1', status: 'AWAITING', attemptNumber: 1 })

    const result = await applyVerificationDecision({ merchantId: 'm1', codOrderId: 'co1', decision: 'CONFIRM', response: 'YES' })

    expect(result.status).toBe('applied')
    expect(result.verificationStatus).toBe('VERIFIED')
    expect(db.codOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verificationStatus: 'VERIFIED', status: 'CONFIRMED' }) }),
    )
    expect(db.verificationAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', response: 'YES' }) }),
    )
    // conversation closed
    expect(db.whatsAppConversation.updateMany).toHaveBeenCalled()
  })

  it('CANCEL → order AUTO_CANCELLED + status CANCELLED', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.verificationAttempt.findFirst.mockResolvedValue({ id: 'va1', status: 'AWAITING', attemptNumber: 1 })

    const result = await applyVerificationDecision({ merchantId: 'm1', codOrderId: 'co1', decision: 'CANCEL' })

    expect(result.verificationStatus).toBe('AUTO_CANCELLED')
    expect(db.codOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verificationStatus: 'AUTO_CANCELLED', status: 'CANCELLED' }) }),
    )
  })

  it('is idempotent — a decided order is a no-op (a late/duplicate reply cannot re-decide)', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER, verificationStatus: 'VERIFIED' })
    const result = await applyVerificationDecision({ merchantId: 'm1', codOrderId: 'co1', decision: 'CANCEL' })
    expect(result.status).toBe('noop')
    expect(db.codOrder.update).not.toHaveBeenCalled()
  })
})

describe('finalizeVerification', () => {
  it('auto-cancels on no-response when autoCancel is on', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.merchantSettings.findUnique.mockResolvedValue({ codVerification: { autoCancel: true } })

    const result = await finalizeVerification('m1', 'co1')

    expect(result.status).toBe('auto_cancelled')
    expect(db.verificationAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'NO_RESPONSE' }) }),
    )
    expect(db.codOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verificationStatus: 'AUTO_CANCELLED' }) }),
    )
  })

  it('holds for manual review when autoCancel is off (order not cancelled)', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER })
    db.merchantSettings.findUnique.mockResolvedValue({ codVerification: { autoCancel: false } })

    const result = await finalizeVerification('m1', 'co1')

    expect(result.status).toBe('held_for_review')
    expect(db.codOrder.update).not.toHaveBeenCalled()
    // still records the no-response attempts
    expect(db.verificationAttempt.updateMany).toHaveBeenCalled()
  })

  it('no-ops when the order already left verification', async () => {
    db.codOrder.findFirst.mockResolvedValue({ ...PENDING_ORDER, verificationStatus: 'VERIFIED' })
    const result = await finalizeVerification('m1', 'co1')
    expect(result.status).toBe('noop')
  })
})

describe('scanPendingVerifications', () => {
  it('returns enrollment descriptors for pending orders without attempts', async () => {
    db.codOrder.findMany.mockResolvedValue([
      { id: 'co1', merchantId: 'm1' },
      { id: 'co2', merchantId: 'm1' },
    ])

    const enrollments = await scanPendingVerifications()

    expect(enrollments).toHaveLength(2)
    expect(enrollments[0]).toMatchObject({ merchantId: 'm1', codOrderId: 'co1', channel: 'WHATSAPP' })
    // default first-attempt delay is 15 min
    expect(enrollments[0]!.delayMs).toBe(15 * 60_000)
  })

  it('skips merchants whose config is disabled', async () => {
    db.codOrder.findMany.mockResolvedValue([{ id: 'co1', merchantId: 'm1' }])
    db.merchantSettings.findUnique.mockResolvedValue({ codVerification: { enabled: false } })
    const enrollments = await scanPendingVerifications()
    expect(enrollments).toHaveLength(0)
  })

  it('returns an empty list when nothing is pending', async () => {
    db.codOrder.findMany.mockResolvedValue([])
    expect(await scanPendingVerifications()).toEqual([])
  })
})
