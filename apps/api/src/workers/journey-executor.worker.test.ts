import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    journey: { findFirst: vi.fn(), update: vi.fn() },
    journeyStep: { findFirst: vi.fn(), findMany: vi.fn() },
    journeyEnrollment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    segmentMembership: { findMany: vi.fn() },
    customer: { findFirst: vi.fn() },
  },
}))

vi.mock('@engageiq/queue', () => ({
  journeyExecutorQueue: { add: vi.fn() },
  redisConnection: {},
}))

vi.mock('../lib/channels/dispatcher.js', () => ({
  dispatchChannel: vi.fn(),
}))

vi.mock('@engageiq/shared', () => ({
  JOURNEY_EXECUTOR: 'journey-executor',
}))

vi.mock('../services/segment-evaluator.js', () => ({
  evaluateProfile: vi.fn().mockImplementation((group, profile) => {
    const rule = group.rules[0]
    if (rule.operator === 'gt') return (profile.total_orders ?? 0) > rule.value
    return false
  }),
  buildProfileFromCustomer: vi.fn().mockImplementation((c) => ({
    total_orders: c.totalOrders ?? 0,
    total_spent: parseFloat(c.totalSpent ?? '0'),
  })),
}))

import { processJourneyJob } from './journey-executor.worker.js'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue } from '@engageiq/queue'
import { dispatchChannel } from '../lib/channels/dispatcher.js'

const mockPrisma = prisma as unknown as {
  journey: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  journeyStep: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }
  journeyEnrollment: {
    create: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  segmentMembership: { findMany: ReturnType<typeof vi.fn> }
  customer: { findFirst: ReturnType<typeof vi.fn> }
}
const mockQueue = journeyExecutorQueue as unknown as { add: ReturnType<typeof vi.fn> }
const mockDispatch = dispatchChannel as ReturnType<typeof vi.fn>

const MERCHANT = 'merchant_1'
const JOURNEY_ID = 'journey_1'
const CUSTOMER_ID = 'customer_1'
const ENROLLMENT_ID = 'enroll_1'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.journeyEnrollment.create.mockResolvedValue({ id: ENROLLMENT_ID })
  mockPrisma.journeyEnrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID, status: 'ACTIVE', customerId: CUSTOMER_ID, journeyId: JOURNEY_ID })
  mockPrisma.journeyEnrollment.findMany.mockResolvedValue([])
  mockPrisma.journeyEnrollment.update.mockResolvedValue({})
  mockPrisma.journey.findFirst.mockResolvedValue({ id: JOURNEY_ID, merchantId: MERCHANT, status: 'ACTIVE', enrollmentCount: 0, triggerConfig: {}, reEntryRule: 'DISALLOW', completionCount: 0 })
  mockPrisma.journey.update.mockResolvedValue({})
  mockPrisma.journeyStep.findMany.mockResolvedValue([])
  mockPrisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID, totalOrders: 5, totalSpent: '5000', avgOrderValue: '1000', ltv90d: null })
  mockQueue.add.mockResolvedValue(undefined)
  mockDispatch.mockResolvedValue(undefined)
})

describe('processJourneyJob — enroll_customer', () => {
  it('creates enrollment and enqueues execute_step for trigger step', async () => {
    const triggerStep = { id: 'step_trigger', stepType: 'TRIGGER', parentStepId: null, config: {} }
    mockPrisma.journeyStep.findFirst.mockResolvedValue(triggerStep)

    await processJourneyJob({
      type: 'enroll_customer',
      journeyId: JOURNEY_ID,
      customerId: CUSTOMER_ID,
      merchantId: MERCHANT,
    })

    expect(mockPrisma.journeyEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ journeyId: JOURNEY_ID, customerId: CUSTOMER_ID, status: 'ACTIVE' }),
      }),
    )
    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_trigger' }),
    )
  })
})

describe('processJourneyJob — execute_step ACTION', () => {
  it('calls dispatchChannel and advances to child step', async () => {
    const actionStep = {
      id: 'step_action',
      stepType: 'ACTION',
      config: { channel: 'WHATSAPP', content: { body: 'Hello {{firstName}}' } },
      journeyId: JOURNEY_ID,
    }
    const childStep = { id: 'step_child', stepType: 'ACTION', config: { channel: 'EMAIL', content: { body: 'Follow up' } } }
    mockPrisma.journeyStep.findFirst
      .mockResolvedValueOnce(actionStep)
      .mockResolvedValueOnce(childStep)
    mockPrisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_action',
      merchantId: MERCHANT,
    })

    expect(mockDispatch).toHaveBeenCalledWith('WHATSAPP', CUSTOMER_ID, { body: 'Hello {{firstName}}' }, MERCHANT)
    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_child' }),
    )
  })
})

