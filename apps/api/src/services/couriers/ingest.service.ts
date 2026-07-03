// apps/api/src/services/couriers/ingest.service.ts
//
// Creating / registering CourierShipment rows. A shipment can be registered directly
// (merchant books with a courier) or derived from a CodOrder — in which case the
// free-text CodOrder.courier string is normalized to the Courier enum (the schema keeps
// CodOrder.courier a String because legacy rows can't be safely enum-converted).
//
// Every write is tenant-scoped; linked order/codOrder/customer ids are verified to belong
// to the merchant before they're attached.
import { prisma } from '@engageiq/db'
import { Prisma, ShipmentStatus } from '@prisma/client'
import type { Courier } from '@prisma/client'
import { normalizeCourierString } from './status-map.js'

export interface RegisterShipmentInput {
  // Either a Courier enum value or a free-text courier name (normalized).
  courier: string
  trackingNumber?: string | null
  orderId?: string | null
  codOrderId?: string | null
  customerId?: string | null
  codAmount?: number | null
  status?: ShipmentStatus
}

export type RegisterResult =
  | { ok: true; shipmentId: string; created: boolean }
  | { ok: false; status: number; code: string; message: string }

// Coerce an input courier (enum value or free string) to the Courier enum.
function toCourierEnum(input: string): Courier {
  return normalizeCourierString(input)
}

// Register (create or upsert-by-tracking) a shipment for a merchant. Idempotent when a
// tracking number is supplied (unique on merchantId+courier+trackingNumber).
export async function registerShipment(merchantId: string, input: RegisterShipmentInput): Promise<RegisterResult> {
  const courier = toCourierEnum(input.courier)

  // Tenant-safety: verify each linked id belongs to this merchant, and inherit the
  // customer from the COD order when not given explicitly.
  let customerId = input.customerId ?? null

  if (input.codOrderId) {
    const codOrder = await prisma.codOrder.findFirst({
      where: { id: input.codOrderId, merchantId },
      select: { id: true, customerId: true },
    })
    if (!codOrder) return { ok: false, status: 404, code: 'COD_ORDER_NOT_FOUND', message: 'COD order not found' }
    if (!customerId) customerId = codOrder.customerId
  }
  if (input.orderId) {
    const order = await prisma.order.findFirst({ where: { id: input.orderId, merchantId }, select: { id: true } })
    if (!order) return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', message: 'Order not found' }
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, merchantId }, select: { id: true } })
    if (!customer) return { ok: false, status: 404, code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' }
  }

  const data = {
    merchantId,
    courier,
    trackingNumber: input.trackingNumber ?? null,
    orderId: input.orderId ?? null,
    codOrderId: input.codOrderId ?? null,
    customerId,
    codAmount: input.codAmount != null ? new Prisma.Decimal(input.codAmount) : null,
    status: input.status ?? ShipmentStatus.CREATED,
  }

  // Upsert on the natural key when a tracking number exists, else create.
  if (input.trackingNumber) {
    const existing = await prisma.courierShipment.findUnique({
      where: {
        merchantId_courier_trackingNumber: { merchantId, courier, trackingNumber: input.trackingNumber },
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.courierShipment.update({
        where: { id: existing.id },
        data: {
          orderId: data.orderId,
          codOrderId: data.codOrderId,
          customerId: data.customerId,
          ...(input.codAmount != null && { codAmount: data.codAmount }),
        },
      })
      return { ok: true, shipmentId: existing.id, created: false }
    }
  }

  const created = await prisma.courierShipment.create({ data, select: { id: true } })
  return { ok: true, shipmentId: created.id, created: true }
}
