import { describe, it, expect } from 'vitest'
import {
  hashToBucket,
  pickVariant,
  matchesPage,
  resolveElementConfig,
} from './targeting.service.js'
import type { OnSiteElementConfig, OnSiteVariant } from '@engageiq/shared'

const variants: OnSiteVariant[] = [
  { id: 'a', name: 'A', config: { headline: 'A' }, allocationPct: 50 },
  { id: 'b', name: 'B', config: { headline: 'B' }, allocationPct: 50 },
]

describe('hashToBucket', () => {
  it('is deterministic for the same visitor + test', () => {
    const first = hashToBucket('anon-123', 'test-1')
    const second = hashToBucket('anon-123', 'test-1')
    expect(first).toBe(second)
  })

  it('stays within 0..99', () => {
    for (const anon of ['x', 'y', 'z', 'anon-abc', 'anon-999']) {
      const b = hashToBucket(anon, 'test-1')
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(100)
    }
  })

  it('varies by test id so a visitor can land differently across tests', () => {
    const buckets = new Set(
      ['t1', 't2', 't3', 't4', 't5'].map((t) => hashToBucket('anon-123', t)),
    )
    // Not all five collapse to a single bucket.
    expect(buckets.size).toBeGreaterThan(1)
  })

  it('spreads a population roughly evenly across a 50/50 split', () => {
    let a = 0
    for (let i = 0; i < 1000; i++) {
      if (pickVariant(hashToBucket(`visitor-${i}`, 'test-1'), variants)?.id === 'a') a++
    }
    // Allow generous slack; just assert it's not wildly skewed.
    expect(a).toBeGreaterThan(350)
    expect(a).toBeLessThan(650)
  })
})

describe('pickVariant', () => {
  it('maps buckets to the correct allocation window', () => {
    expect(pickVariant(0, variants)?.id).toBe('a')
    expect(pickVariant(49, variants)?.id).toBe('a')
    expect(pickVariant(50, variants)?.id).toBe('b')
    expect(pickVariant(99, variants)?.id).toBe('b')
  })

  it('respects uneven allocations', () => {
    const uneven: OnSiteVariant[] = [
      { id: 'a', name: 'A', config: {}, allocationPct: 80 },
      { id: 'b', name: 'B', config: {}, allocationPct: 20 },
    ]
    expect(pickVariant(0, uneven)?.id).toBe('a')
    expect(pickVariant(79, uneven)?.id).toBe('a')
    expect(pickVariant(80, uneven)?.id).toBe('b')
  })

  it('returns null for an empty variant set', () => {
    expect(pickVariant(10, [])).toBeNull()
  })

  it('falls back to the last variant when allocations under-sum', () => {
    const under: OnSiteVariant[] = [
      { id: 'a', name: 'A', config: {}, allocationPct: 30 },
      { id: 'b', name: 'B', config: {}, allocationPct: 30 },
    ]
    // bucket 90 is past the summed 60 — last variant wins.
    expect(pickVariant(90, under)?.id).toBe('b')
  })
})

describe('matchesPage', () => {
  it('matches everything when no pattern is set', () => {
    expect(matchesPage(undefined, '/anything')).toBe(true)
  })
  it('substring-matches the path', () => {
    expect(matchesPage('/products', '/products/shoes')).toBe(true)
    expect(matchesPage('/products', '/collections/all')).toBe(false)
  })
  it('does not match when a pattern is set but no path is provided', () => {
    expect(matchesPage('/products', undefined)).toBe(false)
  })
})

describe('resolveElementConfig', () => {
  const base: OnSiteElementConfig = { headline: 'base' }

  it('returns the base config when there is no test', () => {
    const r = resolveElementConfig('anon-1', base, undefined)
    expect(r.config).toBe(base)
    expect(r.variantId).toBeUndefined()
  })

  it('assigns a deterministic variant for a RUNNING test', () => {
    const test = { id: 'test-1', status: 'RUNNING', variants, winnerVariantId: null }
    const r1 = resolveElementConfig('anon-1', base, test)
    const r2 = resolveElementConfig('anon-1', base, test)
    expect(r1.variantId).toBe(r2.variantId)
    expect(r1.abTestId).toBe('test-1')
    expect(['a', 'b']).toContain(r1.variantId)
  })

  it('serves the winning variant to everyone once WINNER_DECIDED', () => {
    const test = { id: 'test-1', status: 'WINNER_DECIDED', variants, winnerVariantId: 'b' }
    const r1 = resolveElementConfig('anon-1', base, test)
    const r2 = resolveElementConfig('anon-2', base, test)
    expect(r1.variantId).toBe('b')
    expect(r2.variantId).toBe('b')
    expect(r1.config.headline).toBe('B')
  })
})
