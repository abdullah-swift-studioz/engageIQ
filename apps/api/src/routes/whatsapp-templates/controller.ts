import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  CreateTemplateBodySchema,
  UpdateTemplateBodySchema,
  TemplateParamsSchema,
  ListTemplatesQuerySchema,
} from './schema.js'
import {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  submitTemplate,
} from './service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } })
}

export async function createTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = CreateTemplateBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
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
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }

  const existing = await getTemplate(request.user.merchantId, params.data.id)
  if (!existing) {
    await notFound(reply)
    return
  }
  // Only DRAFT / REJECTED templates are editable (spec §4.7).
  if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
    await reply.status(409).send({
      success: false,
      error: { code: 'TEMPLATE_NOT_EDITABLE', message: `Cannot edit a ${existing.status} template` },
    })
    return
  }

  // If the body or variableMap changes, re-validate the placeholder/variableMap match.
  const merged = {
    bodyText: parsed.data.bodyText ?? existing.bodyText,
    variableMap: (parsed.data.variableMap ?? (existing.variableMap as Array<{ index: number }>)) as Array<{ index: number }>,
  }
  const recheck = CreateTemplateBodySchema.safeParse({
    name: parsed.data.name ?? existing.name,
    language: parsed.data.language ?? existing.language,
    category: parsed.data.category ?? existing.category,
    bodyText: merged.bodyText,
    variableMap: merged.variableMap,
  })
  if (!recheck.success) {
    await validationError(reply, recheck.error.issues.map((i) => i.message).join(', '))
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

export async function submitTemplateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = TemplateParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid template ID')
    return
  }
  const result = await submitTemplate(request.user.merchantId, params.data.id)
  if (!result) {
    await notFound(reply)
    return
  }
  await reply.status(202).send({ success: true, data: result })
}
