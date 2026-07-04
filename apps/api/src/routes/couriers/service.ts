// apps/api/src/routes/couriers/service.ts
//
// Courier route business logic. Every query is scoped by merchantId (tenant safety).
// Credentials are never returned to the client — integrations expose only status and
// non-secret config.
import { prisma } from '@engageiq/db'
import { Prisma, ShipmentStatus } from '@prisma/client'
import type { Courier } from '@prisma/client'
import { pollShipment, enqueueSweep } from '../../services/couriers/sync.service.js'
import { registerShipment, type RegisterResult } from '../../services/couriers/ingest.service.js'
import { encryptCredentials, isCredentialKeyConfigured, courierProvider } from '../../services/couriers/credentials.js'
import { isTerminal } from '../../services/couriers/status-map.js'
import type { ListShipmentsQuery, RegisterShipmentBody, UpsertIntegrationBody } from './schema.js'

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string }

// ─── DTOs (dates → ISO, Decimal → number) ────────────────────────────────────
export interface ShipmentListItem {
  id: string
  courier: Courier
  trackingNumber: string | null
  status: ShipmentStatus
  codAmount: number | null
  codCollected: boolean
  customerId: string | null
  orderId: string | null
  codOrderId: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
  returnedAt: string | null
  updatedAt: string
  createdAt: string
}

export interface ShipmentStats {
  total: number
  active: number
  delivered: number
  returned: number
  codCollected: number
}

export interface CourierEventDto {
  id: string
  status: ShipmentStatus
  description: string | null
  externalId: string | null
  occurredAt: string
}

export interface ShipmentDetail extends ShipmentListItem {
  returnReason: string | null
  codCollectedAt: string | null
  events: CourierEventDto[]
}

function toListItem(s: {
  id: string
  courier: Courier
  trackingNumber: string | null
  status: ShipmentStatus
  codAmount: Prisma.Decimal | null
  codCollected: boolean
  customerId: string | null
  orderId: string | null
  codOrderId: string | null
  dispatchedAt: Date | null
  deliveredAt: Date | null
  returnedAt: Date | null
  updatedAt: Date
  createdAt: Date
}): ShipmentListItem {
  return {
    id: s.id,
    courier: s.courier,
    trackingNumber: s.trackingNumber,
    status: s.status,
    codAmount: s.codAmount != null ? s.codAmount.toNumber() : null,
    codCollected: s.codCollected,
    customerId: s.customerId,
    orderId: s.orderId,
    codOrderId: s.codOrderId,
    dispatchedAt: s.dispatchedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    returnedAt: s.returnedAt?.toISOString() ?? null,
    updatedAt: s.updatedAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
  }
}

// ─── Shipments ───────────────────────────────────────────────────────────────
export async function listShipments(
  merchantId: string,
  query: ListShipmentsQuery,
): Promise<{ shipments: ShipmentListItem[]; total: number; stats: ShipmentStats }> {
  const where: Prisma.CourierShipmentWhereInput = {
    merchantId,
    ...(query.status && { status: query.status }),
    ...(query.courier && { courier: query.courier }),
    ...(query.q && { trackingNumber: { contains: query.q, mode: 'insensitive' } }),
  }

  const [rows, total, statusGroups, codCollected] = await Promise.all([
    prisma.courierShipment.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.courierShipment.count({ where }),
    // Stats are merchant-wide (not filtered by the list query), for the header tiles.
    prisma.courierShipment.groupBy({ by: ['status'], where: { merchantId }, _count: true }),
    prisma.courierShipment.count({ where: { merchantId, codCollected: true } }),
  ])

  const byStatus = new Map<ShipmentStatus, number>()
  let statsTotal = 0
  for (const g of statusGroups) {
    byStatus.set(g.status, g._count)
    statsTotal += g._count
  }
  const active = [...byStatus.entries()].reduce((n, [st, c]) => (isTerminal(st) ? n : n + c), 0)

  const stats: ShipmentStats = {
    total: statsTotal,
    active,
    delivered: byStatus.get(ShipmentStatus.DELIVERED) ?? 0,
    returned: byStatus.get(ShipmentStatus.RETURNED) ?? 0,
    codCollected,
  }

  return { shipments: rows.map(toListItem), total, stats }
}

