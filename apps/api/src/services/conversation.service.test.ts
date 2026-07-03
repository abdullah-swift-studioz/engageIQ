import { describe, it, expect, vi, beforeEach } from 'vitest'

// Isolate dispatchInbound's routing by mocking the engine internals it orchestrates.
vi.mock('@engageiq/db', () => ({ prisma: {} }))
vi.mock('../lib/conversations/state.js', () => ({
  findActiveConversation: vi.fn(),
  openConversation: vi.fn(),
  touchInbound: vi.fn(),
}))
vi.mock('../lib/conversations/journey-reply.js', () => ({ resolveJourneyReply: vi.fn() }))
vi.mock('../lib/conversations/verification.js', () => ({ resolveVerificationReply: vi.fn() }))

import { dispatchInbound } from './conversation.service.js'
import {
  findActiveConversation,
  openConversation,
  touchInbound,
} from '../lib/conversations/state.js'
import { resolveJourneyReply } from '../lib/conversations/journey-reply.js'
import { resolveVerificationReply } from '../lib/conversations/verification.js'

const mockFindActive = findActiveConversation as ReturnType<typeof vi.fn>
const mockOpen = openConversation as ReturnType<typeof vi.fn>
const mockTouch = touchInbound as ReturnType<typeof vi.fn>
const mockResolveJourney = resolveJourneyReply as ReturnType<typeof vi.fn>
const mockResolveVerification = resolveVerificationReply as ReturnType<typeof vi.fn>

const INPUT = { merchantId: 'm1', customerId: 'c1', phone: '+923001234567', text: 'CONFIRM' }

// A conversation AWAITING_REPLY with a deadline well in the future.
function awaiting(contextType: string) {
  return {
    id: 'conv1',
    merchantId: 'm1',
    phone: INPUT.phone,
    state: 'AWAITING_REPLY',
    contextType,
    contextId: 'step1',
    journeyEnrollmentId: 'enr1',
    awaitingReplyUntil: new Date(Date.now() + 60 * 60 * 1000),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOpen.mockResolvedValue({ id: 'conv-new' })
  mockTouch.mockResolvedValue({})
})

describe('dispatchInbound', () => {
  it('auto-opens a freeform conversation when none is active, and stamps the inbound', async () => {
    mockFindActive.mockResolvedValue(null)

    await dispatchInbound(INPUT)

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', phone: INPUT.phone, customerId: 'c1', contextType: 'freeform' }),
    )
    expect(mockTouch).toHaveBeenCalledWith('conv-new', expect.any(Date))
    expect(mockResolveJourney).not.toHaveBeenCalled()
    expect(mockResolveVerification).not.toHaveBeenCalled()
  })

  it('routes a journey_reply structured reply', async () => {
    mockFindActive.mockResolvedValue(awaiting('journey_reply'))

    await dispatchInbound(INPUT)

    expect(mockTouch).toHaveBeenCalledWith('conv1', expect.any(Date))
    expect(mockResolveJourney).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv1' }), 'CONFIRM')
    expect(mockResolveVerification).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('routes a verification structured reply', async () => {
    mockFindActive.mockResolvedValue(awaiting('verification'))

    await dispatchInbound(INPUT)

    expect(mockResolveVerification).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv1' }), 'CONFIRM')
    expect(mockResolveJourney).not.toHaveBeenCalled()
  })

  it('treats a reply after the deadline as free-form (no routing)', async () => {
    const convo = awaiting('journey_reply')
    convo.awaitingReplyUntil = new Date(Date.now() - 1000) // already expired
    mockFindActive.mockResolvedValue(convo)

    await dispatchInbound(INPUT)

    expect(mockTouch).toHaveBeenCalledWith('conv1', expect.any(Date))
    expect(mockResolveJourney).not.toHaveBeenCalled()
  })

  it('records a free-form inbound on an OPEN conversation without routing', async () => {
    mockFindActive.mockResolvedValue({ ...awaiting('freeform'), state: 'OPEN', awaitingReplyUntil: null })

    await dispatchInbound(INPUT)

    expect(mockTouch).toHaveBeenCalledWith('conv1', expect.any(Date))
    expect(mockResolveJourney).not.toHaveBeenCalled()
    expect(mockResolveVerification).not.toHaveBeenCalled()
  })
})
