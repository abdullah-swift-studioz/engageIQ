import type { FastifyRequest, FastifyReply } from 'fastify'
import { FlowKeyParamsSchema } from './schema.js'
import {
  listFlowTemplates,
  getFlowTemplate,
  instantiateFlowTemplate,
  FlowTemplateNotFoundError,
} from '../../services/flow-library/index.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Flow template not found' },
  })
}

export async function listFlowTemplatesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const templates = await listFlowTemplates()
  await reply.send({ success: true, data: templates, meta: { total: templates.length } })
}

export async function getFlowTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = FlowKeyParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, 'Invalid flow template key')
    return
  }
  const template = await getFlowTemplate(parsed.data.key)
  if (!template) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: template })
}

export async function useFlowTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = FlowKeyParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, 'Invalid flow template key')
    return
  }
  try {
    const result = await instantiateFlowTemplate(request.user.merchantId, parsed.data.key)
    await reply.status(201).send({ success: true, data: result })
  } catch (err) {
    if (err instanceof FlowTemplateNotFoundError) {
      await notFound(reply)
      return
    }
    throw err
  }
}
