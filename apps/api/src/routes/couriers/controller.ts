// apps/api/src/routes/couriers/controller.ts
//
// HTTP layer for courier routes: parse + validate, call the service, shape the standard
// response envelope { success, data, meta? } / { success, error }. Tenant id comes from
// the authenticated JWT (request.user.merchantId).
import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  ListShipmentsQuerySchema,
  ShipmentParamsSchema,
  RegisterShipmentBodySchema,
  IntegrationParamsSchema,
  UpsertIntegrationBodySchema,
} from './schema.js'
import {
  listShipments,
  getShipmentDetail,
  createShipment,
  syncShipmentNow,
  triggerMerchantSweep,
  listIntegrations,
  upsertIntegration,
} from './service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

export async function listShipmentsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ListShipmentsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const { shipments, total, stats } = await listShipments(request.user.merchantId, parsed.data)
  await reply.send({
    success: true,
    data: shipments,
    meta: { page: parsed.data.page, pageSize: parsed.data.pageSize, total, stats },
  })
}

export async function getShipmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ShipmentParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, 'Invalid shipment id')
    return
  }
  const detail = await getShipmentDetail(request.user.merchantId, parsed.data.id)
  if (!detail) {
    await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Shipment not found' } })
    return
  }
  await reply.send({ success: true, data: detail })
}

export async function createShipmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = RegisterShipmentBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await createShipment(request.user.merchantId, parsed.data)
  if (!result.ok) {
    await reply.status(result.status).send({ success: false, error: { code: result.code, message: result.message } })
    return
  }
  await reply.status(result.created ? 201 : 200).send({ success: true, data: { id: result.shipmentId, created: result.created } })
}

export async function syncShipmentHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ShipmentParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, 'Invalid shipment id')
    return
  }
  const result = await syncShipmentNow(request.user.merchantId, parsed.data.id)
  if (!result.ok) {
    await reply.status(result.status).send({ success: false, error: { code: result.code, message: result.message } })
    return
  }
  await reply.send({ success: true, data: result.data })
}

export async function sweepHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const data = await triggerMerchantSweep(request.user.merchantId)
  await reply.status(202).send({ success: true, data })
}

export async function listIntegrationsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const data = await listIntegrations(request.user.merchantId)
  await reply.send({ success: true, data })
}

export async function upsertIntegrationHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = IntegrationParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Unsupported courier provider')
    return
  }
  const body = UpsertIntegrationBodySchema.safeParse(request.body)
  if (!body.success) {
    await validationError(reply, body.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await upsertIntegration(request.user.merchantId, params.data.provider, body.data)
  if (!result.ok) {
    await reply.status(result.status).send({ success: false, error: { code: result.code, message: result.message } })
    return
  }
  await reply.send({ success: true, data: result.data })
}
