// apps/api/src/services/couriers/leopards.adapter.ts
//
// Leopards Courier tracking adapter (guide §9.2). Pulls tracking, delivery confirmation
// and return data. Credentials (decrypted): { apiKey, apiPassword }. Optional
// config.baseUrl override. Leopards' trackBookedPacket returns a packet list with a
// nested "Tracking Detail" checkpoint array.
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

const DEFAULT_BASE = 'https://merchantapi.leopardscourier.com/api'

class LeopardsAdapter implements CourierAdapter {
  readonly courier = Courier.LEOPARDS

  async fetchTracking(trackingNumber: string, ctx: CourierAdapterContext): Promise<CourierFetchResult> {
    const apiKey = typeof ctx.credentials['apiKey'] === 'string' ? (ctx.credentials['apiKey'] as string) : ''
    const apiPassword = typeof ctx.credentials['apiPassword'] === 'string' ? (ctx.credentials['apiPassword'] as string) : ''
    if (!apiKey || !apiPassword) {
      return { configured: false, reason: 'Leopards integration missing "apiKey"/"apiPassword" credentials' }
    }

    const base = (typeof ctx.config?.['baseUrl'] === 'string' ? (ctx.config['baseUrl'] as string) : DEFAULT_BASE).replace(/\/$/, '')
    const url = `${base}/trackBookedPacket/format/json/`

    let res
    try {
      res = await fetchCourierJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, api_password: apiPassword, track_numbers: trackingNumber }),
      })
    } catch (err) {
      if (err instanceof CourierNetworkError) return { configured: true, ok: false, retryable: true, error: err.message }
      throw err
    }
    if (!res.ok) {
      return { configured: true, ok: false, retryable: isRetryableHttp(res.status), error: `Leopards HTTP ${res.status}` }
    }

    const root = asRecord(res.body)
    if (!root) return { configured: true, ok: false, retryable: false, error: 'Leopards: unexpected response shape' }
    // status 0 with an error message = bad creds / not found (permanent).
    if (root['status'] === 0 || root['status'] === '0') {
      const msg = pickString(root, ['error_msg', 'message']) ?? 'request rejected'
      return { configured: true, ok: false, retryable: false, error: `Leopards: ${msg}` }
    }

    const packets = asArray(root['packet_list'])
    const packet = asRecord(packets[0])
    if (!packet) return { configured: true, ok: false, retryable: false, error: 'Leopards: empty packet list' }

    const events: NormalizedCourierEvent[] = []
    for (const item of asArray(packet['Tracking Detail'])) {
      const rec = asRecord(item)
      if (!rec) continue
      const rawStatus = pickString(rec, ['Status', 'status'])
      const status = mapCourierStatus(this.courier, rawStatus)
      const occurredAt = parseCourierDate(rec['Activity_datetime'] ?? rec['activity_datetime'] ?? rec['datetime'])
      if (!status || !occurredAt) continue
      const ev: NormalizedCourierEvent = { status, occurredAt, raw: rec }
      const externalId = pickString(rec, ['id', 'detail_id'])
      if (externalId) ev.externalId = externalId
      if (rawStatus) ev.description = rawStatus
      events.push(ev)
    }

    // Fall back to the packet-level status when no detail rows are present.
    if (events.length === 0) {
      const rawStatus = pickString(packet, ['booked_packet_status', 'status'])
      const status = mapCourierStatus(this.courier, rawStatus)
      if (status) {
        const occurredAt = parseCourierDate(packet['booking_date'] ?? packet['updated_at']) ?? new Date(0)
        const ev: NormalizedCourierEvent = { status, occurredAt, raw: packet }
        if (rawStatus) ev.description = rawStatus
        events.push(ev)
      }
    }
    if (events.length === 0) return { configured: true, ok: false, retryable: false, error: 'Leopards: no recognizable status' }

    // COD collected once the packet is delivered and the amount is marked received.
    const collectedFlag = pickString(packet, ['is_received_amount', 'amount_received_status'])
    const codCollected = collectedFlag === '1' || collectedFlag?.toUpperCase() === 'YES'

    const tracking = deriveTracking(events, {
      ...(codCollected !== undefined && { codCollected: !!codCollected }),
      returnReason: pickString(packet, ['return_reason', 'reason']) ?? null,
      raw: res.body,
    })
    if (codCollected && tracking.deliveredAt) tracking.codCollectedAt = tracking.deliveredAt

    return { configured: true, ok: true, tracking }
  }
}

export const leopardsAdapter = new LeopardsAdapter()
