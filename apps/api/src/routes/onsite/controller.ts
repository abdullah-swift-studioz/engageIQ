import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@engageiq/db'
import {
  CreateElementBodySchema,
  UpdateElementBodySchema,
  ElementParamsSchema,
  ListElementsQuerySchema,
  CreateAbTestBodySchema,
  AbTestParamsSchema,
  DecideAbTestBodySchema,
  DeliveryBodySchema,
} from './schema.js'
import {
  createElement,
  listElements,
  getElementDetail,
  updateElement,
  deleteElement,
  createAbTest,
  stopAbTest,
  decideAbTest,
  type ServiceResult,
} from './service.js'
import { selectElementsForVisitor } from '../../services/onsite/targeting.service.js'
import { getElementStats } from '../../services/onsite/stats.service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

async function sendServiceError(
  reply: FastifyReply,
  result: Extract<ServiceResult<unknown>, { ok: false }>,
) {
  await reply.status(result.status).send({
    success: false,
    error: { code: result.code, message: result.message },
  })
}

// ─── Element CRUD ─────────────────────────────────────────────────────────────

export async function createElementHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = CreateElementBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const element = await createElement(request.user.merchantId, parsed.data)
  await reply.status(201).send({ success: true, data: element })
}

export async function listElementsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ListElementsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const { page, pageSize, status, type } = parsed.data
  const result = await listElements(request.user.merchantId, page, pageSize, status, type)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getElementHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = ElementParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element ID')
    return
  }
  const element = await getElementDetail(request.user.merchantId, params.data.id)
  if (!element) {
    await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'On-site element not found' } })
    return
  }
  await reply.send({ success: true, data: element })
}

export async function updateElementHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = ElementParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element ID')
    return
  }
  const parsed = UpdateElementBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await updateElement(request.user.merchantId, params.data.id, parsed.data)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.send({ success: true, data: result.data })
}

export async function deleteElementHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = ElementParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element ID')
    return
  }
  const result = await deleteElement(request.user.merchantId, params.data.id)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.status(204).send()
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function elementStatsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = ElementParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element ID')
    return
  }
  const merchantId = request.user.merchantId
  // Confirm ownership before querying event stats.
  const element = await prisma.onSiteElement.findFirst({
    where: { id: params.data.id, merchantId },
    select: { id: true },
  })
  if (!element) {
    await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'On-site element not found' } })
    return
  }
  const stats = await getElementStats(merchantId, params.data.id)
  await reply.send({ success: true, data: stats })
}

// ─── A/B test ─────────────────────────────────────────────────────────────────

export async function createAbTestHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = ElementParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element ID')
    return
  }
  const parsed = CreateAbTestBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await createAbTest(request.user.merchantId, params.data.id, parsed.data)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.status(201).send({ success: true, data: result.data })
}

export async function stopAbTestHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = AbTestParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element or test ID')
    return
  }
  const result = await stopAbTest(request.user.merchantId, params.data.id, params.data.testId)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.send({ success: true, data: result.data })
}

export async function decideAbTestHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = AbTestParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid element or test ID')
    return
  }
  const parsed = DecideAbTestBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await decideAbTest(
    request.user.merchantId,
    params.data.id,
    params.data.testId,
    parsed.data.winnerVariantId,
  )
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.send({ success: true, data: result.data })
}

// ─── Public delivery (unauthenticated) ────────────────────────────────────────

export async function deliverHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = DeliveryBodySchema.safeParse(request.body)
  if (!parsed.success) {
    return void reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery request' } })
  }
  const ctx = parsed.data

  // Verify the merchant exists; return an empty set (not an error) for unknown
  // ids so we don't fingerprint valid merchant ids from the public storefront.
  const merchant = await prisma.merchant.findUnique({
    where: { id: ctx.merchantId },
    select: { id: true },
  })
  if (!merchant) {
    return void reply.send({ success: true, data: { elements: [] } })
  }

  const elements = await selectElementsForVisitor(ctx.merchantId, ctx)
  return void reply.send({ success: true, data: { elements } })
}
