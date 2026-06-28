import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock shared env so importing the worker does not run real env validation / exit.
vi.mock('@engageiq/shared', () => ({
  env: {
    ML_SERVICE_URL: 'http://ml.test',
    ML_SERVICE_TIMEOUT_MS: 1000,
    ML_SCORING_CRON: '0 3 * * *',
    ML_SEGMENT_DISCOVERY_CRON: '0 4 * * 0',
    ML_SCHEDULER_ENABLED: true,
  },
}))

// Mock the queue package so no Redis connection is attempted on import.
vi.mock('@engageiq/queue', () => ({
  redisConnection: {},
  scoringQueue: { upsertJobScheduler: vi.fn() },
}))

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    codOrder: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    order: { findMany: vi.fn() },
    recommendation: { upsert: vi.fn().mockResolvedValue({}) },
    merchant: { findMany: vi.fn() },
    modelRun: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (arr: Promise<unknown>[]) => Promise.all(arr)),
  },
}))

import { prisma } from '@engageiq/db'
import {
  buyers,
  buildRfmInputs,
  buildChurnInputs,
  buildLtvInputs,
  buildFakeOrderInput,
  buildInteractions,
  runRfm,
  runScoringJob,
  type MlClient,
} from './scoring.worker.js'

const NOW = new Date('2026-06-28T00:00:00Z')

function cust(p: Record<string, unknown>) {
  return {
    id: 'c1',
    totalOrders: 0,
    totalSpent: 0,
    avgOrderValue: 0,
    lastOrderAt: null,
    firstOrderAt: null,
    lastSeenAt: null,
    sessionCount: 0,
    codOrderCount: 0,
    codRejectionRate: null,
    ltv365d: null,
    mergedIntoId: null,
    phone: null,
    ...p,
  } as unknown as Parameters<typeof buildRfmInputs>[0][number]
}

describe('feature builders', () => {
  it('buyers() filters out zero-order customers', () => {
    const list = [cust({ id: 'a', totalOrders: 3 }), cust({ id: 'b', totalOrders: 0 })]
    expect(buyers(list).map((c) => c.id)).toEqual(['a'])
  })

  it('buildRfmInputs computes recency in days and excludes non-buyers', () => {
    const list = [
      cust({ id: 'a', totalOrders: 5, totalSpent: 50000, lastOrderAt: new Date('2026-06-18T00:00:00Z') }),
      cust({ id: 'z', totalOrders: 0 }),
    ]
    const inputs = buildRfmInputs(list, NOW)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ id: 'a', frequency: 5, monetary: 50000 })
    expect(inputs[0]!.recencyDays).toBeCloseTo(10, 5)
  })

  it('buildChurnInputs derives tenure + inter-purchase gap', () => {
    const c = cust({
      id: 'a',
      totalOrders: 4,
      totalSpent: 40000,
      avgOrderValue: 10000,
      firstOrderAt: new Date('2026-02-28T00:00:00Z'), // ~120 days tenure
      lastOrderAt: new Date('2026-06-18T00:00:00Z'),
      sessionCount: 12,
    })
    const f = buildChurnInputs([c], NOW)[0]!
    expect(f.tenureDays).toBeCloseTo(120, 0)
    expect(f.interPurchaseGapDays).toBeCloseTo(30, 0)
    expect(f.recencyDays).toBeCloseTo(10, 0)
  })

  it('buildLtvInputs maps spend fields', () => {
    const c = cust({ id: 'a', totalOrders: 3, totalSpent: 30000, avgOrderValue: 10000,
      firstOrderAt: new Date('2026-03-30T00:00:00Z'), lastOrderAt: new Date('2026-06-18T00:00:00Z') })
    const f = buildLtvInputs([c], NOW)[0]!
    expect(f).toMatchObject({ id: 'a', frequency: 3, monetary: 30000, avgOrderValue: 10000 })
  })

  it('buildFakeOrderInput flags weak phone/address + first-order high value', () => {
    const cod = { id: 'o1', amount: 50000, city: 'Lahore', shopifyOrderId: '111', customerId: 'c1', placedAt: NOW } as any
    const order = { shippingAddress: { address1: 'xyz', city: 'Lahore' } } as any
    const customer = cust({ id: 'c1', codOrderCount: 1, codRejectionRate: 0.6, avgOrderValue: 2000, phone: 'abc' })
    const f = buildFakeOrderInput(cod, order, customer as any, 2)
    expect(f.isFirstOrder).toBe(true)
    expect(f.isHighValue).toBe(true) // 50000 > 2*2000
    expect(f.phoneValid).toBe(false) // 'abc' not E.164
    expect(f.addressHasStreetSignal).toBe(false) // 'xyz' has no digit
    expect(f.ordersLast24h).toBe(2)
    expect(f.cityKnown).toBe(true)
  })

  it('buildInteractions extracts product_ids from line items', () => {
    const orders = [
      { customerId: 'c1', lineItems: [{ product_id: 'p1' }, { product_id: 'p2' }] },
      { customerId: null, lineItems: [{ product_id: 'p9' }] }, // no customer → skipped
      { customerId: 'c2', lineItems: [{ product_id: null }] }, // no product → skipped
    ] as any
    const inter = buildInteractions(orders)
    expect(inter).toHaveLength(2)
    expect(inter[0]).toMatchObject({ customerId: 'c1', productId: 'p1', weight: 3 })
  })
})

