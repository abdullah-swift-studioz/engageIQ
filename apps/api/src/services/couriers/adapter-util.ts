// apps/api/src/services/couriers/adapter-util.ts
//
// Shared plumbing for the courier adapters: a timeout-guarded JSON fetch and a helper
// that folds normalized checkpoints into a NormalizedTracking snapshot (current status
// + delivered/returned timestamps). Native fetch only — zero new deps, mirroring the
// Shopify/WhatsApp integrations.
import { ShipmentStatus } from '@prisma/client'
import type { NormalizedCourierEvent, NormalizedTracking } from './types.js'

export interface HttpJsonResult {
  ok: boolean
  status: number
  // Parsed JSON body (unknown shape — adapters narrow it defensively).
  body: unknown
}

// A courier API call failed at the transport level (DNS/timeout/reset). Retryable.
export class CourierNetworkError extends Error {}

const DEFAULT_TIMEOUT_MS = 15000

// GET/POST JSON with a hard timeout. Throws CourierNetworkError on transport failure
// (retryable); returns { ok, status, body } for any HTTP response the adapter classifies.
export async function fetchCourierJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HttpJsonResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    throw new CourierNetworkError(err instanceof Error ? err.message : 'network error')
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  return { ok: res.ok, status: res.status, body }
}

// An HTTP status ≥500 or 429 is worth retrying; 4xx (bad creds / not found) is not.
export function isRetryableHttp(status: number): boolean {
  return status === 429 || status >= 500
}

// Fold checkpoints into a snapshot. Current status = the chronologically latest
// checkpoint (couriers append in order). delivered/returned timestamps are lifted from
// the matching checkpoints. Extra COD/return fields are merged from courier-specific data.
export function deriveTracking(
  events: NormalizedCourierEvent[],
  extras: {
    codCollected?: boolean
    codCollectedAt?: Date | null
    returnReason?: string | null
    raw?: unknown
  } = {},
): NormalizedTracking {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const latest = sorted[sorted.length - 1]
  const status = latest ? latest.status : ShipmentStatus.CREATED

  const delivered = [...sorted].reverse().find((e) => e.status === ShipmentStatus.DELIVERED)
  const returned = [...sorted].reverse().find((e) => e.status === ShipmentStatus.RETURNED)

  return {
    status,
    events: sorted,
    deliveredAt: delivered ? delivered.occurredAt : null,
    returnedAt: returned ? returned.occurredAt : null,
    ...(extras.codCollected !== undefined && { codCollected: extras.codCollected }),
    ...(extras.codCollectedAt !== undefined && { codCollectedAt: extras.codCollectedAt }),
    ...(extras.returnReason !== undefined && { returnReason: extras.returnReason }),
    ...(extras.raw !== undefined && { raw: extras.raw }),
  }
}

// Parse a courier date string into a Date, or null if unparseable. Courier feeds use
// varied formats; Date handles ISO + most common ones. Invalid → null (event skipped).
export function parseCourierDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Narrow an unknown JSON value to a plain object (adapters walk courier payloads defensively).
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

// Narrow an unknown JSON value to an array.
export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

// First non-empty string among the given keys of a record (couriers vary field casing).
export function pickString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const val = rec[k]
    if (typeof val === 'string' && val.trim() !== '') return val
    if (typeof val === 'number') return String(val)
  }
  return undefined
}
