import { describe, it, expect } from 'vitest'
import { Courier, ShipmentStatus } from '@prisma/client'
import { normalizeCourierString, mapCourierStatus, isTerminal, TERMINAL_STATUSES } from './status-map.js'

describe('normalizeCourierString', () => {
  it('maps known courier names in any casing/punctuation', () => {
    expect(normalizeCourierString('PostEx')).toBe(Courier.POSTEX)
    expect(normalizeCourierString('postex')).toBe(Courier.POSTEX)
    expect(normalizeCourierString('Leopards Courier')).toBe(Courier.LEOPARDS)
    expect(normalizeCourierString('leopard')).toBe(Courier.LEOPARDS)
    expect(normalizeCourierString('TCS')).toBe(Courier.TCS)
    expect(normalizeCourierString('M&P')).toBe(Courier.MP)
    expect(normalizeCourierString('m and p')).toBe(Courier.MP)
    expect(normalizeCourierString('Muller & Phipps')).toBe(Courier.MP)
  })

  it('falls back to OTHER for unknown or empty', () => {
    expect(normalizeCourierString('BlueEx')).toBe(Courier.OTHER)
    expect(normalizeCourierString('')).toBe(Courier.OTHER)
    expect(normalizeCourierString(null)).toBe(Courier.OTHER)
    expect(normalizeCourierString(undefined)).toBe(Courier.OTHER)
  })
})

describe('mapCourierStatus', () => {
  it('maps PostEx statuses via its table', () => {
    expect(mapCourierStatus(Courier.POSTEX, 'Delivered')).toBe(ShipmentStatus.DELIVERED)
    expect(mapCourierStatus(Courier.POSTEX, 'Out For Delivery')).toBe(ShipmentStatus.OUT_FOR_DELIVERY)
    expect(mapCourierStatus(Courier.POSTEX, 'Returned to Sender')).toBe(ShipmentStatus.RETURNED)
    expect(mapCourierStatus(Courier.POSTEX, 'Picked by PostEx')).toBe(ShipmentStatus.DISPATCHED)
  })

  it('maps Leopards statuses', () => {
    expect(mapCourierStatus(Courier.LEOPARDS, 'Consignment Booked')).toBe(ShipmentStatus.CREATED)
    expect(mapCourierStatus(Courier.LEOPARDS, 'Return to Shipper')).toBe(ShipmentStatus.RETURN_IN_TRANSIT)
    expect(mapCourierStatus(Courier.LEOPARDS, 'Delivered')).toBe(ShipmentStatus.DELIVERED)
  })

  it('uses the keyword heuristic for unknown strings', () => {
    expect(mapCourierStatus(Courier.TCS, 'Shipment has been delivered to consignee')).toBe(ShipmentStatus.DELIVERED)
    expect(mapCourierStatus(Courier.MP, 'return in transit to origin')).toBe(ShipmentStatus.RETURN_IN_TRANSIT)
    expect(mapCourierStatus(Courier.POSTEX, 'now in transit')).toBe(ShipmentStatus.IN_TRANSIT)
  })

  it('returns null when nothing matches', () => {
    expect(mapCourierStatus(Courier.POSTEX, 'zxqwv')).toBeNull()
    expect(mapCourierStatus(Courier.POSTEX, '')).toBeNull()
    expect(mapCourierStatus(Courier.POSTEX, null)).toBeNull()
  })
})

describe('isTerminal', () => {
  it('treats delivered/returned/undeliverable/cancelled as terminal', () => {
    for (const s of TERMINAL_STATUSES) expect(isTerminal(s)).toBe(true)
    expect(isTerminal(ShipmentStatus.IN_TRANSIT)).toBe(false)
    expect(isTerminal(ShipmentStatus.OUT_FOR_DELIVERY)).toBe(false)
    expect(isTerminal(ShipmentStatus.ATTEMPTED)).toBe(false)
  })
})
