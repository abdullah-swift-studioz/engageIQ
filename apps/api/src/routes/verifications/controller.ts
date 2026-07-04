import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  ListVerificationsQuerySchema,
  VerificationParamsSchema,
} from './schema.js'
import {
  listVerifications,
  getVerification,
  verificationStats,
  applyVerificationDecision,
} from '../../services/cod-verification/verification.service.js'
import { enqueueStart } from '../../services/cod-verification/queue.js'
import { resolveCodVerificationConfig, channelForAttempt } from '../../services/cod-verification/config.js'
import { prisma } from '@engageiq/db'

function validationError(reply: FastifyReply, error: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: error },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Verification order not found' },
  })
}

export async function listVerificationsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ListVerificationsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listVerifications(request.user.merchantId, parsed.data)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function verificationStatsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const stats = await verificationStats(request.user.merchantId)
  await reply.send({ success: true, data: stats })
}

export async function getVerificationHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = VerificationParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const detail = await getVerification(request.user.merchantId, parsed.data.id)
  if (!detail) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: detail })
}

// POST /:id/start — manually (re)enqueue the verification flow for a COD order. Used for testing and
// for an agent re-triggering a flow. Tenant-scoped: the order must belong to the caller's merchant.
export async function startVerificationHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = VerificationParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const order = await prisma.codOrder.findFirst({ where: { id: parsed.data.id, merchantId } })
  if (!order) {
    await notFound(reply)
    return
  }
  if (order.verificationStatus !== 'PENDING_VERIFICATION') {
    await reply.status(409).send({
      success: false,
      error: {
        code: 'NOT_PENDING',
        message: `Order verification status is ${order.verificationStatus}; only PENDING_VERIFICATION orders can start a flow.`,
      },
    })
    return
  }
  const settings = await prisma.merchantSettings.findUnique({ where: { merchantId } })
  const config = resolveCodVerificationConfig(settings?.codVerification)
  await enqueueStart(merchantId, order.id, channelForAttempt(config, 1), 0)
  await reply.send({ success: true, data: { codOrderId: order.id, enqueued: true } })
}

// POST /:id/confirm and /:id/cancel — manual agent override (e.g. resolving an order held for review).
async function manualDecision(
  request: FastifyRequest,
  reply: FastifyReply,
  decision: 'CONFIRM' | 'CANCEL',
): Promise<void> {
  const parsed = VerificationParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await applyVerificationDecision({
    merchantId: request.user.merchantId,
    codOrderId: parsed.data.id,
    decision,
    response: `manual:${decision.toLowerCase()}`,
  })
  if (result.status === 'noop') {
    // Either the order does not exist for this merchant, or it is already decided.
    const order = await prisma.codOrder.findFirst({
      where: { id: parsed.data.id, merchantId: request.user.merchantId },
      select: { id: true },
    })
    if (!order) {
      await notFound(reply)
      return
    }
    await reply.status(409).send({
      success: false,
      error: { code: 'ALREADY_DECIDED', message: 'Order is no longer pending verification.' },
    })
    return
  }
  await reply.send({ success: true, data: { codOrderId: parsed.data.id, verificationStatus: result.verificationStatus } })
}

export function confirmVerificationHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return manualDecision(request, reply, 'CONFIRM')
}

export function cancelVerificationHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return manualDecision(request, reply, 'CANCEL')
}
