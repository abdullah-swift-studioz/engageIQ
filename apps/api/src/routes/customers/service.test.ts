import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @engageiq/db BEFORE importing the service (Vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------

vi.mock('@engageiq/db', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    segmentMembership: { findMany: vi.fn() },
    journeyEnrollment: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    abandonedCheckout: { findMany: vi.fn() },
    codOrder: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  clickhouse: {
    query: vi.fn(),
  },
}))

import { prisma, clickhouse } from '@engageiq/db'
import { getCustomerProfile, listCustomers } from './service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal Decimal-like object that `.toString()` returns the given string. */
function decimal(value: string): { toString: () => string } {
  return { toString: () => value }
}

/** Returns a realistic mock customer row as Prisma would return it. */
function makeCustomerRow() {
  const now = new Date('2025-01-15T10:00:00Z')
  return {
    id: 'cust_1',
    merchantId: 'merch_1',
    shopifyCustomerId: 'shp_1001',
    email: 'ali@example.com',
    phone: '+923001234567',
    firstName: 'Ali',
    lastName: 'Hassan',
    city: 'Lahore',
    province: 'Punjab',
    country: 'PK',
    languagePreference: 'ur',
    tags: ['vip', 'repeat'],

    // Shopify aggregates (Prisma Decimal fields use toString())
    totalOrders: 5,
    totalSpent: decimal('12500.00'),
    avgOrderValue: decimal('2500.00'),
    firstOrderAt: new Date('2024-06-01T00:00:00Z'),
    lastOrderAt: new Date('2025-01-10T00:00:00Z'),

    // Behavioral
    lastSeenAt: now,
    sessionCount: 15,

    // RFM
    rfmSegment: 'CHAMPIONS',
    rfmRecencyScore: 5,
    rfmFrequencyScore: 4,
    rfmMonetaryScore: 4,
    rfmScoredAt: now,

    // AI scores
    churnScore: 0.12,
    churnRiskLabel: 'LOW',
    churnScoredAt: now,
    ltv90d: decimal('3500.00'),
    ltv180d: decimal('7000.00'),
    ltv365d: decimal('14000.00'),
    ltvScoredAt: now,

    // COD profile
    codOrderCount: 3,
    codAcceptanceRate: 0.9,
    codRejectionRate: 0.1,
    fakeOrderScore: 0.05,
    isBlocked: false,

    // Channel opt-ins
    isSubscribedEmail: true,
    isSubscribedSms: false,
    isSubscribedWhatsapp: true,

    // Multi-store / identity resolution
    groupCustomerId: null,
    mergedIntoId: null,
    mergedAt: null,
    anonIds: ['anon_abc123'],

    // Timestamps
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: now,

    // Nested relations
    segmentMemberships: [
      {
        segmentId: 'seg_1',
        enteredAt: new Date('2024-07-01T00:00:00Z'),
        exitedAt: null,
        segment: { name: 'High Value' },
      },
    ],
    journeyEnrollments: [
      {
        journeyId: 'journey_1',
        status: 'ACTIVE',
        enrolledAt: new Date('2024-08-01T00:00:00Z'),
        currentStepId: 'step_2',
        journey: { name: 'VIP Onboarding' },
      },
    ],
    orders: [
      {
        id: 'ord_1',
        shopifyOrderId: '5001',
        orderNumber: 'ORD-001',
        totalPrice: decimal('2500.00'),
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        isCod: false,
        cancelledAt: null,
        placedAt: new Date('2025-01-10T00:00:00Z'),
      },
    ],
    abandonedCheckouts: [
      {
        id: 'ac_1',
        totalPrice: decimal('1200.00'),
        lineItems: [{ title: 'Shirt', quantity: 1 }],
        abandonedAt: new Date('2025-01-08T00:00:00Z'),
        recoveredAt: null,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests: getCustomerProfile
// ---------------------------------------------------------------------------

describe('getCustomerProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns enriched profile with all sections populated', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(makeCustomerRow() as never)
    vi.mocked(clickhouse.query).mockResolvedValue({
      json: async () => [
        {
          page_view_count: '42',
          add_to_cart_count: '7',
          checkout_started_count: '3',
          session_count: '15',
        },
      ],
    } as never)

    const result = await getCustomerProfile('merch_1', 'cust_1')

    expect(result.totalOrders).toBe(5)
    expect(result.eventStats.pageViewCount).toBe(42)
    expect(result.eventStats.addToCartCount).toBe(7)
    expect(result.eventStats.checkoutStartedCount).toBe(3)
    expect(result.eventStats.sessionCount).toBe(15)
    expect(result.segmentMemberships).toHaveLength(1)
    expect(result.segmentMemberships[0]?.segmentName).toBe('High Value')
    expect(result.journeyEnrollments).toHaveLength(1)
    expect(result.recentOrders.length).toBeGreaterThan(0)
    expect(result.recentAbandonedCheckouts).toHaveLength(1)
  })

  it('throws CUSTOMER_NOT_FOUND when customer does not exist', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null)

    await expect(getCustomerProfile('merch_1', 'cust_missing')).rejects.toThrow(
      'CUSTOMER_NOT_FOUND',
    )
  })

  it('returns zero eventStats if ClickHouse is unavailable', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(makeCustomerRow() as never)
    vi.mocked(clickhouse.query).mockRejectedValue(new Error('connection refused'))

    const result = await getCustomerProfile('merch_1', 'cust_1')

    // Function must resolve — ClickHouse errors are swallowed
    expect(result.eventStats.pageViewCount).toBe(0)
    expect(result.eventStats.addToCartCount).toBe(0)
    expect(result.eventStats.checkoutStartedCount).toBe(0)
    expect(result.eventStats.sessionCount).toBe(0)
  })

  it('correctly serializes Decimal fields to strings', async () => {
    const customer = makeCustomerRow()
    // Override with explicit decimal mocks to verify serialization
    customer.totalSpent = decimal('12500.00')
    customer.avgOrderValue = decimal('2500.00')
    customer.ltv90d = decimal('3500.00')

    vi.mocked(prisma.customer.findFirst).mockResolvedValue(customer as never)
    vi.mocked(clickhouse.query).mockResolvedValue({
      json: async () => [
        {
          page_view_count: '0',
          add_to_cart_count: '0',
          checkout_started_count: '0',
          session_count: '0',
        },
      ],
    } as never)

    const result = await getCustomerProfile('merch_1', 'cust_1')

    expect(result.totalSpent).toBe('12500.00')
    expect(result.avgOrderValue).toBe('2500.00')
    expect(result.ltv90d).toBe('3500.00')
  })
})