describe('runRfm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scores buyers, persists rfm columns, and records a ModelRun', async () => {
    ;(prisma.customer.findMany as any).mockResolvedValue([
      cust({ id: 'a', totalOrders: 5, totalSpent: 50000, lastOrderAt: NOW }),
      cust({ id: 'z', totalOrders: 0 }),
    ])
    const ml: MlClient = {
      health: vi.fn(),
      rfm: vi.fn().mockResolvedValue([
        { id: 'a', recencyScore: 5, frequencyScore: 4, monetaryScore: 5, segment: 'CHAMPION' },
      ]),
      churn: vi.fn(),
      ltv: vi.fn(),
      fakeOrder: vi.fn(),
      recommendations: vi.fn(),
      discover: vi.fn(),
    }

    const n = await runRfm('m1', { ml, now: NOW })

    expect(n).toBe(1)
    // ML called with only the buyer
    expect((ml.rfm as any).mock.calls[0][0]).toHaveLength(1)
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a' },
        data: expect.objectContaining({ rfmSegment: 'CHAMPION', rfmRecencyScore: 5 }),
      }),
    )
    expect(prisma.modelRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ modelName: 'rfm', rowCount: 1 }) }),
    )
  })

  it('no-ops cleanly when the merchant has no buyers', async () => {
    ;(prisma.customer.findMany as any).mockResolvedValue([cust({ id: 'z', totalOrders: 0 })])
    const ml = { rfm: vi.fn() } as unknown as MlClient
    const n = await runRfm('m1', { ml, now: NOW })
    expect(n).toBe(0)
    expect(ml.rfm).not.toHaveBeenCalled()
  })
})

describe('runScoringJob dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("'full' resolves all merchants when merchantId omitted and runs daily tasks", async () => {
    ;(prisma.merchant.findMany as any).mockResolvedValue([{ id: 'm1' }, { id: 'm2' }])
    ;(prisma.customer.findMany as any).mockResolvedValue([]) // every task no-ops fast
    ;(prisma.codOrder.findMany as any).mockResolvedValue([])
    ;(prisma.order.findMany as any).mockResolvedValue([])
    const ml = {
      rfm: vi.fn(), churn: vi.fn(), ltv: vi.fn(), fakeOrder: vi.fn(),
      recommendations: vi.fn(), discover: vi.fn(), health: vi.fn(),
    } as unknown as MlClient

    await runScoringJob({ task: 'full' }, { ml, now: NOW })

    expect(prisma.merchant.findMany).toHaveBeenCalled()
    // 2 merchants × (rfm,churn,ltv → customer.findMany) = 6 customer reads
    expect((prisma.customer.findMany as any).mock.calls.length).toBe(6)
    expect((prisma.codOrder.findMany as any).mock.calls.length).toBe(2)
  })
})
