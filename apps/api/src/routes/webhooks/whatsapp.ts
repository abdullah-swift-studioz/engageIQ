// apps/api/src/routes/webhooks/whatsapp.ts
//
// WhatsApp Cloud API webhook (spec §4.6). Public route (no JWT) protected by HMAC.
//   GET  /webhooks/whatsapp  — Meta verification handshake (echo hub.challenge)
//   POST /webhooks/whatsapp  — status updates (monotonic) + inbound messages (opt-out)
// Always returns 200 quickly after processing parsed events so Meta does not back off.
import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type { MessageStatus } from '@prisma/client'

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

// Verify Meta's X-Hub-Signature-256: "sha256=<hex of HMAC-SHA256(rawBody, appSecret)>".
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Canonical forward ranking. FAILED is terminal and handled separately.
const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 }

const META_STATUS_TO_ENUM: Record<string, MessageStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
}

const TIMESTAMP_FIELD: Record<string, 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt'> = {
  sent: 'sentAt',
  delivered: 'deliveredAt',
  read: 'readAt',
  failed: 'failedAt',
}

export interface CurrentMessageState {
  status: MessageStatus
}

// Build a Prisma update for an incoming status event applying MONOTONIC advancement
// (spec change #3): never regress canonical status; always stamp the matching
// timestamp; once FAILED, status stays FAILED.
export function buildStatusUpdate(
  current: CurrentMessageState,
  metaStatus: string,
  eventDate: Date,
): Record<string, unknown> | null {
  const incoming = META_STATUS_TO_ENUM[metaStatus]
  if (!incoming) return null

  const update: Record<string, unknown> = {}

  // Always stamp the matching timestamp regardless of canonical status.
  const tsField = TIMESTAMP_FIELD[metaStatus]
  if (tsField) update[tsField] = eventDate

  if (incoming === 'FAILED') {
    // Failure is terminal.
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

// Detect an opt-out from an inbound message: STOP/UNSUBSCRIBE text OR Meta's native
// marketing opt-out signal (the "Stop promotions" button reply) — spec change #4.
export function isOptOutMessage(message: Record<string, unknown>): boolean {
  const keyword = /^(stop|unsubscribe)$/i

  const text = (message.text as { body?: string } | undefined)?.body
  if (typeof text === 'string' && keyword.test(text.trim())) return true

  // Quick-reply button on a marketing template ("Stop promotions").
  const button = message.button as { text?: string; payload?: string } | undefined
  if (button) {
    if (typeof button.text === 'string' && /stop|unsubscribe|opt[\s_-]?out|promotion/i.test(button.text)) return true
    if (typeof button.payload === 'string' && /stop|unsubscribe|opt[\s_-]?out/i.test(button.payload)) return true
  }

  // Interactive button reply.
  const interactive = message.interactive as
    | { button_reply?: { id?: string; title?: string } }
    | undefined
  const reply = interactive?.button_reply
  if (reply) {
    if (typeof reply.id === 'string' && /stop|unsubscribe|opt[\s_-]?out/i.test(reply.id)) return true
    if (typeof reply.title === 'string' && /stop|unsubscribe|opt[\s_-]?out|promotion/i.test(reply.title)) return true
  }

  // Some payloads carry an explicit marketing opt-out marker.
  if (message.marketing_opt_out === true) return true

  return false
}

// Meta timestamps are unix seconds (string). Fall back to now on a bad value.
function metaTsToDate(ts: unknown): Date {
  const n = typeof ts === 'string' ? parseInt(ts, 10) : typeof ts === 'number' ? ts : NaN
  return Number.isFinite(n) ? new Date(n * 1000) : new Date()
}

function extractText(message: Record<string, unknown>): string {
  const text = (message.text as { body?: string } | undefined)?.body
  if (typeof text === 'string') return text
  const button = message.button as { text?: string } | undefined
  if (button?.text) return button.text
  const interactive = message.interactive as { button_reply?: { title?: string } } | undefined
  if (interactive?.button_reply?.title) return interactive.button_reply.title
  return ''
}

// ─── Event processors ────────────────────────────────────────────────────────

async function processStatuses(statuses: Array<Record<string, unknown>>): Promise<void> {
  for (const s of statuses) {
    const wamid = s.id as string | undefined
    const metaStatus = s.status as string | undefined
    if (!wamid || !metaStatus) continue

    const message = await prisma.message.findUnique({
      where: { providerMessageId: wamid },
      select: { id: true, status: true },
    })
    if (!message) continue // unknown wamid — nothing to update

    const update = buildStatusUpdate({ status: message.status }, metaStatus, metaTsToDate(s.timestamp))
    if (!update || Object.keys(update).length === 0) continue

    // Capture Meta error code/title on failure.
    if (metaStatus === 'failed') {
      const errors = s.errors as Array<{ code?: number; title?: string }> | undefined
      const err = errors?.[0]
      if (err?.code !== undefined) update.errorCode = String(err.code)
      if (err?.title) update.errorTitle = err.title
    }

    await prisma.message.update({ where: { id: message.id }, data: update })
  }
}

async function processInbound(messages: Array<Record<string, unknown>>): Promise<void> {
  for (const m of messages) {
    const from = m.from as string | undefined
    if (!from) continue

    // Resolve the customer by phone. NOTE: with a single app-level WhatsApp number
    // (no per-merchant phone_number_id in the frozen schema), we attribute inbound
    // to the first customer matching this phone. Documented limitation for this phase.
    const customer = await prisma.customer.findFirst({
      where: { phone: from },
      select: { id: true, merchantId: true },
    })
    if (!customer) continue // cannot persist without a merchant; logged-and-dropped

    const wamid = m.id as string | undefined
    await prisma.message.create({
      data: {
        merchantId: customer.merchantId,
        customerId: customer.id,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        ...(wamid !== undefined && { providerMessageId: wamid }),
        status: 'RECEIVED',
        body: extractText(m),
        toPhone: '',
        fromPhone: from,
      },
    })

    if (isOptOutMessage(m)) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { isSubscribedWhatsapp: false },
      })
    }
    // lane:wa-conversation START — route non-STOP inbound to the two-way conversation engine (guide §7.2).
    // Dynamic import keeps the queue-backed engine out of this route's static graph so the
    // Channels-lane webhook unit tests (which don't mock @engageiq/queue) stay isolated.
    else {
      try {
        const { dispatchInbound } = await import('../../services/conversation.service.js')
        await dispatchInbound({
          merchantId: customer.merchantId,
          customerId: customer.id,
          phone: from,
          text: extractText(m),
        })
      } catch (err) {
        // The engine must never break webhook processing — Meta always receives a 200.
        console.error('[whatsapp-webhook] conversation dispatch error', err)
      }
    }
    // lane:wa-conversation END
  }
}

