import { describe, it, expect } from 'vitest'
import {
  resolveCodVerificationConfig,
  channelForAttempt,
  delayForAttempt,
  DEFAULT_COD_VERIFICATION_CONFIG,
} from './config.js'

describe('resolveCodVerificationConfig', () => {
  it('returns the default ladder for null / empty input', () => {
    expect(resolveCodVerificationConfig(null)).toEqual(DEFAULT_COD_VERIFICATION_CONFIG)
    expect(resolveCodVerificationConfig({})).toEqual(DEFAULT_COD_VERIFICATION_CONFIG)
    expect(resolveCodVerificationConfig('garbage')).toEqual(DEFAULT_COD_VERIFICATION_CONFIG)
  })

  it('accepts a valid custom config', () => {
    const cfg = resolveCodVerificationConfig({
      enabled: false,
      attempts: [
        { delayMinutes: 10, channel: 'WHATSAPP' },
        { delayMinutes: 60, channel: 'SMS' },
      ],
      autoCancelDelayMinutes: 120,
      autoCancel: false,
      promptTemplate: 'Confirm #{{orderNumber}}',
      whatsappTemplateId: 'tmpl_1',
    })
    expect(cfg.enabled).toBe(false)
    expect(cfg.attempts).toHaveLength(2)
    expect(cfg.autoCancelDelayMinutes).toBe(120)
    expect(cfg.autoCancel).toBe(false)
    expect(cfg.promptTemplate).toBe('Confirm #{{orderNumber}}')
    expect(cfg.whatsappTemplateId).toBe('tmpl_1')
  })

  it('sorts attempts ascending by delay and drops malformed entries', () => {
    const cfg = resolveCodVerificationConfig({
      attempts: [
        { delayMinutes: 240, channel: 'SMS' },
        { delayMinutes: 15, channel: 'WHATSAPP' },
        { delayMinutes: 5, channel: 'BOGUS' }, // invalid channel → dropped
        { channel: 'IVR' }, // missing delay → dropped
      ],
    })
    expect(cfg.attempts).toEqual([
      { delayMinutes: 15, channel: 'WHATSAPP' },
      { delayMinutes: 240, channel: 'SMS' },
    ])
  })

  it('falls back to the default ladder when no attempt survives cleaning', () => {
    const cfg = resolveCodVerificationConfig({ attempts: [{ channel: 'NOPE' }, {}] })
    expect(cfg.attempts).toEqual(DEFAULT_COD_VERIFICATION_CONFIG.attempts)
  })

  it('clamps autoCancelDelayMinutes to be >= the last attempt delay', () => {
    const cfg = resolveCodVerificationConfig({
      attempts: [{ delayMinutes: 300, channel: 'WHATSAPP' }],
      autoCancelDelayMinutes: 60, // earlier than the last attempt → clamped up to 300
    })
    expect(cfg.autoCancelDelayMinutes).toBe(300)
  })

  it('ignores an empty promptTemplate / whatsappTemplateId', () => {
    const cfg = resolveCodVerificationConfig({ promptTemplate: '   ', whatsappTemplateId: '' })
    expect(cfg.promptTemplate).toBeUndefined()
    expect(cfg.whatsappTemplateId).toBeUndefined()
  })
})

describe('channelForAttempt / delayForAttempt', () => {
  const cfg = DEFAULT_COD_VERIFICATION_CONFIG // [15 WA, 120 WA, 240 SMS]

  it('maps 1-based attempt numbers to their channel + delay', () => {
    expect(channelForAttempt(cfg, 1)).toBe('WHATSAPP')
    expect(channelForAttempt(cfg, 3)).toBe('SMS')
    expect(delayForAttempt(cfg, 1)).toBe(15)
    expect(delayForAttempt(cfg, 2)).toBe(120)
    expect(delayForAttempt(cfg, 3)).toBe(240)
  })

  it('clamps out-of-range attempt numbers to the ladder ends', () => {
    expect(channelForAttempt(cfg, 0)).toBe('WHATSAPP')
    expect(channelForAttempt(cfg, 99)).toBe('SMS')
    expect(delayForAttempt(cfg, 99)).toBe(240)
  })
})
