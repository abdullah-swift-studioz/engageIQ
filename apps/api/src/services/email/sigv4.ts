// apps/api/src/services/email/sigv4.ts
//
// Minimal AWS Signature V4 signer for the SES v2 JSON API — zero new deps (node:crypto +
// native fetch only, mirroring the Shopify/WhatsApp integrations rather than pulling in
// the AWS SDK). Signs a single POST to email.{region}.amazonaws.com.

import { createHash, createHmac } from 'node:crypto'

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

// e.g. 2026-07-03T10:39:12Z → { amzDate: '20260703T103912Z', dateStamp: '20260703' }
function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const amzDate = `${iso.slice(0, 15)}Z` // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

export interface SignedRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface SignParams {
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  service?: string // default 'ses'
  host?: string // default email.{region}.amazonaws.com
  path?: string // default /v2/email/outbound-emails
  body: string
  now?: Date
}

// Produce the signed URL + headers for an SES v2 SendEmail request.
export function signSesRequest(params: SignParams): SignedRequest {
  const service = params.service ?? 'ses'
  const host = params.host ?? `email.${params.region}.amazonaws.com`
  const path = params.path ?? '/v2/email/outbound-emails'
  const { amzDate, dateStamp } = amzDates(params.now ?? new Date())

  const payloadHash = sha256Hex(params.body)

  // Canonical headers (sorted, lowercase names). Include the session token when present.
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  if (params.sessionToken) baseHeaders['x-amz-security-token'] = params.sessionToken

  const sortedHeaderNames = Object.keys(baseHeaders).sort()
  const canonicalHeaders = sortedHeaderNames.map((h) => `${h}:${baseHeaders[h]}\n`).join('')
  const signedHeaders = sortedHeaderNames.join(';')

  const canonicalRequest = [
    'POST',
    path,
    '', // canonical query string (none)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${params.region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, params.region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url: `https://${host}${path}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      Authorization: authorization,
      ...(params.sessionToken ? { 'X-Amz-Security-Token': params.sessionToken } : {}),
    },
    body: params.body,
  }
}