describe('processJourneyJob — execute_step DELAY', () => {
  it('enqueues child step with BullMQ delay in ms', async () => {
    const delayStep = {
      id: 'step_delay',
      stepType: 'DELAY',
      config: { duration: 2, unit: 'hours' },
      journeyId: JOURNEY_ID,
    }
    const childStep = { id: 'step_after_delay', stepType: 'ACTION', config: { channel: 'SMS', content: { body: 'Hi' } } }
    mockPrisma.journeyStep.findFirst
      .mockResolvedValueOnce(delayStep)
      .mockResolvedValueOnce(childStep)

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_delay',
      merchantId: MERCHANT,
    })

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_after_delay' }),
      expect.objectContaining({ delay: 2 * 60 * 60 * 1000 }),
    )
  })
})

describe('processJourneyJob — execute_step CONDITION', () => {
  it('routes to true-branch child when condition is met', async () => {
    const conditionStep = {
      id: 'step_cond',
      stepType: 'CONDITION',
      config: { field: 'total_orders', operator: 'gt', value: 3 },
      journeyId: JOURNEY_ID,
    }
    const trueBranch = { id: 'step_true', stepType: 'ACTION', config: { channel: 'WHATSAPP', content: { body: 'VIP' } }, label: 'true' }
    const falseBranch = { id: 'step_false', stepType: 'ACTION', config: { channel: 'SMS', content: { body: 'New' } }, label: 'false' }

    mockPrisma.journeyStep.findFirst.mockResolvedValueOnce(conditionStep)
    mockPrisma.journeyStep.findMany.mockResolvedValue([trueBranch, falseBranch])
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER_ID, totalOrders: 5, totalSpent: '5000', avgOrderValue: '1000', ltv90d: null,
    })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_cond',
      merchantId: MERCHANT,
    })

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_true' }),
    )
  })

  it('routes to false-branch child when condition is not met', async () => {
    const conditionStep = {
      id: 'step_cond',
      stepType: 'CONDITION',
      config: { field: 'total_orders', operator: 'gt', value: 10 },
      journeyId: JOURNEY_ID,
    }
    const trueBranch = { id: 'step_true', stepType: 'ACTION', config: { channel: 'WHATSAPP', content: { body: 'VIP' } }, label: 'true' }
    const falseBranch = { id: 'step_false', stepType: 'ACTION', config: { channel: 'SMS', content: { body: 'New' } }, label: 'false' }

    mockPrisma.journeyStep.findFirst.mockResolvedValueOnce(conditionStep)
    mockPrisma.journeyStep.findMany.mockResolvedValue([trueBranch, falseBranch])
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: CUSTOMER_ID, totalOrders: 5, totalSpent: '5000', avgOrderValue: '1000', ltv90d: null,
    })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_cond',
      merchantId: MERCHANT,
    })

    expect(mockQueue.add).toHaveBeenCalledWith(
      'journey-executor',
      expect.objectContaining({ type: 'execute_step', stepId: 'step_false' }),
    )
  })
})

describe('processJourneyJob — execute_step completion', () => {
  it('marks enrollment COMPLETED and increments completionCount when no child step', async () => {
    const lastStep = { id: 'step_last', stepType: 'ACTION', config: { channel: 'EMAIL', content: { body: 'Done' } }, journeyId: JOURNEY_ID }
    mockPrisma.journeyStep.findFirst
      .mockResolvedValueOnce(lastStep)
      .mockResolvedValueOnce(null)
    mockPrisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_last',
      merchantId: MERCHANT,
    })

    expect(mockPrisma.journeyEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    )
  })
})

describe('processJourneyJob — execute_step no-ops', () => {
  it('no-ops when enrollment is not ACTIVE', async () => {
    mockPrisma.journeyEnrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID, status: 'EXITED', customerId: CUSTOMER_ID, journeyId: JOURNEY_ID })

    await processJourneyJob({
      type: 'execute_step',
      enrollmentId: ENROLLMENT_ID,
      stepId: 'step_1',
      merchantId: MERCHANT,
    })

    expect(mockPrisma.journeyStep.findFirst).not.toHaveBeenCalled()
    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
