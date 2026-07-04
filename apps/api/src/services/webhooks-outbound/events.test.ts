import { describe, it, expect } from 'vitest'
import { OUTBOUND_EVENTS, ALL_OUTBOUND_EVENTS, isValidOutboundEvent } from './events.js'

describe('outbound events catalog', () => {
  it('exposes the five subscribable events from guide 9.3', () => {
    expect(ALL_OUTBOUND_EVENTS).toEqual([
      'segment.entered',
      'segment.exited',
      'campaign.completed',
      'cod.verification_result',
      'customer.churn_threshold',
    ])
    expect(OUTBOUND_EVENTS.SEGMENT_ENTERED).toBe('segment.entered')
  })

  it('validates event names', () => {
    expect(isValidOutboundEvent('segment.entered')).toBe(true)
    expect(isValidOutboundEvent('ping')).toBe(false) // ping is deliverable but not subscribable
    expect(isValidOutboundEvent('nonsense')).toBe(false)
  })
})
