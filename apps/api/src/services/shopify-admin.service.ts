import type { ShopifyCustomerPayload, ShopifyOrderPayload } from '@engageiq/shared'

const API_VERSION = '2024-01'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  // Shopify Link header: <https://...?page_info=XYZ&limit=250>; rel="next"
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

interface ShopifyGetResult {
  data: unknown
  nextPageInfo: string | null
  callLimitUsed: number
  callLimitMax: number
}

async function shopifyGet(url: string, accessToken: string): Promise<ShopifyGetResult> {
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken, Accept: 'application/json' },
  })

  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('Retry-After') ?? '2')
    await sleep(retryAfter * 1000)
    return shopifyGet(url, accessToken)
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const linkHeader = res.headers.get('Link')
  const callLimitStr = res.headers.get('X-Shopify-Shop-Api-Call-Limit') ?? '1/40'
  const callLimitParts = callLimitStr.split('/')
  const callLimitUsed = parseInt(callLimitParts[0] ?? '1', 10)
  const callLimitMax = parseInt(callLimitParts[1] ?? '40', 10)
  const nextPageInfo = parseNextPageInfo(linkHeader)

  return { data, nextPageInfo, callLimitUsed, callLimitMax }
}

// Slow down when the leaky bucket is 80%+ full to avoid 429s
async function throttleIfNeeded(used: number, max: number): Promise<void> {
  if (used >= Math.floor(max * 0.8)) {
    await sleep(500)
  }
}

// ─── Count endpoints ──────────────────────────────────────────────────────────

export async function fetchCustomerCount(shop: string, accessToken: string): Promise<number> {
  const url = `https://${shop}/admin/api/${API_VERSION}/customers/count.json`
  const { data } = await shopifyGet(url, accessToken)
  return (data as { count: number }).count
}

export async function fetchOrderCount(
  shop: string,
  accessToken: string,
  createdAtMin: string,
): Promise<number> {
  const params = new URLSearchParams({ status: 'any', created_at_min: createdAtMin })
  const url = `https://${shop}/admin/api/${API_VERSION}/orders/count.json?${params.toString()}`
  const { data } = await shopifyGet(url, accessToken)
  return (data as { count: number }).count
}

// ─── Paginated fetch ──────────────────────────────────────────────────────────

export async function fetchAllCustomers(
  shop: string,
  accessToken: string,
  onPage: (customers: ShopifyCustomerPayload[]) => Promise<void>,
): Promise<void> {
  let url = `https://${shop}/admin/api/${API_VERSION}/customers.json?limit=250`
  let pageInfo: string | null = null

  while (true) {
    const { data, nextPageInfo, callLimitUsed, callLimitMax } = await shopifyGet(url, accessToken)
    const customers = (data as { customers: ShopifyCustomerPayload[] }).customers ?? []

    if (customers.length > 0) {
      await onPage(customers)
    }

    await throttleIfNeeded(callLimitUsed, callLimitMax)

    if (!nextPageInfo) break
    pageInfo = nextPageInfo
    url = `https://${shop}/admin/api/${API_VERSION}/customers.json?limit=250&page_info=${pageInfo}`
  }
}

export async function fetchAllOrders(
  shop: string,
  accessToken: string,
  createdAtMin: string,
  onPage: (orders: ShopifyOrderPayload[]) => Promise<void>,
): Promise<void> {
  const firstParams = new URLSearchParams({
    limit: '250',
    status: 'any',
    created_at_min: createdAtMin,
  })
  let url = `https://${shop}/admin/api/${API_VERSION}/orders.json?${firstParams.toString()}`
  let pageInfo: string | null = null

  while (true) {
    const { data, nextPageInfo, callLimitUsed, callLimitMax } = await shopifyGet(url, accessToken)
    const orders = (data as { orders: ShopifyOrderPayload[] }).orders ?? []

    if (orders.length > 0) {
      await onPage(orders)
    }

    await throttleIfNeeded(callLimitUsed, callLimitMax)

    if (!nextPageInfo) break
    pageInfo = nextPageInfo
    url = `https://${shop}/admin/api/${API_VERSION}/orders.json?limit=250&page_info=${pageInfo}`
  }
}
