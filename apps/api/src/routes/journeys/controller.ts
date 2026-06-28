import type { FastifyRequest, FastifyReply } from 'fastify'
import { EnrollmentStatus } from '@prisma/client'
import { journeyExecutorQueue } from '@engageiq/queue'
import type { JourneyExecutorJob } from '@engageiq/shared'
import { JOURNEY_EXECUTOR } from '@engageiq/shared'
import {
  CreateJourneyBodySchema,
  UpdateJourneyBodySchema,
  SaveGraphBodySchema,
  JourneyParamsSchema,
  ListJourneysQuerySchema,
  ListEnrollmentsQuerySchema,
} from './schema.js'
import {
  createJourney,
  listJourneys,
  getJourney,
  updateJourney,
  deleteJourney,
  activateJourney,
  pauseJourney,
  saveJourneyGraph,
  archiveJourney,
  GraphValidationError,
  JourneyNotDraftError,
  listEnrollments,
} from './service.js'

function validationError(reply: FastifyReply, error: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: error },
  })
}

function notFound(reply: FastifyReply, entity = 'Journey') {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: `${entity} not found` },
  })
}

export async function createJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CreateJourneyBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const journey = await createJourney(request.user.merchantId, parsed.data)
  await reply.status(201).send({ success: true, data: journey })
}

export async function listJourneysHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ListJourneysQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listJourneys(request.user.merchantId, parsed.data.page, parsed.data.pageSize)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const journey = await getJourney(request.user.merchantId, paramsParsed.data.id)
  if (!journey) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: journey })
}

export async function updateJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const parsed = UpdateJourneyBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const updated = await updateJourney(request.user.merchantId, paramsParsed.data.id, parsed.data)
  if (!updated) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: updated })
}

export async function deleteJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const deleted = await deleteJourney(request.user.merchantId, paramsParsed.data.id)
  if (!deleted) {
    await notFound(reply)
    return
  }
  await reply.status(204).send()
}

export async function activateJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }

  try {
    const journey = await activateJourney(request.user.merchantId, paramsParsed.data.id)
    if (!journey) {
      await notFound(reply)
      return
    }

    const config = journey.triggerConfig as Record<string, unknown>
    if (journey.triggerType === 'scheduled' && config['fireAt']) {
      const fireAt = new Date(config['fireAt'] as string)
      const delayMs = Math.max(0, fireAt.getTime() - Date.now())
      await journeyExecutorQueue.add(
        JOURNEY_EXECUTOR,
        {
          type: 'scheduled_fire',
          journeyId: journey.id,
          merchantId: request.user.merchantId,
        } satisfies JourneyExecutorJob,
        { delay: delayMs, jobId: `scheduled-fire-${journey.id}` },
      )
    }

    await reply.send({ success: true, data: journey })
  } catch (err) {
    if (err instanceof Error && err.message === 'MISSING_TRIGGER_STEP') {
      await validationError(reply, 'Journey must have at least one TRIGGER step before activation')
      return
    }
    throw err
  }
}

export async function saveJourneyGraphHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const parsed = SaveGraphBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }

  try {
    const journey = await saveJourneyGraph(
      request.user.merchantId,
      paramsParsed.data.id,
      parsed.data.nodes,
    )
    if (!journey) {
      await notFound(reply)
      return
    }
    await reply.send({ success: true, data: journey })
  } catch (err) {
    if (err instanceof GraphValidationError) {
      await validationError(reply, err.message)
      return
    }
    if (err instanceof JourneyNotDraftError) {
      await reply.status(409).send({
        success: false,
        error: { code: 'JOURNEY_NOT_DRAFT', message: err.message },
      })
      return
    }
    throw err
  }
}

export async function archiveJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const journey = await archiveJourney(request.user.merchantId, paramsParsed.data.id)
  if (!journey) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: journey })
}

export async function pauseJourneyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const journey = await pauseJourney(request.user.merchantId, paramsParsed.data.id)
  if (!journey) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: journey })
}

export async function listEnrollmentsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = JourneyParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid journey ID')
    return
  }
  const parsed = ListEnrollmentsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listEnrollments(
    request.user.merchantId,
    paramsParsed.data.id,
    parsed.data.page,
    parsed.data.pageSize,
    parsed.data.status as EnrollmentStatus | undefined,
  )
  if (!result) {
    await notFound(reply)
    return
  }
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}
