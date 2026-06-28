// apps/api/src/routes/whatsapp-templates/service.ts
//
// WhatsApp template CRUD + Meta submit. All queries are merchant-scoped (tenant safety).
import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import { env } from '@engageiq/shared'
import type { CreateTemplateBody, UpdateTemplateBody } from './schema.js'

// Soft allow-list of common Meta language codes — used to warn, never to block (spec §3.1).
const KNOWN_LANGUAGE_CODES = new Set([
  'en', 'en_US', 'en_GB', 'ur', 'ar', 'ar_AE', 'ar_EG', 'hi', 'pa', 'bn', 'es', 'fr', 'de', 'pt_BR',
])

export function isKnownLanguageCode(code: string): boolean {
  return KNOWN_LANGUAGE_CODES.has(code)
}

export async function createTemplate(merchantId: string, data: CreateTemplateBody) {
  return prisma.whatsAppTemplate.create({
    data: {
      merchantId,
      name: data.name,
      language: data.language,
      category: data.category,
      bodyText: data.bodyText,
      variableMap: data.variableMap as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
    },
  })
}

export async function listTemplates(merchantId: string, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.whatsAppTemplate.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.whatsAppTemplate.count({ where: { merchantId } }),
  ])
  return { items, total, page, pageSize }
}

export async function getTemplate(merchantId: string, id: string) {
  return prisma.whatsAppTemplate.findFirst({ where: { id, merchantId } })
}

export async function updateTemplate(merchantId: string, id: string, data: UpdateTemplateBody) {
  const update: Prisma.WhatsAppTemplateUpdateInput = {}
  if (data.name !== undefined) update.name = data.name
  if (data.language !== undefined) update.language = data.language
  if (data.category !== undefined) update.category = data.category
  if (data.bodyText !== undefined) update.bodyText = data.bodyText
  if (data.variableMap !== undefined) {
    update.variableMap = data.variableMap as unknown as Prisma.InputJsonValue
  }

  const result = await prisma.whatsAppTemplate.updateMany({
    where: { id, merchantId },
    data: update,
  })
  if (result.count === 0) return null
  return getTemplate(merchantId, id)
}

export async function deleteTemplate(merchantId: string, id: string): Promise<boolean> {
  const result = await prisma.whatsAppTemplate.deleteMany({ where: { id, merchantId } })
  return result.count > 0
}

// Map our variableMap to Meta's BODY example components for template approval.
function buildMetaComponents(template: {
  bodyText: string
  variableMap: unknown
}): Array<Record<string, unknown>> {
  const vars = (template.variableMap as Array<{ index: number; default?: string }>) ?? []
  const bodyComponent: Record<string, unknown> = { type: 'BODY', text: template.bodyText }
  if (vars.length > 0) {
    const example = [...vars]
      .sort((a, b) => a.index - b.index)
      .map((v) => v.default ?? 'sample')
    bodyComponent.example = { body_text: [example] }
  }
  return [bodyComponent]
}

export interface SubmitResult {
  status: 'PENDING'
  metaTemplateId: string | null
  submittedToMeta: boolean
}

// Submit a template to Meta for approval (spec §4.7). With a token + WABA id, POSTs to
// the Graph message_templates endpoint and stores the returned id. Without creds, sets
// status=PENDING locally so the flow is fully testable offline.
export async function submitTemplate(
  merchantId: string,
  id: string,
): Promise<SubmitResult | null> {
  const template = await getTemplate(merchantId, id)
  if (!template) return null

  const wabaId = env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
  const token = env.META_WHATSAPP_TOKEN

  let metaTemplateId: string | null = null
  let submittedToMeta = false

  if (wabaId && token) {
    const url = `https://graph.facebook.com/${env.META_API_VERSION}/${wabaId}/message_templates`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.name,
        language: template.language,
        category: template.category,
        components: buildMetaComponents(template),
      }),
    })
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string }
      metaTemplateId = json.id ?? null
      submittedToMeta = true
    } else {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      const message = json.error?.message ?? `Meta submit failed (HTTP ${res.status})`
      const err = new Error(message) as Error & { statusCode: number; code: string }
      err.statusCode = 502
      err.code = 'META_SUBMIT_FAILED'
      throw err
    }
  }

  await prisma.whatsAppTemplate.update({
    where: { id: template.id },
    data: {
      status: 'PENDING',
      ...(metaTemplateId !== null && { metaTemplateId }),
    },
  })

  return { status: 'PENDING', metaTemplateId, submittedToMeta }
}
