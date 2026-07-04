// apps/api/src/services/email/tracking-tokens.ts
//
// Stateless HMAC tokens for one-click unsubscribe links. No new DB column: the token is
// HMAC(merchantId:customerId:email) keyed by JWT_SECRET, verified on the public
// unsubscribe route. Prevents a recipient from unsubscribing an arbitrary address by
// guessing ids while keeping the link stateless.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@engageiq/shared'

function sign(payload: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url')
}

export function makeUnsubscribeToken(merchantId: string, customerId: string, email: string): string {
  return sign(`${merchantId}:${customerId}:${email}`)
}

export function verifyUnsubscribeToken(
  merchantId: string,
  customerId: string,
  email: string,
  token: string,
): boolean {
  const expected = sign(`${merchantId}:${customerId}:${email}`)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
