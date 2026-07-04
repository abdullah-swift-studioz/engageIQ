import { describe, it, expect } from 'vitest'
import crypto from 'crypto'

// Mock module deps so importing the route file does not load the real env/prisma.
import { vi } from 'vitest'
vi.mock('@engageiq/db', () => ({ prisma: {} }))
vi.mock('@engageiq/shared', () => ({ env: {} }))

import { verifyTwilioSignature, buildSmsStatusUpdate, isSmsStopMessage } from './sms.js'

describe('verifyTwilioSignature', () => {
  const authToken = 'my-twilio-token'
  const url = 'https://api.example.com/webhooks/sms'
  const params = { MessageSid: 'SM123', MessageStatus: 'delivered' }
  // Recompute Twilio's canonical signature: url + sorted(key+value), HMAC-SHA1, base64.
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + (params as Record<string, string>)[k], url)
  const valid = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')

  it('accepts a valid signature', () => {
    expect(verifyTwilioSignature(url, params, valid, authToken)).toBe(true)
  })

  it('rejects a tampered signature', () => {
    expect(verifyTwilioSignature(url, params, 'bogus==', authToken)).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(verifyTwilioSignature(url, params, undefined, authToken)).toBe(false)
  })

  it('rejects when a param is tampered (signature no longer matches)', () => {
    expect(verifyTwilioSignature(url, { ...params, MessageStatus: 'failed' }, valid, authToken)).toBe(false)
  })
})

describe('buildSmsStatusUpdate — monotonic advancement', () => {
  const ts = new Date('2026-07-03T10:00:00Z')

  it('advances queued → sent → delivered', () => {
    expect(buildSmsStatusUpdate({ status: 'QUEUED' }, 'sent', ts)).toMatchObject({ status: 'SENT', sentAt: ts })
    expect(buildSmsStatusUpdate({ status: 'SENT' }, 'delivered', ts)).toMatchObject({ status: 'DELIVERED', deliveredAt: ts })
  })

  it('maps undelivered to a terminal FAILED and stamps failedAt', () => {
    expect(buildSmsStatusUpdate({ status: 'SENT' }, 'undelivered', ts)).toMatchObject({ status: 'FAILED', failedAt: ts })
  })

  it('does NOT regress: a delivered event after failed keeps FAILED but stamps deliveredAt', () => {
    const after = buildSmsStatusUpdate({ status: 'FAILED' }, 'delivered', ts)
    expect(after?.deliveredAt).toEqual(ts)
    expect(after?.status).toBeUndefined()
  })

  it('returns null for an unknown Twilio status', () => {
    expect(buildSmsStatusUpdate({ status: 'SENT' }, 'accepted', ts)).toBeNull()
  })
})

describe('isSmsStopMessage', () => {
  it('detects Twilio STOP keywords (case-insensitive, trimmed)', () => {
    expect(isSmsStopMessage('STOP')).toBe(true)
    expect(isSmsStopMessage(' unsubscribe ')).toBe(true)
    expect(isSmsStopMessage('Cancel')).toBe(true)
    expect(isSmsStopMessage('QUIT')).toBe(true)
  })

  it('ignores ordinary inbound text and empty/undefined', () => {
    expect(isSmsStopMessage('where is my order?')).toBe(false)
    expect(isSmsStopMessage('')).toBe(false)
    expect(isSmsStopMessage(undefined)).toBe(false)
  })
})
