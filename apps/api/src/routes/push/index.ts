// apps/api/src/routes/push/index.ts
//
// Web Push HTTP surface (mounted at /api/v1/push):
//   GET  /vapid-public-key   public  — the SDK fetches this to subscribe a browser
//   POST /subscribe          public  — register a browser Web Push subscription
//   POST /unsubscribe        public  — deactivate a subscription (browser-side unsubscribe)
//   GET  /eiq-sw.js          public  — serve the built service worker (dev convenience)
//   POST /test               JWT     — operator test send (merchant resolved from the token)
//
// The public endpoints mirror the storefront SDK routes: unauthenticated, identified by
// merchant_id in the body, CORS-open (handled globally), rate-limited.
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '@engageiq/db'
import { pushSendQueue } from '@engageiq/queue'
import { PUSH_SEND } from '@engageiq/shared'
import type { PushSendJob } from '@engageiq/shared'
import { getVapidPublicKey } from '../../services/push/vapid.js'
import {
  resolveSubscriberCustomerId,
  registerSubscription,
  deactivateByEndpoint,
} from '../../services/push/subscription.service.js'
import { subscribeSchema, unsubscribeSchema, testSendSchema } from './schema.js'

// The service worker is built by the SDK package to dist/eiq-sw.js. This file lives at
// apps/api/src/routes/push/index.ts → repo root is 5 levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SW_FILE_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'sdk', 'dist', 'eiq-sw.js')

const pushRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // ── GET /vapid-public-key ────────────────────────────────────────────────
  fastify.get('/vapid-public-key', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const publicKey = getVapidPublicKey()
    if (!publicKey) {
      return reply.status(503).send({ success: false, error: { code: 'PUSH_NOT_CONFIGURED', message: 'Web Push is not configured' } })
    }
    return reply.status(200).send({ success: true, data: { publicKey } })
  })

  // ── GET /eiq-sw.js — serve the service worker (dev/simple deployments) ─────
  // NOTE: a service worker only controls the ORIGIN it is served from. In production the
  // SW must be hosted on the storefront domain (e.g. via a Shopify app proxy); serving it
  // from the API origin here is for local testing on the same origin.
  fastify.get('/eiq-sw.js', { config: { rateLimit: { max: 500, timeWindow: '1 minute' } } }, async (_req, reply) => {
    if (!existsSync(SW_FILE_PATH)) {
      return reply.status(503).send('Service worker not built. Run: pnpm --filter @engageiq/sdk build')
    }
    const content = await readFile(SW_FILE_PATH, 'utf-8')
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Service-Worker-Allowed', '/')
      .header('Cache-Control', 'public, max-age=3600')
      .send(content)
  })

  // ── POST /subscribe ───────────────────────────────────────────────────────
  fastify.post('/subscribe', { config: { rateLimit: { max: 100, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply) => {
    const parsed = subscribeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid subscription payload', details: parsed.error.flatten().fieldErrors } })
    }
    const data = parsed.data
    if (!data.anon_id && !data.customer_id) {
      return reply.status(400).send({ success: false, error: { code: 'NO_IDENTIFIER', message: 'Provide anon_id or customer_id' } })
    }

    // Verify the merchant exists (return 200 with subscribed:false to avoid fingerprinting).
    const merchant = await prisma.merchant.findUnique({ where: { id: data.merchant_id }, select: { id: true } })
    if (!merchant) return reply.status(200).send({ success: true, data: { subscribed: false, reason: 'unknown_merchant' } })

    const customerId = await resolveSubscriberCustomerId(data.merchant_id, {
      ...(data.anon_id ? { anonId: data.anon_id } : {}),
      ...(data.customer_id ? { customerId: data.customer_id } : {}),
    })
    if (!customerId) {
      return reply.status(200).send({ success: true, data: { subscribed: false, reason: 'no_customer' } })
    }

    const row = await registerSubscription({
      merchantId: data.merchant_id,
      customerId,
      subscription: data.subscription,
      userAgent: data.user_agent ?? request.headers['user-agent'] ?? null,
    })
    return reply.status(201).send({ success: true, data: { subscribed: true, subscriptionId: row.id } })
  })

  // ── POST /unsubscribe ─────────────────────────────────────────────────────
  fastify.post('/unsubscribe', { config: { rateLimit: { max: 100, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid payload', details: parsed.error.flatten().fieldErrors } })
    }
    const count = await deactivateByEndpoint(parsed.data.merchant_id, parsed.data.endpoint)
    return reply.status(200).send({ success: true, data: { deactivated: count } })
  })

  // ── POST /test — authenticated operator test send ─────────────────────────
  fastify.post('/test', { onRequest: fastify.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply) => {
    const parsed = testSendSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid payload', details: parsed.error.flatten().fieldErrors } })
    }
    const merchantId = request.user!.merchantId
    // Verify the customer belongs to the caller's merchant (tenant safety).
    const customer = await prisma.customer.findFirst({ where: { id: parsed.data.customerId, merchantId }, select: { id: true } })
    if (!customer) {
      return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } })
    }
    const job: PushSendJob = {
      type: 'send',
      merchantId,
      customerId: parsed.data.customerId,
      title: parsed.data.title,
      body: parsed.data.body,
      ...(parsed.data.url ? { url: parsed.data.url } : {}),
      ...(parsed.data.icon ? { icon: parsed.data.icon } : {}),
      ...(parsed.data.pushSubscriptionId ? { pushSubscriptionId: parsed.data.pushSubscriptionId } : {}),
    }
    await pushSendQueue.add(PUSH_SEND, job)
    return reply.status(202).send({ success: true, data: { enqueued: true } })
  })

  // CORS preflight for the storefront-called endpoints.
  for (const p of ['/subscribe', '/unsubscribe']) {
    fastify.options(p, { config: { rateLimit: false } }, (_req, reply) =>
      reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type')
        .status(204)
        .send(),
    )
  }
}

export default pushRoutes
