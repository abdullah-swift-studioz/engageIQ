// apps/api/src/services/couriers/postex.adapter.ts
//
// PostEx tracking adapter (guide §9.2). Pulls delivery status + COD collection for one
// tracking number from the PostEx merchant API and normalizes it. Credentials
// (MerchantIntegration.credentials → decrypted): { token }. Optional config.baseUrl
// overrides the default host.
import { Courier } from '@prisma/client'
import type { CourierAdapter, CourierAdapterContext, CourierFetchResult } from './types.js'
import { mapCourierStatus } from './status-map.js'
import {
  fetchCourierJson,
  isRetryableHttp,
  deriveTracking,
  parseCourierDate,
  asRecord,
  asArray,
  pickString,
  CourierNetworkError,
} from './adapter-util.js'
import type { NormalizedCourierEvent } from './types.js'

const DEFAULT_BASE = 'https://api.postex.pk'

class PostExAdapter implements CourierAdapter {
  readonly courier = Courier.POSTEX

  async fetchTracking(trackingNumber: string, ctx: CourierAdapterContext): Promise<CourierFetchResult> {
    const token = typeof ctx.credentials['token'] === 'string' ? (ctx.credentials['token'] as string) : ''
    if (!token) return { configured: false, reason: 'PostEx integration missing "token" credential' }

    const base = (typeof ctx.config?.['baseUrl'] === 'string' ? (ctx.config['baseUrl'] as string) : DEFAULT_BASE).replace(/\/$/, '')
    const url = `${base}/services/integration/api/order/v1/track-order/${encodeURIComponent(trackingNumber)}`

    let res
    try {
      res = await fetchCourierJson(url, { method: 'GET', headers: { token, 'Content-Type': 'application/json' } })
    } catch (err) {
      if (err instanceof CourierNetworkError) return { configured: true, ok: false, retryable: true, error: err.message }
      throw err
    }
    if (!res.ok) {
      return { configured: true, ok: false, retryable: isRetryableHttp(res.status), error: `PostEx HTTP ${res.status}` }
    }

    const root = asRecord(res.body)
    const dist = asRecord(root?.['dist']) ?? root
    if (!dist) return { configured: true, ok: false, retryable: false, error: 'PostEx: unexpected response shape' }

    // Status history: prefer an explicit history array; fall back to the single current status.
    const history = asArray(dist['transactionStatusHistory'])
    const events: NormalizedCourierEvent[] = []
    for (const item of history) {
      const rec = asRecord(item)
      if (!rec) continue
      const rawStatus = pickString(rec, ['transactionStatusMessage', 'transactionStatus', 'status'])
      const status = mapCourierStatus(this.courier, rawStatus)
      const occurredAt = parseCourierDate(rec['modifiedDatetime'] ?? rec['updatedDatetime'] ?? rec['transactionDate'])
      if (!status || !occurredAt) continue
      const ev: NormalizedCourierEvent = { status, occurredAt, raw: rec }
      const externalId = pickString(rec, ['transactionStatusMessageCode', 'statusCode'])
      if (externalId) ev.externalId = externalId
      if (rawStatus) ev.description = rawStatus
      events.push(ev)
    }

    // If no history, synthesize a single checkpoint from the current status.
    if (events.length === 0) {
      const rawStatus = pickString(dist, ['transactionStatusMessage', 'orderStatus', 'status'])
      const status = mapCourierStatus(this.courier, rawStatus)
      const occurredAt = parseCourierDate(dist['orderStatusDatetime'] ?? dist['transactionDate']) ?? new Date(0)
      if (status) {
        const ev: NormalizedCourierEvent = { status, occurredAt, raw: dist }
        if (rawStatus) ev.description = rawStatus
        events.push(ev)
      }
    }
    if (events.length === 0) return { configured: true, ok: false, retryable: false, error: 'PostEx: no recognizable status' }

    // COD collection: PostEx marks the invoice as paid once cash is collected.
    const invoicePayment = dist['invoicePayment']
    const codCollected =
      typeof invoicePayment === 'string'
        ? invoicePayment.toUpperCase() === 'PAID'
        : dist['isCodPaid'] === true

    const tracking = deriveTracking(events, {
      codCollected,
      returnReason: pickString(dist, ['reversalReason', 'returnReason']) ?? null,
      raw: res.body,
    })
    // COD is collected at delivery — stamp the delivery time when marked paid.
    if (codCollected && tracking.deliveredAt) tracking.codCollectedAt = tracking.deliveredAt

    return { configured: true, ok: true, tracking }
  }
}

export const postexAdapter = new PostExAdapter()