// ---------------------------------------------------------------------------
// Tests: listCustomers
// ---------------------------------------------------------------------------

describe('listCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Build a minimal customer list-item row (what the `select` projection returns). */
  function makeListCustomerRow(overrides?: Partial<{ id: string; email: string }>) {
    return {
      id: overrides?.id ?? 'cust_1',
      email: overrides?.email ?? 'ali@example.com',
      phone: '+923001234567',
      firstName: 'Ali',
      lastName: 'Hassan',
      totalOrders: 3,
      totalSpent: decimal('7500.00'),
      rfmSegment: 'LOYAL',
      churnRiskLabel: 'LOW',
      lastSeenAt: new Date('2025-01-14T00:00:00Z'),
      createdAt: new Date('2024-01-01T00:00:00Z'),
    }
  }

  it('returns paginated customer list', async () => {
    const rows = [makeListCustomerRow({ id: 'cust_1' }), makeListCustomerRow({ id: 'cust_2' })]

    // listCustomers uses prisma.$transaction internally
    vi.mocked(prisma.$transaction).mockResolvedValue([rows, 2] as never)

    const result = await listCustomers('merch_1', { page: 1, pageSize: 20 })

    expect(result.customers).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.customers[0]?.id).toBe('cust_1')
    expect(result.customers[1]?.id).toBe('cust_2')
    // Decimal serialization for list items
    expect(result.customers[0]?.totalSpent).toBe('7500.00')
  })

  it('applies search filter', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([[], 0] as never)

    await listCustomers('merch_1', { page: 1, pageSize: 20, search: 'ali' })

    // $transaction is called with an array of two Prisma promises — verify it was invoked
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1)

    // Inspect the where clause that was baked into the findMany call by checking
    // that customer.findMany was invoked with an OR clause containing the search term.
    // Because $transaction receives the result of prisma.customer.findMany() (a PrismaPromise),
    // we verify the spy by checking that findMany was called with the expected where shape.
    expect(vi.mocked(prisma.customer.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId: 'merch_1',
          OR: expect.arrayContaining([
            expect.objectContaining({ email: expect.objectContaining({ contains: 'ali' }) }),
          ]),
        }),
      }),
    )
  })
})
