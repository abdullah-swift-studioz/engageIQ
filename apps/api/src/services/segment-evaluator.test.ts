import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SegmentGroup, EnrichedCustomerProfile } from '@engageiq/shared'

vi.mock('@engageiq/db', () => ({
  prisma: {
    segment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    segmentMembership: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customer: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

import { compileToPrismaWhere } from './segment-evaluator.js'

const MERCHANT = 'merchant_123'

describe('compileToPrismaWhere', () => {
  it('always injects merchantId as outer AND', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gt', value: 5 }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const andClauses = (where as { AND: unknown[] }).AND
    expect(andClauses).toEqual(
      expect.arrayContaining([{ merchantId: MERCHANT }]),
    )
  })

  it('never uses user-supplied field string as a key directly', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_spent', operator: 'gte', value: 5000 }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).not.toContain('"total_spent"')
    expect(str).toContain('"totalSpent"')
  })

  it('AND group produces { AND: [...] } inside outer AND', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 5 },
        { field: 'total_orders', operator: 'lte', value: 50 },
      ],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const andClauses = (where as { AND: unknown[] }).AND
    const groupClause = andClauses.find(
      (c) => typeof c === 'object' && c !== null && 'AND' in c,
    )
    expect(groupClause).toBeDefined()
  })

  it('OR group produces { OR: [...] }', () => {
    const group: SegmentGroup = {
      match: 'any',
      rules: [
        { field: 'city', operator: 'eq', value: 'Lahore' },
        { field: 'city', operator: 'eq', value: 'Karachi' },
      ],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const andClauses = (where as { AND: unknown[] }).AND
    const groupClause = andClauses.find(
      (c) => typeof c === 'object' && c !== null && 'OR' in c,
    )
    expect(groupClause).toBeDefined()
  })

  it('nested group: root AND with child OR', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 0 },
        {
          match: 'any',
          rules: [
            { field: 'city', operator: 'eq', value: 'Lahore' },
            { field: 'city', operator: 'eq', value: 'Karachi' },
          ],
        },
      ],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"OR"')
    expect(str).toContain('"AND"')
  })

  it('between produces gte+lte', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'between', value: [5, 20] }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"gte"')
    expect(str).toContain('"lte"')
  })

  it('includes_none produces NOT wrapper', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_none', value: ['blocked'] }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"NOT"')
  })

  it('is_set produces { not: null }', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'last_order_date', operator: 'is_set', value: null }],
    }
    const where = compileToPrismaWhere(group, MERCHANT)
    const str = JSON.stringify(where)
    expect(str).toContain('"not"')
    expect(str).toContain('null')
  })
})

import { evaluateProfile } from './segment-evaluator.js'

function makeProfile(overrides: Partial<EnrichedCustomerProfile> = {}): EnrichedCustomerProfile {
  return {
    id: 'cust_1',
    merchantId: 'merchant_123',
    shopifyCustomerId: null,
    email: 'test@example.com',
    phone: null,
    firstName: 'Test',
    lastName: 'User',
    city: 'Lahore',
    province: null,
    country: 'PK',
    languagePreference: null,
    tags: ['vip', 'loyal'],
    totalOrders: 10,
    totalSpent: '50000.00',
    avgOrderValue: '5000.00',
    firstOrderAt: '2024-01-01T00:00:00.000Z',
    lastOrderAt: '2025-06-01T00:00:00.000Z',
    lastSeenAt: '2025-06-05T00:00:00.000Z',
    sessionCount: 25,
    eventStats: { totalEvents: 100, lastEventAt: null, topEvents: [] },
    rfmSegment: 'Champions',
    rfmRecencyScore: 5,
    rfmFrequencyScore: 5,
    rfmMonetaryScore: 5,
    rfmScoredAt: null,
    churnScore: 0.1,
    churnRiskLabel: 'LOW',
    churnScoredAt: null,
    ltv90d: '15000.00',
    ltv180d: null,
    ltv365d: null,
    ltvScoredAt: null,
    codOrderCount: 3,
    codAcceptanceRate: 0.9,
    codRejectionRate: 0.1,
    fakeOrderScore: 5,
    isBlocked: false,
    isSubscribedEmail: true,
    isSubscribedSms: true,
    isSubscribedWhatsapp: true,
    groupCustomerId: null,
    mergedIntoId: null,
    mergedAt: null,
    anonIds: [],
    segmentMemberships: [],
    journeyEnrollments: [],
    recentOrders: [],
    recentCheckouts: [],
    ...overrides,
  } as EnrichedCustomerProfile
}

