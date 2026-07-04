import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journeyStep: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    journeyEnrollment: { findFirst: vi.fn(), update: vi.fn() },
    journey: { update: vi.fn() },
  },
}))
vi.mock('@engageiq/queue', () => ({
  journeyExecutorQueue: { add: vi.fn() },
  conversationTimeoutQueue: { add: vi.fn() },
  redisConnection: {},
}))
vi.mock('@engageiq/shared', () => ({
  JOURNEY_EXECUTOR: 'journey-executor',
  CONVERSATION_TIMEOUT: 'conversation-timeout',
}))
vi.mock('../channels/dispatcher.js', () => ({ dispatchChannel: vi.fn() }))
vi.mock('./state.js', () => ({
  reuseOrArmConversation: vi.fn(),
  claimStructuredReply: vi.fn(),
}))

import {
  isWaitForReplyConfig,
  startJourneyReplyWait,
  resolveJourneyReply,
  journeyReplyTimeout,
} from './journey-reply.js'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue, conversationTimeoutQueue } from '@engageiq/queue'
import { dispatchChannel } from '../channels/dispatcher.js'
import { reuseOrArmConversation, claimStructuredReply } from './state.js'

const p = prisma as unknown as {
  journeyStep: { findFirst: ReturnType<typeof vi.fn> }
  customer: { findFirst: ReturnType<typeof vi.fn> }
  journeyEnrollment: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  journey: { update: ReturnType<typeof vi.fn> }
}
const execQueue = journeyExecutorQueue as unknown as { add: ReturnType<typeof vi.fn> }
const timeoutQueue = conversationTimeoutQueue as unknown as { add: ReturnType<typeof vi.fn> }
const mockDispatch = dispatchChannel as ReturnType<typeof vi.fn>
const mockArm = reuseOrArmConversation as ReturnType<typeof vi.fn>
const mockClaim = claimStructuredReply as ReturnType<typeof vi.fn>

function stepConfig(waitForReply: Record<string, unknown>) {
  return { config: { channel: 'WHATSAPP', content: { body: 'Reply CONFIRM or CANCEL' }, waitForReply } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockArm.mockResolvedValue({ status: 'armed', conversation: { id: 'conv1' } })
  p.journeyEnrollment.update.mockResolvedValue({})
  p.journey.update.mockResolvedValue({})
})

describe('isWaitForReplyConfig', () => {
  it('is true only for a config with a waitForReply.branches array', () => {
    expect(isWaitForReplyConfig({ waitForReply: { branches: [] } })).toBe(true)
    expect(isWaitForReplyConfig({ channel: 'WHATSAPP', content: { body: 'x' }, waitForReply: { branches: [{ label: 'a', keywords: ['x'] }] } })).toBe(true)
  })

  it('is false for an ordinary ACTION config and for non-objects', () => {
    expect(isWaitForReplyConfig({ channel: 'WHATSAPP', content: { body: 'x' } })).toBe(false)
    expect(isWaitForReplyConfig({ waitForReply: {} })).toBe(false)
    expect(isWaitForReplyConfig({ waitForReply: null })).toBe(false)
    expect(isWaitForReplyConfig(null)).toBe(false)
    expect(isWaitForReplyConfig(undefined)).toBe(false)
    expect(isWaitForReplyConfig(42)).toBe(false)
  })
})

