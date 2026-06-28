import { describe, it, expect } from 'vitest'
import { substituteVariables } from './template-variables.js'
import type { VariableMapEntry } from './template-variables.js'

describe('substituteVariables', () => {
  it('resolves fields from the customer profile in {{n}} order', () => {
    const map: VariableMapEntry[] = [
      { index: 1, field: 'firstName' },
      { index: 2, field: 'city' },
    ]
    const result = substituteVariables(map, { firstName: 'Fatima', city: 'Lahore' })
    expect(result).toEqual({ ok: true, variables: ['Fatima', 'Lahore'] })
  })

  it('sorts by index regardless of array order', () => {
    const map: VariableMapEntry[] = [
      { index: 2, field: 'city' },
      { index: 1, field: 'firstName' },
    ]
    const result = substituteVariables(map, { firstName: 'Usman', city: 'Karachi' })
    expect(result).toEqual({ ok: true, variables: ['Usman', 'Karachi'] })
  })

  it('falls back to the default when the field resolves empty', () => {
    const map: VariableMapEntry[] = [{ index: 1, field: 'firstName', default: 'there' }]
    const result = substituteVariables(map, { firstName: null })
    expect(result).toEqual({ ok: true, variables: ['there'] })
  })

  it('fails (no default) when the field resolves empty', () => {
    const map: VariableMapEntry[] = [
      { index: 1, field: 'firstName', default: 'there' },
      { index: 2, field: 'city' },
    ]
    const result = substituteVariables(map, { firstName: 'Zara', city: '' })
    expect(result).toEqual({ ok: false, missingIndex: 2 })
  })

  it('stringifies numeric and Decimal-like values', () => {
    const map: VariableMapEntry[] = [
      { index: 1, field: 'totalOrders' },
      { index: 2, field: 'totalSpent' },
    ]
    const decimalLike = { toString: () => '4999.00' }
    const result = substituteVariables(map, { totalOrders: 3, totalSpent: decimalLike })
    expect(result).toEqual({ ok: true, variables: ['3', '4999.00'] })
  })

  it('treats unknown fields as empty (uses default or fails)', () => {
    const map: VariableMapEntry[] = [{ index: 1, field: 'secretColumn', default: 'safe' }]
    const result = substituteVariables(map, { secretColumn: 'leak' })
    expect(result).toEqual({ ok: true, variables: ['safe'] })
  })
})
