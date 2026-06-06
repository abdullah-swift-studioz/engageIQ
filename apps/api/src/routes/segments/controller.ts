import type { FastifyRequest, FastifyReply } from 'fastify'
import { segmentEvaluateQueue } from '@engageiq/queue'
import { SEGMENT_EVALUATE } from '@engageiq/shared'
import type { SegmentEvaluateJobPayload } from '@engageiq/shared'
import { validateConditionTree } from '../../lib/segments/condition-validator.js'
import { compileToPrismaWhere } from '../../services/segment-evaluator.js'
import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { SegmentGroup } from '@engageiq/shared'
import {
  CreateSegmentBodySchema,
  UpdateSegmentBodySchema,
  SegmentParamsSchema,
  ListSegmentsQuerySchema,
} from './schema.js'
import {
  createSegment,
  listSegments,
  getSegment,
  updateSegment,
  deleteSegment,
} from './service.js'

function validationError(reply: FastifyReply, error: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: error },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Segment not found' },
  })
}

export async function createSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CreateSegmentBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }

  const validation = validateConditionTree(parsed.data.conditions)
  if (!validation.ok) {
    await validationError(reply, validation.error)
    return
  }

  const merchantId = request.user.merchantId
  const segment = await createSegment(merchantId, parsed.data)

  await segmentEvaluateQueue.add(SEGMENT_EVALUATE, {
    segmentId: segment.id,
    merchantId,
  } satisfies SegmentEvaluateJobPayload)

  await reply.status(201).send({ success: true, data: segment })
}

export async function listSegmentsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ListSegmentsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const result = await listSegments(merchantId, parsed.data.page, parsed.data.pageSize)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const merchantId = request.user.merchantId
  const segment = await getSegment(merchantId, paramsParsed.data.id)
  if (!segment) {
    await notFound(reply)
    return
  }

  let preview: { id: string; email: string | null; firstName: string | null; lastName: string | null }[] = []
  try {
    const validation = validateConditionTree(segment.conditions)
    if (validation.ok) {
      const where = compileToPrismaWhere(segment.conditions as unknown as SegmentGroup, merchantId) as Prisma.CustomerWhereInput
      preview = await prisma.customer.findMany({
        where,
        select: { id: true, email: true, firstName: true, lastName: true },
        take: 5,
      })
    }
  } catch {
    // preview is best-effort — don't fail the whole request
  }

  await reply.send({ success: true, data: { ...segment, preview } })
}

export async function updateSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const parsed = UpdateSegmentBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }

  if (parsed.data.conditions !== undefined) {
    const validation = validateConditionTree(parsed.data.conditions)
    if (!validation.ok) {
      await validationError(reply, validation.error)
      return
    }
  }

  const merchantId = request.user.merchantId
  const existing = await getSegment(merchantId, paramsParsed.data.id)
  if (!existing) {
    await notFound(reply)
    return
  }

  const updated = await updateSegment(merchantId, paramsParsed.data.id, parsed.data)

  if (parsed.data.conditions !== undefined) {
    await segmentEvaluateQueue.add(SEGMENT_EVALUATE, {
      segmentId: updated.id,
      merchantId,
    } satisfies SegmentEvaluateJobPayload)
  }

  await reply.send({ success: true, data: updated })
}

export async function deleteSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const merchantId = request.user.merchantId
  const existing = await getSegment(merchantId, paramsParsed.data.id)
  if (!existing) {
    await notFound(reply)
    return
  }

  await deleteSegment(merchantId, paramsParsed.data.id)
  await reply.status(204).send()
}

export async function evaluateSegmentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = SegmentParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid segment ID')
    return
  }

  const merchantId = request.user.merchantId
  const segment = await getSegment(merchantId, paramsParsed.data.id)
  if (!segment) {
    await notFound(reply)
    return
  }

  await segmentEvaluateQueue.add(SEGMENT_EVALUATE, {
    segmentId: segment.id,
    merchantId,
  } satisfies SegmentEvaluateJobPayload)

  await reply.status(202).send({
    success: true,
    data: { message: 'Evaluation queued', segmentId: segment.id },
  })
}
