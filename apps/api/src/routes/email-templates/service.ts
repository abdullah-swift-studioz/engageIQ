// apps/api/src/routes/email-templates/service.ts
//
// Email template CRUD + preview/spam-check/test-send/segment-send. All queries are
// merchant-scoped (tenant safety). Sending reuses the frozen message-dispatch pipeline:
// segment sends enqueue one MessageDispatchJob per eligible recipient with emailTemplateId
// set, so Lane A's worker (via this lane's EMAIL branch) renders + delivers each one.

import { randomBytes } from 'node:crypto'
import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import { messageDispatchQueue } from '@engageiq/queue'
import { MESSAGE_DISPATCH } from '@engageiq/shared'
import type { EmailBlock, EmailRenderContext, MessageDispatchJob } from '@engageiq/shared'
import { buildEmailRenderContext } from '../../services/email/context.js'
import { resolveBlockProducts } from '../../services/email/products.js'
import { renderEmail } from '../../services/email/render.js'
import { substituteTokens } from '../../services/email/tokens.js'
import { scoreSpam, type SpamScoreResult } from '../../services/email/spam-score.js'
import { emailAdapter } from '../../lib/channels/email.adapter.js'
import { pickVariantForCustomer } from '../../services/email/ab-test.js'
import type { CreateTemplateBody, UpdateTemplateBody, PreviewBody, TestSendBody, SendBody } from './schema.js'

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string }

function blocksJson(blocks: EmailBlock[]): Prisma.InputJsonValue {
  return blocks as unknown as Prisma.InputJsonValue
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createTemplate(merchantId: string, body: CreateTemplateBody) {
  return prisma.emailTemplate.create({
    data: {
      merchantId,
      name: body.name,
      subject: body.subject ?? null,
      preheader: body.preheader ?? null,
      blocks: blocksJson(body.blocks),
      isTransactional: body.isTransactional ?? false,
    },
  })
}

export async function listTemplates(merchantId: string, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.emailTemplate.findMany({
      where: { merchantId },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.emailTemplate.count({ where: { merchantId } }),
  ])
  return { items, total, page, pageSize }
}

export async function getTemplate(merchantId: string, id: string) {
  return prisma.emailTemplate.findFirst({ where: { id, merchantId } })
}

export async function updateTemplate(merchantId: string, id: string, body: UpdateTemplateBody) {
  const update: Prisma.EmailTemplateUpdateInput = {}
  if (body.name !== undefined) update.name = body.name
  if (body.subject !== undefined) update.subject = body.subject
  if (body.preheader !== undefined) update.preheader = body.preheader
  if (body.blocks !== undefined) update.blocks = blocksJson(body.blocks)
  if (body.status !== undefined) update.status = body.status
  if (body.isTransactional !== undefined) update.isTransactional = body.isTransactional

  const result = await prisma.emailTemplate.updateMany({ where: { id, merchantId }, data: update })
  if (result.count === 0) return null
  return getTemplate(merchantId, id)
}

export async function deleteTemplate(merchantId: string, id: string): Promise<boolean> {
  const result = await prisma.emailTemplate.deleteMany({ where: { id, merchantId } })
  return result.count > 0
}

// ─── Render context assembly for preview/spam/test (no queue) ──────────────────

// Segment ids referenced by any conditional block — used so preview shows conditional
// content (the merchant wants to see every branch).
function conditionalSegmentIds(blocks: EmailBlock[], out: Set<string> = new Set()): Set<string> {
  for (const b of blocks) {
    if (b.type === 'conditional') {
      out.add(b.segmentId)
      conditionalSegmentIds(b.blocks, out)
    }
  }
  return out
}

// Build a synthetic context for preview/spam/test when no real customer is given: a
// sample profile, all conditional segments "matched", and live catalog products.
async function buildSampleContext(
  merchantId: string,
  blocks: EmailBlock[],
  sample: PreviewBody['sampleCustomer'],
): Promise<EmailRenderContext> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, currency: true, shopifyDomain: true },
  })
  const currency = merchant?.currency ?? 'PKR'
  const storefrontBase = merchant?.shopifyDomain ? `https://${merchant.shopifyDomain}` : null

  const productsByBlockId: Record<string, EmailRenderProductList> = {}
  const dynamicBlocks: EmailBlock[] = []
  const collect = (bs: EmailBlock[]) => {
    for (const b of bs) {
      if (b.type === 'dynamic-product') dynamicBlocks.push(b)
      else if (b.type === 'conditional') collect(b.blocks)
    }
  }
  collect(blocks)
  await Promise.all(
    dynamicBlocks.map(async (b) => {
      if (b.type !== 'dynamic-product') return
      productsByBlockId[b.id] = await resolveBlockProducts(
        { merchantId, customerId: null, currency, storefrontBase },
        b,
      )
    }),
  )

  return {
    customer: {
      firstName: sample?.firstName ?? 'Sara',
      lastName: sample?.lastName ?? 'Ahmed',
      email: sample?.email ?? 'sample@customer.com',
      city: sample?.city ?? 'Karachi',
    },
    merchant: { name: merchant?.name ?? 'EngageIQ', currency },
    segmentIds: [...conditionalSegmentIds(blocks)],
    productsByBlockId,
    // Placeholder so preview + spam-check reflect the real send (which always injects a
    // working unsubscribe link via buildEmailRenderContext).
    unsubscribeUrl: '#unsubscribe-preview',
  }
}

