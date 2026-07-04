// apps/api/src/services/couriers/status-map.ts
//
// Two normalizations every courier adapter shares:
//   1. normalizeCourierString — a free-text courier name (CodOrder.courier is a String
//      by design; existing rows can't be safely enum-converted) → the Courier enum.
//   2. mapCourierStatus — a courier's own status vocabulary → the ShipmentStatus enum.
//
// The status tables below are best-effort mappings of each courier's documented status
// vocabulary. Unknown strings fall through to a keyword heuristic and finally to null
// (the caller keeps the shipment's current status rather than guessing).
import { Courier, ShipmentStatus } from '@prisma/client'

const S = ShipmentStatus

// ─── Courier name (free string) → Courier enum ───────────────────────────────
export function normalizeCourierString(raw: string | null | undefined): Courier {
  if (!raw) return Courier.OTHER
  // Collapse to uppercase alphanumerics so "M&P", "m and p", "Leopards Courier" all match.
  const k = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (k.includes('POSTEX')) return Courier.POSTEX
  if (k.includes('LEOPARD')) return Courier.LEOPARDS
  if (k === 'TCS' || k.includes('TCS')) return Courier.TCS
  // M&P (Muller & Phipps): "MP", "MANDP", "MULLERPHIPPS", "MULLER".
  if (k === 'MP' || k === 'MANDP' || k.includes('MULLER') || k.includes('PHIPPS')) return Courier.MP
  return Courier.OTHER
}

// ─── Per-courier raw status → ShipmentStatus ─────────────────────────────────
// Keys are matched after the same uppercase-alphanumeric collapse as above, so table
// keys are written in that normalized form.
type StatusTable = Record<string, ShipmentStatus>

const POSTEX_MAP: StatusTable = {
  UNBOOKED: S.CREATED,
  BOOKED: S.CREATED,
  ORDERBOOKED: S.CREATED,
  PICKEDBYPOSTEX: S.DISPATCHED,
  PICKEDUP: S.DISPATCHED,
  ENROUTETOWAREHOUSE: S.IN_TRANSIT,
  ARRIVEDATWAREHOUSE: S.IN_TRANSIT,
  INTRANSIT: S.IN_TRANSIT,
  OUTFORDELIVERY: S.OUT_FOR_DELIVERY,
  DELIVERYUNDERREVIEW: S.ATTEMPTED,
  ATTEMPTED: S.ATTEMPTED,
  DELIVERED: S.DELIVERED,
  RETURNINTRANSIT: S.RETURN_IN_TRANSIT,
  ENROUTETORETURN: S.RETURN_IN_TRANSIT,
  RETURNED: S.RETURNED,
  RETURNEDTOSENDER: S.RETURNED,
  UNDELIVERED: S.UNDELIVERABLE,
  EXPIRED: S.UNDELIVERABLE,
  CANCELLED: S.CANCELLED,
}

const LEOPARDS_MAP: StatusTable = {
  CONSIGNMENTBOOKED: S.CREATED,
  BOOKED: S.CREATED,
  SHIPMENTPICKED: S.DISPATCHED,
  PICKED: S.DISPATCHED,
  ARRIVEDATSTATION: S.IN_TRANSIT,
  DEPARTEDFROMSTATION: S.IN_TRANSIT,
  INTRANSIT: S.IN_TRANSIT,
  ASSIGNEDTOCOURIER: S.OUT_FOR_DELIVERY,
  OUTFORDELIVERY: S.OUT_FOR_DELIVERY,
  DELIVERYATTEMPTED: S.ATTEMPTED,
  ATTEMPTED: S.ATTEMPTED,
  DELIVERED: S.DELIVERED,
  RETURNTOSHIPPER: S.RETURN_IN_TRANSIT,
  RETURNINTRANSIT: S.RETURN_IN_TRANSIT,
  RETURNED: S.RETURNED,
  RETURNEDTOSHIPPER: S.RETURNED,
  UNDELIVERED: S.UNDELIVERABLE,
  CANCELLED: S.CANCELLED,
}

const TCS_MAP: StatusTable = {
  BOOKED: S.CREATED,
  SHIPMENTBOOKED: S.CREATED,
  PICKEDUP: S.DISPATCHED,
  INTRANSIT: S.IN_TRANSIT,
  ARRIVEDATFACILITY: S.IN_TRANSIT,
  OUTFORDELIVERY: S.OUT_FOR_DELIVERY,
  DELIVERYATTEMPTED: S.ATTEMPTED,
  ATTEMPTED: S.ATTEMPTED,
  DELIVERED: S.DELIVERED,
  RETURNTOORIGIN: S.RETURN_IN_TRANSIT,
  RETURNINTRANSIT: S.RETURN_IN_TRANSIT,
  RETURNED: S.RETURNED,
  UNDELIVERED: S.UNDELIVERABLE,
  CANCELLED: S.CANCELLED,
}

const MP_MAP: StatusTable = {
  BOOKED: S.CREATED,
  PICKEDUP: S.DISPATCHED,
  INTRANSIT: S.IN_TRANSIT,
  OUTFORDELIVERY: S.OUT_FOR_DELIVERY,
  ATTEMPTED: S.ATTEMPTED,
  DELIVERED: S.DELIVERED,
  RETURNINTRANSIT: S.RETURN_IN_TRANSIT,
  RETURNED: S.RETURNED,
  UNDELIVERED: S.UNDELIVERABLE,
  CANCELLED: S.CANCELLED,
}

const TABLES: Record<Courier, StatusTable> = {
  [Courier.POSTEX]: POSTEX_MAP,
  [Courier.LEOPARDS]: LEOPARDS_MAP,
  [Courier.TCS]: TCS_MAP,
  [Courier.MP]: MP_MAP,
  [Courier.OTHER]: {},
}

// Last-resort keyword heuristic when a courier emits a status not in its table.
function heuristic(k: string): ShipmentStatus | null {
  if (k.includes('DELIVERED')) return S.DELIVERED
  if (k.includes('OUTFORDELIVERY')) return S.OUT_FOR_DELIVERY
  if (k.includes('RETURN') && k.includes('TRANSIT')) return S.RETURN_IN_TRANSIT
  if (k.includes('RETURN')) return S.RETURNED
  if (k.includes('ATTEMPT')) return S.ATTEMPTED
  if (k.includes('TRANSIT')) return S.IN_TRANSIT
  if (k.includes('PICK') || k.includes('DISPATCH')) return S.DISPATCHED
  if (k.includes('UNDELIVER')) return S.UNDELIVERABLE
  if (k.includes('CANCEL')) return S.CANCELLED
  if (k.includes('BOOK')) return S.CREATED
  return null
}

// Map a raw courier status string to ShipmentStatus. Returns null when nothing matches
// (the caller then leaves the shipment's current status unchanged).
export function mapCourierStatus(courier: Courier, rawStatus: string | null | undefined): ShipmentStatus | null {
  if (!rawStatus) return null
  const k = rawStatus.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const table = TABLES[courier] ?? {}
  return table[k] ?? heuristic(k)
}

// Terminal statuses: a shipment here is settled and the poller stops sweeping it.
export const TERMINAL_STATUSES: readonly ShipmentStatus[] = [
  S.DELIVERED,
  S.RETURNED,
  S.UNDELIVERABLE,
  S.CANCELLED,
]

export function isTerminal(status: ShipmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
