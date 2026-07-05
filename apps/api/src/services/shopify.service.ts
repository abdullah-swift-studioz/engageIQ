import crypto from 'crypto'
import { env } from '@engageiq/shared'

const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'customers/create',
  'customers/update',
  'checkouts/create',
  'checkouts/update',
  'products/update',
  'inventory_levels/update',
  'refunds/create',
] as const

export function buildInstallUrl(shop: string, state: string): string {
  // No grant_options[]=per-user → Shopify issues an OFFLINE token (long-lived),
  // so background webhooks and historical backfill keep working after the
  // installing user's session ends.
  const params = new URLSearchParams({
    client_id: String(env.SHOPIFY_API_KEY),
    scope: String(env.SHOPIFY_SCOPES),
    redirect_uri: `${String(env.SHOPIFY_APP_URL)}/shopify/callback`,
    state,
  })
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

export async function exchangeCodeForToken(
  shop: string,
  code: string,
): Promise<{ access_token: string; scope: string }> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: String(env.SHOPIFY_API_KEY),
      client_secret: String(env.SHOPIFY_API_SECRET),
      code,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<{ access_token: string; scope: string }>
}

export async function registerWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string,
): Promise<void> {
  const results = await Promise.allSettled(
    WEBHOOK_TOPICS.map((topic) =>
      fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address: `${appUrl}/shopify/webhooks/${topic.replace('/', '_')}`,
            format: 'json',
          },
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Failed to register webhook ${topic} (${res.status}): ${text}`)
        }
      }),
    ),
  )

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    const messages = failures.map((f) => (f.reason as Error).message).join('; ')
    throw new Error(`Webhook registration partial failure: ${messages}`)
  }
}

export function validateHmac(params: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = params

  if (!hmac) return false

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&')

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex')

  const a = Buffer.from(digest, 'hex')
  const b = Buffer.from(hmac, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function validateWebhookHmac(
  rawBody: Buffer,
  hmacHeader: string,
  secret: string,
): boolean {
  if (!hmacHeader) return false

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')

  const a = Buffer.from(digest)
  const b = Buffer.from(hmacHeader)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