type EmailRenderProductList = Awaited<ReturnType<typeof resolveBlockProducts>>

// Resolve the render context for preview/test — real customer when given, else sample.
async function resolveContext(
  merchantId: string,
  blocks: EmailBlock[],
  opts: { customerId?: string; sampleCustomer?: PreviewBody['sampleCustomer']; messageId?: string },
): Promise<{ ctx: EmailRenderContext } | { error: ServiceResult<never> }> {
  if (opts.customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: opts.customerId, merchantId } })
    if (!customer) {
      return { error: { ok: false, status: 404, code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } }
    }
    const ctx = await buildEmailRenderContext({
      merchantId,
      customer: customer as unknown as { id: string; email: string | null },
      blocks,
      ...(opts.messageId ? { messageId: opts.messageId } : {}),
    })
    return { ctx }
  }
  return { ctx: await buildSampleContext(merchantId, blocks, opts.sampleCustomer) }
}

// ─── Preview / spam-check ──────────────────────────────────────────────────────

export interface RenderedPreview {
  subject: string
  html: string
  text: string
}

export async function previewTemplate(
  merchantId: string,
  id: string,
  body: PreviewBody,
): Promise<ServiceResult<RenderedPreview>> {
  const template = await getTemplate(merchantId, id)
  if (!template) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Template not found' }
  const blocks = (template.blocks as unknown as EmailBlock[]) ?? []
  const resolved = await resolveContext(merchantId, blocks, {
    ...(body.customerId ? { customerId: body.customerId } : {}),
    sampleCustomer: body.sampleCustomer,
  })
  if ('error' in resolved) return resolved.error
  const subject = substituteTokens(template.subject ?? '(no subject)', resolved.ctx)
  const rendered = renderEmail({ blocks, subject, preheader: template.preheader, ctx: resolved.ctx })
  return { ok: true, data: { subject, html: rendered.html, text: rendered.text } }
}

export async function spamCheckTemplate(
  merchantId: string,
  id: string,
  body: PreviewBody,
): Promise<ServiceResult<SpamScoreResult & { subject: string }>> {
  const preview = await previewTemplate(merchantId, id, body)
  if (!preview.ok) return preview
  const result = scoreSpam({ subject: preview.data.subject, html: preview.data.html, text: preview.data.text })
  return { ok: true, data: { ...result, subject: preview.data.subject } }
}

