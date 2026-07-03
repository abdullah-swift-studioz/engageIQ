import { describe, it, expect } from 'vitest'
import {
  CreateElementBodySchema,
  OnSiteDisplayRulesSchema,
  CreateAbTestBodySchema,
  DeliveryBodySchema,
} from './schema.js'

describe('OnSiteDisplayRulesSchema', () => {
  it('requires timedDelaySeconds for a timed trigger', () => {
    expect(OnSiteDisplayRulesSchema.safeParse({ trigger: 'timed' }).success).toBe(false)
    expect(OnSiteDisplayRulesSchema.safeParse({ trigger: 'timed', timedDelaySeconds: 10 }).success).toBe(true)
  })

  it('requires cartValueThreshold for a cart_value trigger', () => {
    expect(OnSiteDisplayRulesSchema.safeParse({ trigger: 'cart_value' }).success).toBe(false)
    expect(
      OnSiteDisplayRulesSchema.safeParse({ trigger: 'cart_value', cartValueThreshold: 5000 }).success,
    ).toBe(true)
  })

  it('accepts exit_intent / new_visitor with no extra params', () => {
    expect(OnSiteDisplayRulesSchema.safeParse({ trigger: 'exit_intent' }).success).toBe(true)
    expect(OnSiteDisplayRulesSchema.safeParse({ trigger: 'new_visitor' }).success).toBe(true)
  })
})

describe('CreateElementBodySchema', () => {
  it('accepts a well-formed popup', () => {
    const result = CreateElementBodySchema.safeParse({
      name: 'Welcome',
      type: 'POPUP',
      config: { headline: 'Hi', ctaText: 'Shop', position: 'center' },
      displayRules: { trigger: 'timed', timedDelaySeconds: 8, frequency: 'once_per_session' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown element type', () => {
    const result = CreateElementBodySchema.safeParse({
      name: 'X',
      type: 'BANNER',
      config: {},
      displayRules: { trigger: 'exit_intent' },
    })
    expect(result.success).toBe(false)
  })
})

describe('CreateAbTestBodySchema', () => {
  const variant = (allocationPct: number) => ({ name: 'V', config: { headline: 'h' }, allocationPct })

  it('accepts two variants summing to 100', () => {
    const result = CreateAbTestBodySchema.safeParse({
      name: 'Test',
      variants: [variant(50), variant(50)],
    })
    expect(result.success).toBe(true)
  })

  it('rejects allocations that do not sum to 100', () => {
    const result = CreateAbTestBodySchema.safeParse({
      name: 'Test',
      variants: [variant(60), variant(60)],
    })
    expect(result.success).toBe(false)
  })

  it('requires at least two variants', () => {
    const result = CreateAbTestBodySchema.safeParse({ name: 'Test', variants: [variant(100)] })
    expect(result.success).toBe(false)
  })
})

describe('DeliveryBodySchema', () => {
  it('requires merchantId and anonId', () => {
    expect(DeliveryBodySchema.safeParse({ anonId: 'a' }).success).toBe(false)
    expect(DeliveryBodySchema.safeParse({ merchantId: 'm', anonId: 'a' }).success).toBe(true)
  })

  it('accepts optional visitor context', () => {
    const result = DeliveryBodySchema.safeParse({
      merchantId: 'm',
      anonId: 'a',
      customerId: null,
      pagePath: '/products/x',
      cartValue: 1200,
      viewedProductIds: ['p1', 'p2'],
    })
    expect(result.success).toBe(true)
  })
})
