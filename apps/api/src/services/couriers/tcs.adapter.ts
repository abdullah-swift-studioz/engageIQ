// apps/api/src/services/couriers/tcs.adapter.ts
//
// TCS tracking adapter (guide §9.2). Pulls tracking + status for one consignment.
// Credentials (decrypted): { clientId, apiKey? } — TCS gates its API on an IBM client
// id header (and optionally a username/password). Optional config.baseUrl override.
import { Courier } from '@prisma/client'
import type { CourierAdapter, CourierAdapterContext, CourierFetchResult, NormalizedCourierEvent } from './types.js'
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

const DEFAULT_BASE = 'https://api.tcscourier.com/production/v1'

class TcsAdapter implements CourierAdapter {
  readonly courier = Courier.TCS

  async fetchTracking(trackingNumber: string, ctx: CourierAdapterContext): Promise<CourierFetchResult> {
    const clientId = typeof ctx.credentials['clientId'] === 'string' ? (ctx.credentials['clientId'] as string) : ''
    if (!clientId) return { configured: false, reason: 'TCS integration missing "clientId" credential' }

    const base = (typeof ctx.config?.['baseUrl'] === 'string' ? (ctx.config['baseUrl'] as string) : DEFAULT_BASE).replace(/\/$/, '')
    const url = `${base}/track/cn/${encodeURIComponent(trackingNumber)}`
    const headers: Record<string, string> = { 'X-IBM-Client-Id': clientId, 'Content-Type': 'application/json' }
    if (typeof ctx.credentials['apiKey'] === 'string') headers['X-IBM-Client-Secret'] = ctx.credentials['apiKey'] as string

    let res
    try {
      res = await fetchCourierJson(url, { method: 'GET', headers })
    } catch (err) {
      if (err instanceof CourierNetworkError) return { configured: true, ok: false, retryable: true, error: err.message }
      throw err
    }
    if (!res.ok) {
      return { configured: true, ok: false, retryable: isRetryableHttp(res.status), error: `TCS HTTP ${res.status}` }
    }

    const root = asRecord(res.body)
    if (!root) return { configured: true, ok: false, retryable: false, error: 'TCS: unexpected response shape' }
    const returnStatus = asRecord(root['returnStatus'])
    if (returnStatus && String(returnStatus['status']).toLowerCase() === 'failure') {
      const msg = pickString(returnStatus, ['message', 'messageDetail']) ?? 'request failed'
      return { configured: true, ok: false, retryable: false, error: `TCS: ${msg}` }
    }

    const checkpoints = asArray(root['TransactionStatus'] ?? root['transactionStatus'])
    const events: NormalizedCourierEvent[] = []
    for (const item of checkpoints) {
      const rec = asRecord(item)
      if (!rec) continue
      const rawStatus = pickString(rec, ['status', 'Status'])
      const status = mapCourierStatus(this.courier, rawStatus)
      const occurredAt = parseCourierDate(rec['dateTime'] ?? rec['DateTime'] ?? rec['date'])
      if (!status || !occurredAt) continue
      const ev: NormalizedCourierEvent = { status, occurredAt, raw: rec }
      const externalId = pickString(rec, ['statusCode', 'code'])
      if (externalId) ev.externalId = externalId
      if (rawStatus) ev.description = rawStatus
      events.push(ev)
    }
    if (events.length === 0) return { configured: true, ok: false, retryable: false, error: 'TCS: no recognizable status' }

    const tracking = deriveTracking(events, {
      returnReason: pickString(root, ['returnReason', 'reason']) ?? null,
      raw: res.body,
    })
    return { configured: true, ok: true, tracking }
  }
}

export const tcsAdapter = new TcsAdapter()
