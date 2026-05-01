import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma, insertEvents } from '@engageiq/db'
import type { EngageIQEvent } from '@engageiq/db'
import { stitchIdentity } from '../services/identity.service.js'
import { syncSessionCount } from '../services/profile-sync.service.js'

// Resolve path to the pre-built SDK file relative to this source file.
// In dev (tsx): __dirname = apps/api/src/routes/
// Monorepo root is 4 levels up, then packages/sdk/dist/engageiq.min.js
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SDK_FILE_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'sdk', 'dist', 'engageiq.min.js')

// ─── Validation Schemas ───────────────────────────────────────────────────────

const sdkEventSchema = z.object({
  event_name: z.string().min(1).max(100),
  anon_id: z.string().uuid(),
  customer_id: z.string().nullable().optional(),
  session_id: z.string().min(1).max(100),
  merchant_id: z.string().min(1),
  page_url: z.string().max(2048).optional(),
  properties: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime({ offset: true }),
})

const sdkEventBatchSchema = z.object({
  events: z.array(sdkEventSchema).min(1).max(50),
})

const identifySchema = z.object({
  merchant_id: z.string().min(1),
  anon_id: z.string().uuid(),
  email: z.string().email().optional(),
  phone: z.string().min(7).max(20).optional(),
  shopify_customer_id: z.string().optional(),
})

// ─── SDK Routes ───────────────────────────────────────────────────────────────

export default function sdkRoutes(fastify: FastifyInstance): void {
  // ── GET /sdk.js — serve the JavaScript SDK file ───────────────────────────
  // In production this would be served from a CDN. The API serves it directly
  // for local dev and simple deployments.
  fastify.get(
    '/sdk.js',
    {
      config: {
        // Allow higher rate for SDK file requests (static asset behaviour)
        rateLimit: { max: 500, timeWindow: '1 minute' },
      },
    },
    async (_request, reply) => {
      if (!existsSync(SDK_FILE_PATH)) {
        return reply.status(503).send('SDK not built. Run: pnpm --filter @engageiq/sdk build')
      }
      const content = await readFile(SDK_FILE_PATH, 'utf-8')
      // Access-Control-Allow-Origin is set globally by @fastify/cors — do not duplicate it here.
      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
        .send(content)
    },
  )

  // ── POST /v1/sdk/events — batch event ingestion ───────────────────────────
  // Unauthenticated public endpoint; identified by merchant_id in the payload.
  // Rate-limited more tightly on this IP-based limit to prevent abuse.
  fastify.post(
    '/v1/sdk/events',
    {
      config: {
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest, reply) => {
      const parsed = sdkEventBatchSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid payload', details: parsed.error.flatten().fieldErrors })
      }

      const { events } = parsed.data

      // All events in a batch must belong to the same merchant
      const merchantId = events[0]!.merchant_id
      if (events.some((e) => e.merchant_id !== merchantId)) {
        return reply.status(400).send({ error: 'All events must belong to the same merchant' })
      }

      // Verify merchant exists to prevent data poisoning from unknown merchant IDs
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { id: true },
      })
      if (!merchant) {
        // Return 200 to avoid fingerprinting valid merchant IDs
        return reply.status(200).send({ received: 0 })
      }

      // Build ClickHouse event objects
      const clickhouseEvents: EngageIQEvent[] = events.map((e) => ({
        event_id: crypto.randomUUID(),
        merchant_id: e.merchant_id,
        customer_id: e.customer_id ?? null,
        anon_id: e.anon_id,
        event_type: e.event_name,
        properties: e.properties,
        session_id: e.session_id,
        page_url: e.page_url ?? null,
        ip: getClientIp(request),
        user_agent: request.headers['user-agent'] ?? null,
        timestamp: new Date(e.timestamp),
      }))

      // Fire-and-forget insert (async_insert = 1 in ClickHouse client config)
      await insertEvents(clickhouseEvents)

      // Update lastSeenAt for known customers (best-effort, non-blocking)
      const knownCustomerIds = [
        ...new Set(events.map((e) => e.customer_id).filter((id): id is string => !!id)),
      ]
      if (knownCustomerIds.length > 0) {
        // Don't await — we don't want this to block the response
        prisma.customer
          .updateMany({
            where: { merchantId, id: { in: knownCustomerIds } },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => {/* best-effort */})

        // Sync session count for each known customer — fire and forget
        for (const customerId of knownCustomerIds) {
          prisma.customer
            .findFirst({
              where: { id: customerId, merchantId },
              select: { anonIds: true },
            })
            .then((cust) => {
              if (cust) {
                syncSessionCount(merchantId, customerId, cust.anonIds).catch(
                  (err: unknown) => fastify.log.error({ err }, 'syncSessionCount failed'),
                )
              }
            })
            .catch(() => {/* best-effort */})
        }
      }

      return reply.status(200).send({ received: events.length })
    },
  )

  // ── POST /v1/sdk/identify — link anon_id to a known customer ─────────────
  fastify.post(
    '/v1/sdk/identify',
    {
      config: {
        rateLimit: { max: 200, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest, reply) => {
      const parsed = identifySchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid payload', details: parsed.error.flatten().fieldErrors })
      }

      const data = parsed.data

      // At least one identifier required beyond anon_id
      if (!data.email && !data.phone && !data.shopify_customer_id) {
        return reply.status(400).send({ error: 'Provide at least one identifier: email, phone, or shopify_customer_id' })
      }

      const result = await stitchIdentity(data)

      return reply.status(200).send({
        customerId: result.customerId,
        isNewCustomer: result.isNewCustomer,
      })
    },
  )

  // ── CORS preflight for SDK endpoints (called cross-origin from storefront) ─
  fastify.options('/v1/sdk/events', { config: { rateLimit: false } }, (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .status(204)
      .send()
  })

  fastify.options('/v1/sdk/identify', { config: { rateLimit: false } }, (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .status(204)
      .send()
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(request: FastifyRequest): string | null {
  // Fastify with trustProxy: true populates request.ip correctly
  return request.ip ?? null
}
