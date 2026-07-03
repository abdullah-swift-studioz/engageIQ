import { describe, it, expect } from 'vitest'
import {
  SERVICE_WINDOW_MS,
  isWithinServiceWindow,
  serviceWindowRemainingMs,
  computeTimeoutAt,
} from './window.js'

const now = new Date('2026-07-03T12:00:00Z')

describe('isWithinServiceWindow', () => {
  it('is false when there is no inbound', () => {
    expect(isWithinServiceWindow(null, now)).toBe(false)
    expect(isWithinServiceWindow(undefined, now)).toBe(false)
  })

  it('is true within 24h of the last inbound', () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    expect(isWithinServiceWindow(oneHourAgo, now)).toBe(true)
  })

  it('is false once 24h have elapsed', () => {
    const justOver = new Date(now.getTime() - SERVICE_WINDOW_MS - 1)
    expect(isWithinServiceWindow(justOver, now)).toBe(false)
  })
})

describe('serviceWindowRemainingMs', () => {
  it('reports the remaining window and clamps at 0', () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    expect(serviceWindowRemainingMs(twoHoursAgo, now)).toBe(SERVICE_WINDOW_MS - 2 * 60 * 60 * 1000)
    const longAgo = new Date(now.getTime() - 2 * SERVICE_WINDOW_MS)
    expect(serviceWindowRemainingMs(longAgo, now)).toBe(0)
    expect(serviceWindowRemainingMs(null, now)).toBe(0)
  })
})

describe('computeTimeoutAt', () => {
  it('adds the given minutes', () => {
    expect(computeTimeoutAt(now, 30).getTime()).toBe(now.getTime() + 30 * 60_000)
  })

  it('floors a non-positive/invalid timeout to 1 minute so the wait is never pre-expired', () => {
    expect(computeTimeoutAt(now, 0).getTime()).toBe(now.getTime() + 60_000)
    expect(computeTimeoutAt(now, -5).getTime()).toBe(now.getTime() + 60_000)
    expect(computeTimeoutAt(now, Number.NaN).getTime()).toBe(now.getTime() + 60_000)
  })
})
