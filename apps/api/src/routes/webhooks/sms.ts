// apps/api/src/routes/webhooks/sms.ts
//
// Twilio-shaped SMS webhook (mirrors routes/webhooks/whatsapp.ts). Public route (no JWT),
// protected by Twilio's X-Twilio-Signature HMAC. One POST endpoint handles both shapes
// Twilio posts to a single callback URL:
//   • Delivery-status callback  — has MessageStatus + MessageSid → advance Message status MONOTONICALLY
//   • Inbound message           — has From + Body (no MessageStatus) → STOP opt-out (isSubscribedSms=false)
// Always returns 200 quickly after processing so Twilio does not back off/retry.
//
// Twilio posts application/x-www-form-urlencoded. No urlencoded body parser is registered
// globally, so we opt into rawBody and parse the form ourselves (also exactly what the
// signature must be computed over).
import crypto from 'crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type { MessageStatus } from '@prisma/client'

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

// Verify Twilio's X-Twilio-Signature: base64(HMAC-SHA1(url + sorted(k+v)..., authToken)).
// For a form POST, append each POST param — sorted alphabetically by key — as key
// immediately followed by value, to the full request URL, then HMAC-SHA1 + base64.
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | undefined,
  authToken: string,
): boolean {
  if (!signatureHeader) return false
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Canonical forward ranking (shared vocabulary with the WhatsApp webhook). FAILED terminal.
const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 }

// Twilio delivery statuses → our MessageStatus enum. 'undelivered' and 'failed' are both
// terminal failures; 'read' only occurs for WhatsApp-over-Twilio but is mapped for safety.
const TWILIO_STATUS_TO_ENUM: Record<string, MessageStatus> = {
  queued: 'QUEUED',
  sent: 'SENT',
  delivered: 'DELIVERED',
  undelivered: 'FAILED',
  failed: 'FAILED',
  read: 'READ',
}

const TIMESTAMP_FIELD: Partial<Record<string, 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt'>> = {
  sent: 'sentAt',
  delivered: 'deliveredAt',
  read: 'readAt',
  undelivered: 'failedAt',
  failed: 'failedAt',
}

export interface CurrentMessageState {
  status: MessageStatus
}

// Build a Prisma update for an incoming Twilio status applying MONOTONIC advancement:
// never regress canonical status; always stamp the matching timestamp; once FAILED,
// status stays FAILED. Returns null for an unknown Twilio status string.
export function buildSmsStatusUpdate(
  current: CurrentMessageState,
  twilioStatus: string,
  eventDate: Date,
): Record<string, unknown> | null {
  const incoming = TWILIO_STATUS_TO_ENUM[twilioStatus]
  if (!incoming) return null

  const update: Record<string, unknown> = {}

  // Always stamp the matching timestamp regardless of canonical status.
  const tsField = TIMESTAMP_FIELD[twilioStatus]
  if (tsField) update[tsField] = eventDate

  if (incoming === 'FAILED') {
    update.status = 'FAILED'
    return update
  }

  // Once FAILED, never move status off FAILED (timestamp may still be recorded).
  if (current.status === 'FAILED') return update

  // Only advance forward.
  if ((STATUS_RANK[incoming] ?? 0) > (STATUS_RANK[current.status] ?? 0)) {
    update.status = incoming
  }
  return update
}

// Twilio's default STOP keywords (case-insensitive, trimmed): STOP, STOPALL, UNSUBSCRIBE,
// CANCEL, END, QUIT. Any of these in an inbound body is an opt-out.
const STOP_KEYWORD = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i

export function isSmsStopMessage(body: string | undefined): boolean {
  if (typeof body !== 'string') return false
  return STOP_KEYWORD.test(body.trim())
}

// ─── Event processors ────────────────────────────────────────────────────────

