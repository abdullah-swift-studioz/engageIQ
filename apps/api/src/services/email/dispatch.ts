// apps/api/src/services/email/dispatch.ts
//
// The EMAIL send path invoked from the message-dispatch worker's EMAIL branch (roadmap
// 6.4). Consumes the same frozen MessageDispatchJob as WhatsApp; renders the email
// per-recipient at send time (dynamic products + conditional segments resolved fresh),
// sends via the EmailAdapter, and persists a Message row using the freeze-v2 email
// columns (toEmail, subject, bodyHtml, emailTemplateId). Flips the originating
// CampaignRecipient (Lane B) exactly like the WhatsApp path.
//
// Retry model (mirrors the WhatsApp worker): the Message row is created QUEUED and
// *reused* across BullMQ retries (looked up by the job's attribution keys) so transient
// failures never accumulate duplicate rows. Retryable failures re-throw (BullMQ retries);
// permanent failures mark the row FAILED and throw UnrecoverableError.
import { UnrecoverableError } from 'bullmq'
import { prisma } from '@engageiq/db'
import type { MessageDispatchJob, EmailBlock } from '@engageiq/shared'
import { emailAdapter } from '../../lib/channels/email.adapter.js'
import { buildEmailRenderContext } from './context.js'
import { renderEmail } from './render.js'
import { substituteTokens } from './tokens.js'
import { resolveVariantForRecipient } from './ab-test.js'

// Loose shape of the customer record the worker hands us (a Prisma Customer satisfies it).
interface CustomerRecord {
  id: string
  email: string | null
  isSubscribedEmail: boolean
  [key: string]: unknown
}

