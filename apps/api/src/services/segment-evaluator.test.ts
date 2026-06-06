import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SegmentGroup } from '@engageiq/shared'

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