// Walk the Meta webhook envelope: entry[].changes[].value.{statuses,messages}.
export async function processWebhookBody(body: Record<string, unknown>): Promise<void> {
  const entries = (body.entry as Array<Record<string, unknown>> | undefined) ?? []
  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? []
    for (const change of changes) {
      const value = (change.value as Record<string, unknown> | undefined) ?? {}
      const statuses = value.statuses as Array<Record<string, unknown>> | undefined
      const messages = value.messages as Array<Record<string, unknown>> | undefined
      if (statuses?.length) await processStatuses(statuses)
      if (messages?.length) await processInbound(messages)
    }
  }
}

// ─── Route ─────────────────────────────────────────────────────────────────

async function whatsappWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Verification handshake.
  fastify.get('/whatsapp', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>
    const mode = q['hub.mode']
    const token = q['hub.verify_token']
    const challenge = q['hub.challenge']
    if (mode === 'subscribe' && token && token === env.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.status(200).type('text/plain').send(challenge ?? '')
    }
    return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Verification failed' } })
  })

  // Inbound events (status + messages).
  fastify.post('/whatsapp', {
    config: { rawBody: true },
    handler: async (request, reply) => {
      const rawBodyBuf = request.rawBody
      const signature = request.headers['x-hub-signature-256'] as string | undefined

      // HMAC verification (only enforced when a secret is configured).
      if (env.META_APP_SECRET) {
        if (!rawBodyBuf || !Buffer.isBuffer(rawBodyBuf)) {
          return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing raw body' } })
        }
        if (!verifyMetaSignature(rawBodyBuf, signature, env.META_APP_SECRET)) {
          return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid signature' } })
        }
      }

      // Defensive: never let a malformed payload 500 — always 200 so Meta keeps delivering.
      try {
        await processWebhookBody((request.body as Record<string, unknown>) ?? {})
      } catch (err) {
        request.log.error({ err }, '[whatsapp-webhook] processing error')
      }
      return reply.status(200).send({ ok: true })
    },
  })
}

export default whatsappWebhookRoutes