// A Twilio status callback: advance the matching Message (by provider sid) monotonically.
async function processStatusCallback(params: Record<string, string>): Promise<void> {
  const sid = params.MessageSid || params.SmsSid
  const twilioStatus = (params.MessageStatus || params.SmsStatus || '').toLowerCase()
  if (!sid || !twilioStatus) return

  const message = await prisma.message.findUnique({
    where: { providerMessageId: sid },
    select: { id: true, status: true },
  })
  if (!message) return // unknown sid — nothing to update

  const update = buildSmsStatusUpdate({ status: message.status }, twilioStatus, new Date())
  if (!update || Object.keys(update).length === 0) return

  // Capture Twilio's error code on a terminal failure.
  if (twilioStatus === 'failed' || twilioStatus === 'undelivered') {
    if (params.ErrorCode) update.errorCode = params.ErrorCode
    update.errorTitle = params.ErrorMessage || `Twilio ${twilioStatus}`
  }

  await prisma.message.update({ where: { id: message.id }, data: update })
}

// An inbound SMS: log it and, if it is a STOP keyword, suppress future SMS to this number.
async function processInbound(params: Record<string, string>): Promise<void> {
  const from = params.From
  const body = params.Body ?? ''
  if (!from) return

  // Resolve the customer by phone. With a shared sender number (no per-merchant routing
  // in the frozen schema) we attribute inbound to the first customer matching this phone.
  const customer = await prisma.customer.findFirst({
    where: { phone: from },
    select: { id: true, merchantId: true },
  })
  if (!customer) return // cannot persist without a merchant; logged-and-dropped

  const sid = params.MessageSid || params.SmsSid
  await prisma.message.create({
    data: {
      merchantId: customer.merchantId,
      customerId: customer.id,
      channel: 'SMS',
      direction: 'INBOUND',
      ...(sid ? { providerMessageId: sid } : {}),
      status: 'RECEIVED',
      body,
      toPhone: '',
      fromPhone: from,
    },
  })

  if (isSmsStopMessage(body)) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { isSubscribedSms: false },
    })
  }
}

// Route each Twilio POST to the right processor by its shape.
export async function processSmsWebhook(params: Record<string, string>): Promise<void> {
  if (params.MessageStatus || params.SmsStatus) {
    await processStatusCallback(params)
  } else if (params.From && params.Body !== undefined) {
    await processInbound(params)
  }
}

// Reconstruct the exact URL Twilio signed. PUBLIC_BASE_URL wins behind a proxy where the
// request's own protocol/host may be the internal ones; otherwise use the request's view.
function requestUrl(request: FastifyRequest): string {
  if (env.PUBLIC_BASE_URL) {
    return env.PUBLIC_BASE_URL.replace(/\/$/, '') + request.url
  }
  return `${request.protocol}://${request.headers.host ?? ''}${request.url}`
}

// ─── Route ─────────────────────────────────────────────────────────────────

async function smsWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/sms', {
    config: { rawBody: true },
    handler: async (request, reply) => {
      const rawBodyBuf = request.rawBody
      const raw = Buffer.isBuffer(rawBodyBuf) ? rawBodyBuf.toString('utf-8') : String(rawBodyBuf ?? '')
      const params: Record<string, string> = {}
      for (const [k, v] of new URLSearchParams(raw)) params[k] = v

      // HMAC verification (only enforced when the Twilio auth token is configured).
      if (env.TWILIO_AUTH_TOKEN) {
        const signature = request.headers['x-twilio-signature'] as string | undefined
        if (!verifyTwilioSignature(requestUrl(request), params, signature, env.TWILIO_AUTH_TOKEN)) {
          return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid signature' } })
        }
      }

      // Defensive: never let a malformed payload 500 — always 200 so Twilio keeps delivering.
      try {
        await processSmsWebhook(params)
      } catch (err) {
        request.log.error({ err }, '[sms-webhook] processing error')
      }
      // Empty TwiML: acknowledges inbound without triggering an auto-reply.
      return reply.status(200).type('text/xml').send('<Response></Response>')
    },
  })
}

export default smsWebhookRoutes
