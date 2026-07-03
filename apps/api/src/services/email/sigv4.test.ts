import { describe, it, expect } from 'vitest'
import { signSesRequest } from './sigv4.js'

const CREDS = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}
const NOW = new Date('2026-07-03T10:39:12.000Z')

describe('signSesRequest', () => {
  it('builds the SES v2 endpoint URL for the region', () => {
    const s = signSesRequest({ ...CREDS, body: '{}', now: NOW })
    expect(s.url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails')
  })

  it('produces a well-formed SigV4 Authorization header', () => {
    const s = signSesRequest({ ...CREDS, body: '{"a":1}', now: NOW })
    const auth = s.headers.Authorization
    expect(auth).toContain(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260703/us-east-1/ses/aws4_request',
    )
    expect(auth).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date')
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(s.headers['X-Amz-Date']).toBe('20260703T103912Z')
  })

  it('is deterministic for the same inputs and changes with the body', () => {
    const a = signSesRequest({ ...CREDS, body: '{"a":1}', now: NOW }).headers.Authorization
    const b = signSesRequest({ ...CREDS, body: '{"a":1}', now: NOW }).headers.Authorization
    const c = signSesRequest({ ...CREDS, body: '{"a":2}', now: NOW }).headers.Authorization
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('includes the session token header when a temporary credential is used', () => {
    const s = signSesRequest({ ...CREDS, sessionToken: 'FQoGZ...', body: '{}', now: NOW })
    expect(s.headers['X-Amz-Security-Token']).toBe('FQoGZ...')
    expect(s.headers.Authorization).toContain('x-amz-security-token')
  })
})
