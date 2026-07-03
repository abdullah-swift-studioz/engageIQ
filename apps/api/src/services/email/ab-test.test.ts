import { describe, it, expect } from 'vitest'
import { assignVariant, decideWinner, type AbVariant, type VariantRate } from './ab-test.js'

const variants: AbVariant[] = [
  { id: 'a', name: 'A', allocationPct: 50 },
  { id: 'b', name: 'B', allocationPct: 50 },
]

describe('assignVariant', () => {
  it('is deterministic for the same seed', () => {
    const first = assignVariant(variants, 'seed:cust_1')
    const again = assignVariant(variants, 'seed:cust_1')
    expect(first?.id).toBe(again?.id)
  })

  it('returns null for an empty variant set', () => {
    expect(assignVariant([], 'x')).toBeNull()
  })

  it('respects allocation weight (90/10 skews to A)', () => {
    const skewed: AbVariant[] = [
      { id: 'a', name: 'A', allocationPct: 90 },
      { id: 'b', name: 'B', allocationPct: 10 },
    ]
    let a = 0
    for (let i = 0; i < 2000; i++) {
      if (assignVariant(skewed, `c_${i}`)?.id === 'a') a++
    }
    // Expect roughly 90% ± a wide margin; assert clearly above 50/50.
    expect(a / 2000).toBeGreaterThan(0.8)
  })

  it('handles all-zero weights as an equal split (never throws, always assigns)', () => {
    const zero: AbVariant[] = [
      { id: 'a', name: 'A', allocationPct: 0 },
      { id: 'b', name: 'B', allocationPct: 0 },
    ]
    expect(assignVariant(zero, 's')).not.toBeNull()
  })
})

describe('decideWinner', () => {
  it('returns no winner with fewer than two usable variants', () => {
    expect(decideWinner([{ id: 'a', n: 100, x: 40 }])).toEqual({
      winnerVariantId: null,
      confidenceLevel: 0,
      significant: false,
    })
  })

  it('declares a winner when the difference is large and significant', () => {
    const rates: VariantRate[] = [
      { id: 'a', n: 1000, x: 400 }, // 40% open
      { id: 'b', n: 1000, x: 200 }, // 20% open
    ]
    const d = decideWinner(rates)
    expect(d.significant).toBe(true)
    expect(d.winnerVariantId).toBe('a')
    expect(d.confidenceLevel).toBeGreaterThan(0.95)
  })

  it('declares no winner when rates are close on small samples', () => {
    const rates: VariantRate[] = [
      { id: 'a', n: 50, x: 11 },
      { id: 'b', n: 50, x: 10 },
    ]
    const d = decideWinner(rates)
    expect(d.significant).toBe(false)
    expect(d.winnerVariantId).toBeNull()
  })
})
