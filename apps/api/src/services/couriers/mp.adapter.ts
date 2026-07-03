// apps/api/src/services/couriers/mp.adapter.ts
//
// M&P (Muller & Phipps) tracking adapter (guide §9.2). Pulls tracking + delivery status
// for one consignment number. Credentials (decrypted): { apiKey }. Optional
// config.baseUrl override. M&P returns a checkpoint list under "TrackingResult".
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

const DEFAULT_BASE = 'https://mnpcourier.com/api'

class MpAdapter implements CourierAdapter {
  readonly courier = Courier.MP

  async fetchTracking(trackingNumber: string, ctx: CourierAdapterContext): Promise<CourierFetchResult> {
    const apiKey = typeof ctx.credentials['apiKey'] === 'string' ? (ctx.credentials['apiKey'] as string) : ''
    if (!apiKey) return { configured: false, reason: 'M&P integration missing "apiKey" credential' }

    const base = (typeof ctx.config?.['baseUrl'] === 'string' ? (ctx.config['baseUrl'] as string) : DEFAULT_BASE).replace(/\/$/, '')
    const url = `${base}/tracking`

    let res
    try {
      res = await fetchCourierJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, cn: trackingNumber }),
      })
    } catch (err) {
      if (err instanceof CourierNetworkError) return { configured: true, ok: false, retryable: true, error: err.message }
      throw err
    }
    if (!res.ok) {
      return { configured: true, ok: false, retryable: isRetryableHttp(res.status), error: `M&P HTTP ${res.status}` }
    }

    const root = asRecord(res.body)
    if (!root) return { configured: true, ok: false, retryable: false, error: 'M&P: unexpected response shape' }

    const checkpoints = asArray(root['TrackingResult'] ?? root['trackingResult'] ?? root['result'])
    const events: NormalizedCourierEvent[] = []
    for (const item of checkpoints) {
      const rec = asRecord(item)
      if (!rec) continue
      const rawStatus = pickString(rec, ['Status', 'status'])
      const status = mapCourierStatus(this.courier, rawStatus)
      const occurredAt = parseCourierDate(rec['DateTime'] ?? rec['dateTime'] ?? rec['date'])
      if (!status || !occurredAt) continue
      const ev: NormalizedCourierEvent = { status, occurredAt, raw: rec }
      const externalId = pickString(rec, ['id', 'code'])
      if (externalId) ev.externalId = externalId
      if (rawStatus) ev.description = rawStatus
      events.push(ev)
    }
    if (events.length === 0) return { configured: true, ok: false, retryable: false, error: 'M&P: no recognizable status' }

    const collectedFlag = pickString(root, ['CodPaid', 'codPaid'])
    const codCollected = collectedFlag?.toUpperCase() === 'YES' || collectedFlag === '1'

    const tracking = deriveTracking(events, {
      ...(codCollected !== undefined && { codCollected: !!codCollected }),
      returnReason: pickString(root, ['ReturnReason', 'returnReason']) ?? null,
      raw: res.body,
    })
    if (codCollected && tracking.deliveredAt) tracking.codCollectedAt = tracking.deliveredAt

    return { configured: true, ok: true, tracking }
  }
}

export const mpAdapter = new MpAdapter()
