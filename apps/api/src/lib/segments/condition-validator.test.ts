import { describe, it, expect } from 'vitest'
import { validateConditionTree } from './condition-validator.js'
import type { SegmentGroup } from '@engageiq/shared'

const validCondition = { field: 'total_orders', operator: 'gt' as const, value: 5 }
const validGroup: SegmentGroup = { match: 'all', rules: [validCondition] }

describe('validateConditionTree', () => {
  it('accepts a valid single-condition group', () => {
    const result = validateConditionTree(validGroup)
    expect(result.ok).toBe(true)
  })

  it('accepts a valid nested group (depth 2)', () => {
    const nested: SegmentGroup = {
      match: 'all',
      rules: [
        validCondition,
        { match: 'any', rules: [
          { field: 'city', operator: 'eq', value: 'Lahore' },
          { field: 'city', operator: 'eq', value: 'Karachi' },
        ]},
      ],
    }
    expect(validateConditionTree(nested).ok).toBe(true)
  })

  it('rejects depth > 2', () => {
    const tooDeep: SegmentGroup = {
      match: 'all',
      rules: [{
        match: 'any',
        rules: [{
          match: 'all',
          rules: [validCondition],
        }],
      }],
    }
    const result = validateConditionTree(tooDeep)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/depth/)
  })

  it('rejects empty rules array', () => {
    const result = validateConditionTree({ match: 'all', rules: [] })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/at least one/)
  })

  it('rejects unknown field', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'nonexistent_field', operator: 'eq', value: 'x' }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/Unknown field/)
  })

  it('rejects operator not valid for field type', () => {
    // 'tags' is an array field — 'gt' is a number operator
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'tags', operator: 'gt', value: 5 }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/not valid/)
  })

  it('rejects between with non-tuple value', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'total_orders', operator: 'between', value: 5 }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/tuple/)
  })

  it('rejects within_last_days with non-positive integer', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'last_order_date', operator: 'within_last_days', value: -3 }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/positive integer/)
  })

  it('rejects in/includes_any with empty array', () => {
    const result = validateConditionTree({
      match: 'all',
      rules: [{ field: 'tags', operator: 'includes_any', value: [] }],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/non-empty/)
  })

  it('accepts valid condition for each field type', () => {
    const cases: SegmentGroup[] = [
      { match: 'all', rules: [{ field: 'total_spent', operator: 'gte', value: 5000 }] },
      { match: 'all', rules: [{ field: 'city', operator: 'contains', value: 'lah' }] },
      { match: 'all', rules: [{ field: 'accepts_marketing_email', operator: 'is_true', value: null }] },
      { match: 'all', rules: [{ field: 'last_order_date', operator: 'within_last_days', value: 30 }] },
      { match: 'all', rules: [{ field: 'tags', operator: 'includes_any', value: ['vip'] }] },
      { match: 'all', rules: [{ field: 'rfm_segment', operator: 'in', value: ['Champions', 'LoyalCustomers'] }] },
    ]
    for (const group of cases) {
      const result = validateConditionTree(group)
      expect(result.ok, JSON.stringify(group)).toBe(true)
    }
  })
})