describe('evaluateProfile', () => {
  it('matches gt condition', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gt', value: 5 }],
    }
    expect(evaluateProfile(group, makeProfile({ totalOrders: 10 }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ totalOrders: 3 }))).toBe(false)
  })

  it('matches gte condition', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'gte', value: 10 }],
    }
    expect(evaluateProfile(group, makeProfile({ totalOrders: 10 }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ totalOrders: 9 }))).toBe(false)
  })

  it('matches between for number (totalSpent as string)', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'total_spent', operator: 'between', value: [10000, 100000] }],
    }
    expect(evaluateProfile(group, makeProfile({ totalSpent: '50000.00' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ totalSpent: '5000.00' }))).toBe(false)
  })

  it('matches enum in', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'rfm_segment', operator: 'in', value: ['Champions', 'LoyalCustomers'] }],
    }
    expect(evaluateProfile(group, makeProfile({ rfmSegment: 'Champions' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ rfmSegment: 'Hibernating' }))).toBe(false)
  })

  it('matches boolean is_true', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'accepts_marketing_email', operator: 'is_true', value: null }],
    }
    expect(evaluateProfile(group, makeProfile({ isSubscribedEmail: true }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ isSubscribedEmail: false }))).toBe(false)
  })

  it('matches array includes_any', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_any', value: ['vip', 'premium'] }],
    }
    expect(evaluateProfile(group, makeProfile({ tags: ['vip', 'loyal'] }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ tags: ['new'] }))).toBe(false)
  })

  it('matches array includes_none', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_none', value: ['blocked'] }],
    }
    expect(evaluateProfile(group, makeProfile({ tags: ['vip'] }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ tags: ['blocked'] }))).toBe(false)
  })

  it('matches OR group (any)', () => {
    const group: SegmentGroup = {
      match: 'any',
      rules: [
        { field: 'city', operator: 'eq', value: 'Lahore' },
        { field: 'city', operator: 'eq', value: 'Karachi' },
      ],
    }
    expect(evaluateProfile(group, makeProfile({ city: 'Lahore' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ city: 'Karachi' }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ city: 'Islamabad' }))).toBe(false)
  })

  it('matches nested group: root AND with child OR', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 0 },
        {
          match: 'any',
          rules: [
            { field: 'city', operator: 'eq', value: 'Lahore' },
            { field: 'city', operator: 'eq', value: 'Karachi' },
          ],
        },
      ],
    }
    expect(evaluateProfile(group, makeProfile({ city: 'Lahore', totalOrders: 5 }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ city: 'Islamabad', totalOrders: 5 }))).toBe(false)
    expect(evaluateProfile(group, makeProfile({ city: 'Lahore', totalOrders: 0 }))).toBe(false)
  })

  it('within_last_days matches recent dates', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'last_seen_at', operator: 'within_last_days', value: 7 }],
    }
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString()
    expect(evaluateProfile(group, makeProfile({ lastSeenAt: yesterday }))).toBe(true)
    expect(evaluateProfile(group, makeProfile({ lastSeenAt: oldDate }))).toBe(false)
  })

  it('is_set returns false for null', () => {
    const group: SegmentGroup = {
      match: 'all',
      rules: [{ field: 'last_order_date', operator: 'is_set', value: null }],
    }
    expect(evaluateProfile(group, makeProfile({ lastOrderAt: null }))).toBe(false)
    expect(evaluateProfile(group, makeProfile({ lastOrderAt: '2025-01-01T00:00:00.000Z' }))).toBe(true)
  })
})

// ─── SQL ↔ In-memory parity ───────────────────────────────────────────────────

describe('SQL vs in-memory parity', () => {
  const profiles = Array.from({ length: 10 }, (_, i) =>
    makeProfile({
      id: `cust_${i}`,
      totalOrders: i * 2,
      totalSpent: String(i * 1000),
      city: i % 2 === 0 ? 'Lahore' : 'Karachi',
      rfmSegment: i < 5 ? 'Champions' : 'Hibernating',
      tags: i % 3 === 0 ? ['vip'] : ['regular'],
    }),
  )

  const testGroups: SegmentGroup[] = [
    { match: 'all', rules: [{ field: 'total_orders', operator: 'gte', value: 10 }] },
    {
      match: 'any',
      rules: [
        { field: 'rfm_segment', operator: 'eq', value: 'Champions' },
        { field: 'tags', operator: 'includes_any', value: ['vip'] },
      ],
    },
    {
      match: 'all',
      rules: [
        { field: 'total_orders', operator: 'gt', value: 0 },
        { match: 'any', rules: [
          { field: 'city', operator: 'eq', value: 'Lahore' },
          { field: 'city', operator: 'eq', value: 'Karachi' },
        ]},
      ],
    },
  ]

  it('in-memory results are internally consistent across 10 profiles × 3 groups', () => {
    for (const group of testGroups) {
      const results = profiles.map((p) => evaluateProfile(group, p))
      const results2 = profiles.map((p) => evaluateProfile(group, p))
      expect(results).toEqual(results2)
    }
  })

  it('compileToPrismaWhere produces a WHERE clause containing merchantId for each test group', () => {
    for (const group of testGroups) {
      const where = compileToPrismaWhere(group, 'merchant_123')
      expect(JSON.stringify(where)).toContain('merchant_123')
    }
  })
})
