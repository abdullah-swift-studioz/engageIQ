import { describe, it, expect } from 'vitest'
import { CreateTemplateBodySchema, extractPlaceholderIndices } from './schema.js'

describe('extractPlaceholderIndices', () => {
  it('extracts distinct ascending indices', () => {
    expect(extractPlaceholderIndices('Hi {{1}}, your {{2}} ships to {{2}}')).toEqual([1, 2])
  })
  it('returns empty for a body with no placeholders', () => {
    expect(extractPlaceholderIndices('No variables here')).toEqual([])
  })
})

describe('CreateTemplateBodySchema', () => {
  const base = { name: 'order_update', language: 'en', category: 'UTILITY' as const }

  it('accepts a matching body + variableMap', () => {
    const result = CreateTemplateBodySchema.safeParse({
      ...base,
      bodyText: 'Hi {{1}}, from {{2}}',
      variableMap: [{ index: 1, field: 'firstName' }, { index: 2, field: 'city', default: 'your city' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects when variableMap count does not match placeholders', () => {
    const result = CreateTemplateBodySchema.safeParse({
      ...base,
      bodyText: 'Hi {{1}}, from {{2}}',
      variableMap: [{ index: 1, field: 'firstName' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-contiguous indices', () => {
    const result = CreateTemplateBodySchema.safeParse({
      ...base,
      bodyText: 'Hi {{1}} and {{3}}',
      variableMap: [{ index: 1, field: 'a' }, { index: 3, field: 'b' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid template name (uppercase/spaces)', () => {
    const result = CreateTemplateBodySchema.safeParse({
      ...base, name: 'Order Update', bodyText: 'hello', variableMap: [],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a body with no variables and an empty variableMap', () => {
    const result = CreateTemplateBodySchema.safeParse({
      ...base, bodyText: 'Thanks for your order!', variableMap: [],
    })
    expect(result.success).toBe(true)
  })
})
