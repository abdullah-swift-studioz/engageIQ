import type { FastifyRequest, FastifyReply } from 'fastify'
import { GenerateBodySchema, PredictSubjectBodySchema } from './schema.js'
import { generateCopy, type AiServiceResult } from '../../services/ai/copywriter.service.js'
import { predictSubjectOpenRate } from '../../services/ai/subject-predictor.service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message },
  })
}

async function sendServiceError(
  reply: FastifyReply,
  result: Extract<AiServiceResult<unknown>, { ok: false }>,
) {
  await reply.status(result.status).send({
    success: false,
    error: { code: result.code, message: result.message },
  })
}

// POST /api/v1/ai/generate — "Generate with AI": 3 copy variants for the given purpose/context.
export async function generateCopyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = GenerateBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await generateCopy(request.user.merchantId, parsed.data, request.user.userId)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.status(200).send({ success: true, data: result.data })
}

// POST /api/v1/ai/predict-subject — heuristic open-rate prediction for an email subject line.
export async function predictSubjectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = PredictSubjectBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await predictSubjectOpenRate(request.user.merchantId, parsed.data)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.status(200).send({ success: true, data: result.data })
}
