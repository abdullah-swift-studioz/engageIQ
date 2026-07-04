import { describe, it, expect, vi } from 'vitest'

// Mock transitive deps so importing the service does not run env validation / open Redis.
vi.mock('@engageiq/shared', () => ({ env: { ML_SERVICE_URL: 'http://ml.test', ML_SERVICE_TIMEOUT_MS: 1000 } }))
vi.mock('@engageiq/db', () => ({ prisma: {} }))
vi.mock('@engageiq/queue', () => ({ redisConnection: {}, scoringQueue: { upsertJobScheduler: vi.fn() } }))

import { resolveThresholds, decideGate, DEFAULT_THRESHOLDS } from './fake-order-gate.service.js'

describe('resolveThresholds', () => {
  it('falls back to defaults for missing/invalid config', () => {
    expect(resolveThresholds(null)).toEqual(DEFAULT_THRESHOLDS)
    expect(resolveThresholds({})).toEqual(DEFAULT_THRESHOLDS)
    expect(resolveThresholds({ verify: 'x', cancel: 999 })).toEqual(DEFAULT_THRESHOLDS)
  })

  it('reads merchant verify + cancel(hold) bands', () => {
    expect(resolveThresholds({ verify: 30, cancel: 80 })).toEqual({ verify: 30, hold: 80 })
    expect(resolveThresholds({ verify: 25, hold: 60 })).toEqual({ verify: 25, hold: 60 })
  })

  it('guards against an inverted config (hold < verify)', () => {
    expect(resolveThresholds({ verify: 70, cancel: 40 })).toEqual({ verify: 70, hold: 70 })
  })
})

describe('decideGate', () => {
  const t = DEFAULT_THRESHOLDS // verify 40 / hold 70
  it('process below the verify band', () => {
    expect(decideGate(0, t)).toBe('process')
    expect(decideGate(39.9, t)).toBe('process')
  })
  it('verify in the middle band', () => {
    expect(decideGate(40, t)).toBe('verify')
    expect(decideGate(69.9, t)).toBe('verify')
  })
  it('hold at/above the top band', () => {
    expect(decideGate(70, t)).toBe('hold')
    expect(decideGate(100, t)).toBe('hold')
  })
  it('honours custom merchant thresholds', () => {
    expect(decideGate(50, { verify: 55, hold: 90 })).toBe('process')
    expect(decideGate(60, { verify: 55, hold: 90 })).toBe('verify')
    expect(decideGate(95, { verify: 55, hold: 90 })).toBe('hold')
  })
})
