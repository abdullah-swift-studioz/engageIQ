// apps/api/src/routes/couriers/schema.ts
//
// Zod input schemas for the courier routes. Providers are constrained to the four
// couriers that have an adapter (integrations for OTHER can't be polled).
import { z } from 'zod'
import { ShipmentStatus, Courier } from '@prisma/client'

export const ListShipmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(ShipmentStatus).optional(),
  courier: z.nativeEnum(Courier).optional(),
  // Free-text search on tracking number.
  q: z.string().trim().min(1).optional(),
})
export type ListShipmentsQuery = z.infer<typeof ListShipmentsQuerySchema>

export const ShipmentParamsSchema = z.object({ id: z.string().min(1) })

export const RegisterShipmentBodySchema = z.object({
  // A Courier enum value or a free-text courier name (normalized server-side).
  courier: z.string().min(1),
  trackingNumber: z.string().trim().min(1).optional(),
  orderId: z.string().min(1).optional(),
  codOrderId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  codAmount: z.number().nonnegative().optional(),
  status: z.nativeEnum(ShipmentStatus).optional(),
})
export type RegisterShipmentBody = z.infer<typeof RegisterShipmentBodySchema>

// Only the four adapter-backed couriers can hold a pollable integration.
const SUPPORTED_PROVIDERS = [Courier.POSTEX, Courier.LEOPARDS, Courier.TCS, Courier.MP] as const
export const IntegrationParamsSchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS),
})

export const UpsertIntegrationBodySchema = z.object({
  // Secret credentials (encrypted at rest before storage). Shape varies per courier,
  // e.g. PostEx { token }, Leopards { apiKey, apiPassword }, TCS { clientId, apiKey? }.
  credentials: z.record(z.string(), z.unknown()),
  // Non-secret config (e.g. { baseUrl }).
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
})
export type UpsertIntegrationBody = z.infer<typeof UpsertIntegrationBodySchema>