describe('startJourneyReplyWait', () => {
  const params = { merchantId: 'm1', enrollmentId: 'enr1', customerId: 'c1', stepId: 'step1' }

  it('sends the prompt, opens a journey_reply conversation, arms await + timeout', async () => {
    p.journeyStep.findFirst.mockResolvedValueOnce(
      stepConfig({ timeoutMinutes: 60, branches: [{ label: 'confirmed', keywords: ['confirm'] }] }),
    )
    p.customer.findFirst.mockResolvedValue({ phone: '+923001234567' })

    await startJourneyReplyWait(params)

    expect(mockArm).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'm1',
        phone: '+923001234567',
        contextType: 'journey_reply',
        contextId: 'step1',
        journeyEnrollmentId: 'enr1',
        awaitingReplyUntil: expect.any(Date),
      }),
    )
    expect(mockDispatch).toHaveBeenCalledWith(
      'WHATSAPP',
      'c1',
      { body: 'Reply CONFIRM or CANCEL' },
      'm1',
      { journeyEnrollmentId: 'enr1' },
    )
    expect(timeoutQueue.add).toHaveBeenCalledWith(
      'conversation-timeout',
      expect.objectContaining({ type: 'timeout', conversationId: 'conv1' }),
      expect.objectContaining({ delay: expect.any(Number), jobId: expect.stringContaining('conv-timeout:conv1:') }),
    )
  })

  it('on a conflicting active wait, routes THIS enrollment to its timeout branch (no prompt, no arm)', async () => {
    p.journeyStep.findFirst
      .mockResolvedValueOnce(stepConfig({ timeoutMinutes: 60, branches: [{ label: 'confirmed', keywords: ['confirm'] }], timeoutLabel: 'expired' }))
      .mockResolvedValueOnce({ id: 'child-timeout' }) // resolveBranchChild
    p.customer.findFirst.mockResolvedValue({ phone: '+923001234567' })
    mockArm.mockResolvedValue({ status: 'conflict', conversation: { id: 'other-conv' } })

    await startJourneyReplyWait(params)

    expect(mockDispatch).not.toHaveBeenCalled()
    expect(timeoutQueue.add).not.toHaveBeenCalled()
    expect(execQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'child-timeout' }),
    )
  })

  it('with no phone, routes straight to the timeout branch child (no send/await)', async () => {
    p.journeyStep.findFirst
      .mockResolvedValueOnce(stepConfig({ timeoutMinutes: 60, branches: [], timeoutLabel: 'expired' }))
      .mockResolvedValueOnce({ id: 'child-timeout' }) // resolveBranchChild
    p.customer.findFirst.mockResolvedValue({ phone: null })

    await startJourneyReplyWait(params)

    expect(mockDispatch).not.toHaveBeenCalled()
    expect(mockArm).not.toHaveBeenCalled()
    expect(execQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'child-timeout', enrollmentId: 'enr1' }),
    )
  })

  it('with no phone and no timeout branch, completes the enrollment', async () => {
    p.journeyStep.findFirst.mockResolvedValueOnce(stepConfig({ timeoutMinutes: 60, branches: [] }))
    p.customer.findFirst.mockResolvedValue({ phone: null })
    p.journeyEnrollment.findFirst.mockResolvedValue({ status: 'ACTIVE', journeyId: 'j1' })

    await startJourneyReplyWait(params)

    expect(execQueue.add).not.toHaveBeenCalled()
    expect(p.journeyEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    )
    expect(p.journey.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completionCount: { increment: 1 } } }),
    )
  })
})

describe('resolveJourneyReply', () => {
  const convo = { id: 'conv1', merchantId: 'm1', contextId: 'step1', journeyEnrollmentId: 'enr1' } as never

  it('claims the reply and resumes down the matched branch child', async () => {
    p.journeyStep.findFirst
      .mockResolvedValueOnce(stepConfig({ timeoutMinutes: 60, branches: [{ label: 'confirmed', keywords: ['confirm'] }] }))
      .mockResolvedValueOnce({ id: 'child-confirmed' }) // resolveBranchChild
    mockClaim.mockResolvedValue(true)

    await resolveJourneyReply(convo, 'CONFIRM ✅')

    expect(mockClaim).toHaveBeenCalledWith('conv1')
    expect(execQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'child-confirmed' }),
    )
  })

  it('does not claim when the reply matches no branch and there is no fallback', async () => {
    p.journeyStep.findFirst.mockResolvedValueOnce(
      stepConfig({ timeoutMinutes: 60, branches: [{ label: 'confirmed', keywords: ['confirm'] }] }),
    )

    await resolveJourneyReply(convo, 'where is my order')

    expect(mockClaim).not.toHaveBeenCalled()
    expect(execQueue.add).not.toHaveBeenCalled()
  })

  it('stops when it loses the claim race to the timeout', async () => {
    p.journeyStep.findFirst.mockResolvedValueOnce(
      stepConfig({ timeoutMinutes: 60, branches: [{ label: 'confirmed', keywords: ['confirm'] }] }),
    )
    mockClaim.mockResolvedValue(false)

    await resolveJourneyReply(convo, 'confirm')

    expect(mockClaim).toHaveBeenCalledWith('conv1')
    expect(execQueue.add).not.toHaveBeenCalled()
  })
})

describe('journeyReplyTimeout', () => {
  const convo = { id: 'conv1', merchantId: 'm1', contextId: 'step1', journeyEnrollmentId: 'enr1' } as never

  it('resumes down the timeout branch child with a dedupe jobId (idempotent retry)', async () => {
    p.journeyStep.findFirst
      .mockResolvedValueOnce(stepConfig({ timeoutMinutes: 60, branches: [], timeoutLabel: 'expired' }))
      .mockResolvedValueOnce({ id: 'child-timeout' })

    await journeyReplyTimeout(convo)

    expect(execQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'child-timeout' }),
      expect.objectContaining({ jobId: expect.stringContaining('conv-resume:conv1:') }),
    )
  })

  it('completes the enrollment when there is no timeout branch', async () => {
    p.journeyStep.findFirst.mockResolvedValueOnce(stepConfig({ timeoutMinutes: 60, branches: [] }))
    p.journeyEnrollment.findFirst.mockResolvedValue({ status: 'ACTIVE', journeyId: 'j1' })

    await journeyReplyTimeout(convo)

    expect(execQueue.add).not.toHaveBeenCalled()
    expect(p.journeyEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    )
  })
})