export async function getShipmentDetail(merchantId: string, id: string): Promise<ShipmentDetail | null> {
  const s = await prisma.courierShipment.findFirst({
    where: { id, merchantId },
    include: { events: { orderBy: { occurredAt: 'desc' } } },
  })
  if (!s) return null
  return {
    ...toListItem(s),
    returnReason: s.returnReason,
    codCollectedAt: s.codCollectedAt?.toISOString() ?? null,
    events: s.events.map((e) => ({
      id: e.id,
      status: e.status,
      description: e.description,
      externalId: e.externalId,
      occurredAt: e.occurredAt.toISOString(),
    })),
  }
}

export async function createShipment(
  merchantId: string,
  body: RegisterShipmentBody,
): Promise<RegisterResult> {
  return registerShipment(merchantId, body)
}

// Poll one shipment now (synchronous) for immediate UI feedback.
export async function syncShipmentNow(merchantId: string, id: string): Promise<ServiceResult<{ result: string; detail: ShipmentDetail | null }>> {
  const exists = await prisma.courierShipment.findFirst({ where: { id, merchantId }, select: { id: true } })
  if (!exists) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Shipment not found' }
  const outcome = await pollShipment(merchantId, id)
  const detail = await getShipmentDetail(merchantId, id)
  return { ok: true, data: { result: outcome.result, detail } }
}

export async function triggerMerchantSweep(merchantId: string): Promise<{ enqueued: number }> {
  const enqueued = await enqueueSweep(merchantId)
  return { enqueued }
}

// ─── Integrations (no secrets ever returned) ─────────────────────────────────
export interface IntegrationDto {
  provider: string
  status: string
  isActive: boolean
  hasCredentials: boolean
  config: Record<string, unknown> | null
  connectedAt: string | null
  updatedAt: string
}

export async function listIntegrations(merchantId: string): Promise<{ integrations: IntegrationDto[]; encryptionConfigured: boolean }> {
  const rows = await prisma.merchantIntegration.findMany({
    where: { merchantId, provider: { in: ['POSTEX', 'LEOPARDS', 'TCS', 'MP'] } },
    orderBy: { provider: 'asc' },
  })
  return {
    encryptionConfigured: isCredentialKeyConfigured(),
    integrations: rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      isActive: r.isActive,
      // Presence flag only — the encrypted blob is never decrypted for the client.
      hasCredentials: r.credentials != null && typeof r.credentials === 'object' && 'enc' in (r.credentials as object),
      config: (r.config ?? null) as Record<string, unknown> | null,
      connectedAt: r.connectedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
  }
}

export async function upsertIntegration(
  merchantId: string,
  provider: Courier,
  body: UpsertIntegrationBody,
): Promise<ServiceResult<IntegrationDto>> {
  if (!isCredentialKeyConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'ENCRYPTION_NOT_CONFIGURED',
      message: 'COURIER_CREDENTIALS_KEY is not set; cannot store courier credentials securely',
    }
  }

  const encrypted = encryptCredentials(body.credentials)
  const providerStr = courierProvider(provider)
  const isActive = body.isActive ?? true

  const row = await prisma.merchantIntegration.upsert({
    where: { merchantId_provider: { merchantId, provider: providerStr } },
    create: {
      merchantId,
      provider: providerStr,
      credentials: encrypted,
      config: (body.config ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      status: 'CONNECTED',
      isActive,
      connectedAt: new Date(),
    },
    update: {
      credentials: encrypted,
      ...(body.config !== undefined && { config: body.config as Prisma.InputJsonValue }),
      status: 'CONNECTED',
      isActive,
      connectedAt: new Date(),
    },
  })

  return {
    ok: true,
    data: {
      provider: row.provider,
      status: row.status,
      isActive: row.isActive,
      hasCredentials: true,
      config: (row.config ?? null) as Record<string, unknown> | null,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
  }
}
