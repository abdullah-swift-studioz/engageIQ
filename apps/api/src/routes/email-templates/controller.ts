import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  CreateTemplateBodySchema,
  UpdateTemplateBodySchema,
  TemplateParamsSchema,
  ListTemplatesQuerySchema,
  PreviewBodySchema,
  TestSendBodySchema,
  SendBodySchema,
} from './schema.js'
import {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  spamCheckTemplate,
  testSendTemplate,
  sendToSegment,
  type ServiceResult,
} from './service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } })
}

// Send a ServiceResult<T> back with its embedded status/code on failure.
async function sendResult<T>(reply: FastifyReply, result: ServiceResult<T>, okStatus = 200): Promise<void> {
  if (result.ok) {
    await reply.status(okStatus).send({ success: true, data: result.data })
    return
  }
  await reply.status(result.status).send({ success: false, error: { code: result.code, message: result.message } })
}

export async function createTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = CreateTemplateBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '))
    return
  }
  const template = await createTemplate(request.user.merchantId, parsed.data)
  await reply.status(201).send({ success: true, data: template })
}

export async function listTemplatesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ListTemplatesQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listTemplates(request.user.merchantId, parsed.data.page, parsed.data.pageSize)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const template = await getTemplate(request.user.merchantId, params.data.id)
  if (!template) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: template })
}

export async function updateTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const parsed = UpdateTemplateBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '))
    return
  }
  const updated = await updateTemplate(request.user.merchantId, params.data.id, parsed.data)
  if (!updated) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: updated })
}

export async function deleteTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const deleted = await deleteTemplate(request.user.merchantId, params.data.id)
  if (!deleted) {
    await notFound(reply)
    return
  }
  await reply.status(204).send()
}

export async function previewTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const parsed = PreviewBodySchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  await sendResult(reply, await previewTemplate(request.user.merchantId, params.data.id, parsed.data))
}

export async function spamCheckTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const parsed = PreviewBodySchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  await sendResult(reply, await spamCheckTemplate(request.user.merchantId, params.data.id, parsed.data))
}

export async function testSendTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const parsed = TestSendBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  await sendResult(reply, await testSendTemplate(request.user.merchantId, params.data.id, parsed.data), 202)
}

export async function sendTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const parsed = SendBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  await sendResult(reply, await sendToSegment(request.user.merchantId, params.data.id, parsed.data), 202)
}
