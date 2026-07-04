// apps/api/src/services/couriers/types.ts
//
// The courier provider abstraction (roadmap 8.1 / guide §9.2). One CourierAdapter
// per Pakistani courier (PostEx, Leopards, TCS, M&P) pulls a shipment's latest
// delivery status, COD collection, and return data and NORMALIZES it into the shapes
// below — so the sync engine, the CourierShipment/CourierEvent rows, and the
// downstream COD-rate / journey-trigger logic never see courier-specific payloads.
//
// Credentials come per-merchant from MerchantIntegration.credentials (encrypted at
// rest). When a merchant has no integration or the app has no decryption key, the
// adapter is never called — the sync layer short-circuits with a clear status.
import type { Courier, ShipmentStatus } from '@prisma/client'

// A single normalized tracking checkpoint pulled from a courier.
export interface NormalizedCourierEvent {
  status: ShipmentStatus
  // Human-readable courier status text ("Delivered to consignee", "Return in transit"…).
  description?: string
  // The courier's own event/checkpoint id, used to dedup on repeated polls. Absent
  // when the courier doesn't expose one (then the sync layer dedups by status+time).
  externalId?: string
  occurredAt: Date
  // The raw per-event payload, retained for audit on CourierEvent.raw.
  raw?: unknown
}

// The normalized snapshot of ONE shipment after a poll.
export interface NormalizedTracking {
  // The current/latest derived status (drives CourierShipment.status).
  status: ShipmentStatus
  // Chronological checkpoints. Appended to CourierEvent (deduped).
  events: NormalizedCourierEvent[]
  codCollected?: boolean
  codCollectedAt?: Date | null
  deliveredAt?: Date | null
  returnedAt?: Date | null
  returnReason?: string | null
  // Last raw courier payload, stored on CourierShipment.rawTracking for audit.
  raw?: unknown
}

// Decrypted per-merchant credentials + non-secret config for one courier integration.
export interface CourierAdapterContext {
  credentials: Record<string, unknown>
  config: Record<string, unknown> | null
}

// Adapter outcomes are a closed union so the caller (sync engine) decides retry vs
// skip vs apply without throwing across the boundary:
//   - not-configured  → the merchant has no usable creds; no-op, surfaced as a status.
//   - ok              → apply the normalized tracking.
//   - failed          → a real fetch/parse failure; `retryable` tells the worker
//                        whether to throw (BullMQ retry) or record and move on.
export type CourierFetchResult =
  | { configured: false; reason: string }
  | { configured: true; ok: true; tracking: NormalizedTracking }
  | { configured: true; ok: false; retryable: boolean; error: string }

export interface CourierAdapter {
  // The Prisma Courier enum value this adapter serves.
  readonly courier: Courier
  // Pull + normalize one shipment's latest tracking. Never throws for expected
  // courier/HTTP errors — always returns a typed CourierFetchResult.
  fetchTracking(trackingNumber: string, ctx: CourierAdapterContext): Promise<CourierFetchResult>
}