function log(level: 'info' | 'warn', msg: string, extra: Record<string, unknown>): void {
  console[level === 'warn' ? 'warn' : 'info'](JSON.stringify({ level, msg, ...extra }))
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A plain campaign body (no email template) → a single text block. Newlines → <br>.
// Personalization {{tokens}} survive escaping (esc only touches &<>) and render later.
function plainBodyBlocks(body: string): EmailBlock[] {
  return [{ id: 'body', type: 'text', html: esc(body).replace(/\r?\n/g, '<br>') }]
}

// Flip the originating CampaignRecipient to a terminal state (no-op for non-campaign
// sends). Tenant-scoped + idempotent — a retried job re-applies the same state.
async function flipRecipient(
  data: MessageDispatchJob,
  status: 'SENT' | 'FAILED' | 'SKIPPED',
  messageId?: string,
): Promise<void> {
  if (!data.campaignRecipientId) return
  const now = new Date()
  await prisma.campaignRecipient.updateMany({
    where: { id: data.campaignRecipientId, merchantId: data.merchantId },
    data: {
      status,
      ...(messageId !== undefined && { messageId }),
      ...(status === 'SENT' && { sentAt: now }),
      ...(status === 'FAILED' && { failedAt: now }),
    },
  })
}

// Find a reusable QUEUED email Message from a prior attempt (keyed by attribution) so
// retries update one row instead of creating a new one each time.
async function findReusableMessage(data: MessageDispatchJob): Promise<{ id: string } | null> {
  return prisma.message.findFirst({
    where: {
      merchantId: data.merchantId,
      customerId: data.customerId,
      channel: 'EMAIL',
      status: 'QUEUED',
      campaignId: data.campaignId ?? null,
      journeyEnrollmentId: data.journeyEnrollmentId ?? null,
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function dispatchEmail(data: MessageDispatchJob, customer: CustomerRecord): Promise<void> {
  const toEmail = customer.email
  const merchantId = data.merchantId

  // 1. Must have a destination address.
  if (!toEmail) {
    await flipRecipient(data, 'SKIPPED')
    log('warn', '[email-dispatch] no email address', { customerId: customer.id, merchantId })
    return
  }

  // 2. Consent + suppression gate — never send to an opted-out/suppressed address.
  if (!customer.isSubscribedEmail) {
    await flipRecipient(data, 'SKIPPED')
    log('info', '[email-dispatch] consent skip', { customerId: customer.id, merchantId })
    return
  }
  const suppressed = await prisma.emailSuppression.findUnique({
    where: { merchantId_email: { merchantId, email: toEmail } },
    select: { id: true },
  })
  if (suppressed) {
    await flipRecipient(data, 'SKIPPED')
    log('info', '[email-dispatch] suppressed', { customerId: customer.id, merchantId })
    return
  }

  // 3. Resolve the content: an EmailTemplate's blocks, or a plain campaign body.
  let blocks: EmailBlock[]
  let subject: string
  let preheader: string | null = null

  if (data.emailTemplateId) {
    const template = await prisma.emailTemplate.findFirst({
      where: { id: data.emailTemplateId, merchantId },
    })
    if (!template) {
      const msgId = await persistFailedEmail(data, toEmail, '(no subject)', 'Email template not found')
      await flipRecipient(data, 'FAILED', msgId)
      throw new UnrecoverableError(`Email template ${data.emailTemplateId} not found`)
    }
    blocks = (template.blocks as unknown as EmailBlock[]) ?? []
    subject = data.content.subject ?? template.subject ?? '(no subject)'
    preheader = template.preheader

    // A/B: when the job carries a variant, let the variant override subject/blocks.
    if (data.abVariantId) {
      const variant = await resolveVariantForRecipient(merchantId, template.id, data.abVariantId)
      if (variant?.subject) subject = variant.subject
      if (variant?.blocks) blocks = variant.blocks
    }
  } else {
    if (!data.content.body) {
      const msgId = await persistFailedEmail(data, toEmail, '(no subject)', 'Email has no body')
      await flipRecipient(data, 'FAILED', msgId)
      throw new UnrecoverableError('Email has no body')
    }
    blocks = plainBodyBlocks(data.content.body)
    subject = data.content.subject ?? '(no subject)'
  }

  // 4. Create (or reuse) the QUEUED Message row so we have an id for the open pixel.
  const reused = await findReusableMessage(data)
  const message = reused
    ? { id: reused.id }
    : await prisma.message.create({
        data: {
          merchantId,
          customerId: data.customerId,
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          status: 'QUEUED',
          body: '',
          toPhone: '', // sentinel — email uses toEmail
          toEmail,
          subject,
          ...(data.emailTemplateId !== undefined && { emailTemplateId: data.emailTemplateId }),
          ...(data.journeyEnrollmentId !== undefined && { journeyEnrollmentId: data.journeyEnrollmentId }),
          ...(data.campaignId !== undefined && { campaignId: data.campaignId }),
          // A/B variant lives on metadata (Message has no dedicated column).
          ...(data.abVariantId !== undefined && { metadata: { abVariantId: data.abVariantId } }),
        },
        select: { id: true },
      })

  // 5. Assemble the per-recipient context and render.
  const ctx = await buildEmailRenderContext({
    merchantId,
    customer,
    blocks,
    messageId: message.id,
  })
  const finalSubject = substituteTokens(subject, ctx)
  const rendered = renderEmail({ blocks, subject: finalSubject, preheader, ctx })

  // Persist the rendered content before sending (audit trail even if the send throws).
  await prisma.message.update({
    where: { id: message.id },
    data: { subject: finalSubject, body: rendered.text, bodyHtml: rendered.html },
  })

  // 6. Send.
  const result = await emailAdapter.send({
    channel: 'EMAIL',
    toEmail,
    subject: finalSubject,
    html: rendered.html,
    text: rendered.text,
  })

  if (result.ok) {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: 'SENT', providerMessageId: result.providerMessageId, sentAt: new Date() },
    })
    await flipRecipient(data, 'SENT', message.id)
    return
  }

  if (result.retryable) {
    // Leave the row QUEUED (reused on the next attempt) and re-throw so BullMQ retries.
    throw new Error(result.errorTitle)
  }

  // Permanent failure — mark FAILED and stop retrying.
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: 'FAILED',
      errorTitle: result.errorTitle,
      ...(result.errorCode !== undefined && { errorCode: result.errorCode }),
      failedAt: new Date(),
    },
  })
  await flipRecipient(data, 'FAILED', message.id)
  throw new UnrecoverableError(result.errorTitle)
}

// Persist a terminal FAILED email Message (used before a template/body precondition
// throws, where no QUEUED row exists yet). Returns its id for the recipient link.
async function persistFailedEmail(
  data: MessageDispatchJob,
  toEmail: string,
  subject: string,
  errorTitle: string,
): Promise<string> {
  const message = await prisma.message.create({
    data: {
      merchantId: data.merchantId,
      customerId: data.customerId,
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      status: 'FAILED',
      errorTitle,
      body: '',
      toPhone: '',
      toEmail,
      subject,
      ...(data.emailTemplateId !== undefined && { emailTemplateId: data.emailTemplateId }),
      ...(data.journeyEnrollmentId !== undefined && { journeyEnrollmentId: data.journeyEnrollmentId }),
      ...(data.campaignId !== undefined && { campaignId: data.campaignId }),
      failedAt: new Date(),
    },
    select: { id: true },
  })
  return message.id
}
