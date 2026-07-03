import { prisma } from '@engageiq/db'
import { webhookDeliveryQueue } from '@engageiq/queue'
import type { WebhookDeliveryJob } from '@engageiq/shared'
import { WEBHOOK_DELIVERY } from '@engageiq/shared'
import { encryptSecret, generateWebhookSecret } from '../../services/webhooks-outbound/crypto.js'
import { PING_EVENT } from '../../services/webhooks-outbound/events.js'
import type { CreateWebhookInput, UpdateWebhookInput } from './schema.js'

/** Public-safe webhook projection — never includes the (encrypted) secret. */
export interface WebhookSafe {
  id: string
  url: string
  events: string[]
  isActive: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}

const SAFE_SELECT = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const

function toSafe(w: {
  id: string
  url: string
  events: string[]
  isActive: boolean
  description: string | null
  createdAt: Date
  updatedAt: Date
}): WebhookSafe {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    isActive: w.isActive,
    description: w.description,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }
}

export interface DeliverySafe {
  id: string
  event: string
  statusCode: number | null
  attempts: number
  success: boolean
  error: string | null
  nextRetryAt: string | null
  deliveredAt: string | null
  createdAt: string
}

function toDeliverySafe(d: {
  id: string
  event: string
  statusCode: number | null
  attempts: number
  success: boolean
  error: string | null
  nextRetryAt: Date | null
  deliveredAt: Date | null
  createdAt: Date
}): DeliverySafe {
  return {
    id: d.id,
    event: d.event,
    statusCode: d.statusCode,
    attempts: d.attempts,
    success: d.success,
    error: d.error,
    nextRetryAt: d.nextRetryAt ? d.nextRetryAt.toISOString() : null,
    deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  }
}

export async function listWebhooks(merchantId: string): Promise<WebhookSafe[]> {
  const rows = await prisma.outboundWebhook.findMany({
    where: { merchantId },
    select: SAFE_SELECT,
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toSafe)
}

export async function getWebhook(
  merchantId: string,
  id: string,
): Promise<{ webhook: WebhookSafe; deliveries: DeliverySafe[] } | null> {
  const row = await prisma.outboundWebhook.findFirst({ where: { id, merchantId }, select: SAFE_SELECT })
  if (!row) return null
  const deliveries = await listDeliveries(merchantId, id, 20)
  return { webhook: toSafe(row), deliveries }
}

/** Create a webhook. Returns the plaintext signing secret ONCE (stored encrypted). */
export async function createWebhook(
  merchantId: string,
  input: CreateWebhookInput,
): Promise<{ webhook: WebhookSafe; secret: string }> {
  const secret = generateWebhookSecret()
  const row = await prisma.outboundWebhook.create({
    data: {
      merchantId,
      url: input.url,
      events: input.events,
      description: input.description ?? null,
      secret: encryptSecret(secret),
    },
    select: SAFE_SELECT,
  })
  return { webhook: toSafe(row), secret }
}

export async function updateWebhook(
  merchantId: string,
  id: string,
  input: UpdateWebhookInput,
): Promise<WebhookSafe | null> {
  const existing = await prisma.outboundWebhook.findFirst({ where: { id, merchantId }, select: { id: true } })
  if (!existing) return null
  const updated = await prisma.outboundWebhook.update({
    where: { id },
    data: {
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.events !== undefined ? { events: input.events } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: SAFE_SELECT,
  })
  return toSafe(updated)
}

/** Rotate the signing secret. Returns the new plaintext secret ONCE. */
export async function rotateWebhookSecret(merchantId: string, id: string): Promise<string | null> {
  const existing = await prisma.outboundWebhook.findFirst({ where: { id, merchantId }, select: { id: true } })
  if (!existing) return null
  const secret = generateWebhookSecret()
  await prisma.outboundWebhook.update({ where: { id }, data: { secret: encryptSecret(secret) } })
  return secret
}

export async function deleteWebhook(merchantId: string, id: string): Promise<boolean> {
  const result = await prisma.outboundWebhook.deleteMany({ where: { id, merchantId } })
  return result.count > 0
}

export async function listDeliveries(
  merchantId: string,
  webhookId: string,
  limit = 50,
): Promise<DeliverySafe[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: { merchantId, webhookId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  })
  return rows.map(toDeliverySafe)
}

/** Fire a `ping` test event at a webhook. Returns the delivery id, or null if not found. */
export async function sendTestPing(merchantId: string, id: string): Promise<string | null> {
  const webhook = await prisma.outboundWebhook.findFirst({ where: { id, merchantId }, select: { id: true } })
  if (!webhook) return null

  const payload = { message: 'EngageIQ test ping', webhookId: id }
  const delivery = await prisma.webhookDelivery.create({
    data: { merchantId, webhookId: id, event: PING_EVENT, payload },
    select: { id: true },
  })

  const job: WebhookDeliveryJob = {
    type: 'deliver',
    merchantId,
    webhookId: id,
    event: PING_EVENT,
    payload,
    deliveryId: delivery.id,
  }
  await webhookDeliveryQueue.add(WEBHOOK_DELIVERY, job, { jobId: `whd_${delivery.id}` })
  return delivery.id
}