// ─── Test send (synchronous, one address) ──────────────────────────────────────

export interface TestSendResult {
  ok: boolean
  messageId: string
  providerMessageId?: string
  error?: string
}

export async function testSendTemplate(
  merchantId: string,
  id: string,
  body: TestSendBody,
): Promise<ServiceResult<TestSendResult>> {
  const template = await getTemplate(merchantId, id)
  if (!template) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Template not found' }
  const blocks = (template.blocks as unknown as EmailBlock[]) ?? []

  const message = await prisma.message.create({
    data: {
      merchantId,
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      status: 'QUEUED',
      body: '',
      toPhone: '',
      toEmail: body.toEmail,
      subject: template.subject ?? '(test) ',
      emailTemplateId: template.id,
      metadata: { test: true },
    },
    select: { id: true },
  })

  const resolved = await resolveContext(merchantId, blocks, {
    ...(body.customerId ? { customerId: body.customerId } : {}),
    sampleCustomer: body.sampleCustomer,
    messageId: message.id,
  })
  if ('error' in resolved) return resolved.error

  const subject = substituteTokens(`[TEST] ${template.subject ?? ''}`.trim(), resolved.ctx)
  const rendered = renderEmail({ blocks, subject, preheader: template.preheader, ctx: resolved.ctx })
  await prisma.message.update({
    where: { id: message.id },
    data: { subject, body: rendered.text, bodyHtml: rendered.html },
  })

  const send = await emailAdapter.send({
    channel: 'EMAIL',
    toEmail: body.toEmail,
    subject,
    html: rendered.html,
    text: rendered.text,
  })

  if (send.ok) {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: 'SENT', providerMessageId: send.providerMessageId, sentAt: new Date() },
    })
    return { ok: true, data: { ok: true, messageId: message.id, providerMessageId: send.providerMessageId } }
  }
  await prisma.message.update({
    where: { id: message.id },
    data: { status: 'FAILED', errorTitle: send.errorTitle, failedAt: new Date() },
  })
  return { ok: true, data: { ok: false, messageId: message.id, error: send.errorTitle } }
}

// ─── Segment send (fan out through the message-dispatch pipeline) ───────────────

export interface SegmentSendResult {
  enqueued: number
  segmentId: string
}

export async function sendToSegment(
  merchantId: string,
  id: string,
  body: SendBody,
): Promise<ServiceResult<SegmentSendResult>> {
  const template = await getTemplate(merchantId, id)
  if (!template) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Template not found' }

  const segment = await prisma.segment.findFirst({ where: { id: body.segmentId, merchantId }, select: { id: true } })
  if (!segment) return { ok: false, status: 400, code: 'SEGMENT_NOT_FOUND', message: 'Target segment not found' }

  // Eligible = active member of the segment, not merged/blocked, opted in, has an email.
  const eligible = await prisma.customer.findMany({
    where: {
      merchantId,
      mergedIntoId: null,
      isBlocked: false,
      isSubscribedEmail: true,
      email: { not: null },
      segmentMemberships: { some: { segmentId: body.segmentId, exitedAt: null } },
    },
    select: { id: true },
  })

  // Per-request send id so a re-send is allowed but a double-click within one request dedups.
  const sendId = randomBytes(6).toString('hex')
  let enqueued = 0
  for (const customer of eligible) {
    const abVariantId = await pickVariantForCustomer(merchantId, template.id, customer.id)
    const job: MessageDispatchJob = {
      type: 'send',
      channel: 'EMAIL',
      merchantId,
      customerId: customer.id,
      content: { body: '' }, // unused: the template's blocks are the content
      emailTemplateId: template.id,
      ...(abVariantId ? { abVariantId } : {}),
    }
    await messageDispatchQueue.add(MESSAGE_DISPATCH, job, { jobId: `et_${template.id}_${sendId}_${customer.id}` })
    enqueued++
  }

  return { ok: true, data: { enqueued, segmentId: body.segmentId } }
}
