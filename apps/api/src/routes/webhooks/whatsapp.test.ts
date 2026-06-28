import { describe, it, expect, vi } from 'vitest'
import crypto from 'crypto'

// Mock module deps so importing the route file does not load the real env/prisma.
vi.mock('@engageiq/db', () => ({ prisma: {} }))
vi.mock('@engageiq/shared', () => ({ env: {} }))

import { verifyMetaSignature, buildStatusUpdate, isOptOutMessage } from './whatsapp.js'

describe('verifyMetaSignature', () => {
  const secret = 'app-secret'
  const body = Buffer.from(JSON.stringify({ hello: 'world' }))
  const valid = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a valid signature', () => {
    expect(verifyMetaSignature(body, valid, secret)).toBe(true)
  })

  it('rejects a tampered signature', () => {
    expect(verifyMetaSignature(body, 'sha256=deadbeef', secret)).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false)
  })
})

describe('buildStatusUpdate — monotonic advancement', () => {
  const ts = new Date('2026-06-28T10:00:00Z')

  it('advances SENT → DELIVERED → READ', () => {
    expect(buildStatusUpdate({ status: 'QUEUED' }, 'sent', ts)).toMatchObject({ status: 'SENT', sentAt: ts })
    expect(buildStatusUpdate({ status: 'SENT' }, 'delivered', ts)).toMatchObject({ status: 'DELIVERED', deliveredAt: ts })
    expect(buildStatusUpdate({ status: 'DELIVERED' }, 'read', ts)).toMatchObject({ status: 'READ', readAt: ts })
  })

  it('does NOT regress: a DELIVERED event after READ keeps status READ but still stamps deliveredAt', () => {
    const update = buildStatusUpdate({ status: 'READ' }, 'delivered', ts)
    expect(update).not.toBeNull()
    expect(update?.deliveredAt).toEqual(ts) // timestamp always stamped
    expect(update?.status).toBeUndefined() // status not moved backward
  })

  it('out-of-order READ before DELIVERED sets status READ and stamps readAt', () => {
    const update = buildStatusUpdate({ status: 'SENT' }, 'read', ts)
    expect(update).toMatchObject({ status: 'READ', readAt: ts })
  })

  it('FAILED is terminal: a later DELIVERED stamps deliveredAt but status stays FAILED', () => {
    expect(buildStatusUpdate({ status: 'SENT' }, 'failed', ts)).toMatchObject({ status: 'FAILED', failedAt: ts })
    const after = buildStatusUpdate({ status: 'FAILED' }, 'delivered', ts)
    expect(after?.deliveredAt).toEqual(ts)
    expect(after?.status).toBeUndefined()
  })

  it('returns null for an unknown status string', () => {
    expect(buildStatusUpdate({ status: 'SENT' }, 'gibberish', ts)).toBeNull()
  })
})

describe('isOptOutMessage', () => {
  it('detects STOP / UNSUBSCRIBE text (case-insensitive)', () => {
    expect(isOptOutMessage({ text: { body: 'STOP' } })).toBe(true)
    expect(isOptOutMessage({ text: { body: ' unsubscribe ' } })).toBe(true)
  })

  it('ignores ordinary inbound text', () => {
    expect(isOptOutMessage({ text: { body: 'where is my order?' } })).toBe(false)
  })

  it('detects the native marketing opt-out button reply', () => {
    expect(isOptOutMessage({ button: { text: 'Stop promotions', payload: 'STOP_PROMOTIONS' } })).toBe(true)
    expect(isOptOutMessage({ interactive: { button_reply: { id: 'opt_out', title: 'Stop promotions' } } })).toBe(true)
  })

  it('detects an explicit marketing_opt_out marker', () => {
    expect(isOptOutMessage({ marketing_opt_out: true })).toBe(true)
  })
})
