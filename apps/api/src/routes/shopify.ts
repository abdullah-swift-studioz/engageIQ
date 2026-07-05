import crypto from 'crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type { ShopifyWebhookJob } from '@engageiq/shared'
import { webhookIngestionQueue, backfillQueue, redisConnection } from '@engageiq/queue'
import {
  buildInstallUrl,
  exchangeCodeForToken,
  registerWebhooks,
  validateHmac,
  validateWebhookHmac,
} from '../services/shopify.service.js'

const shopDomainSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/, 'Invalid Shopify domain')

const installQuerySchema = z.object({
  shop: shopDomainSchema,
})

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  hmac: z.string().min(1),
  shop: shopDomainSchema,
  state: z.string().min(1),
  timestamp: z.string().min(1),
})

async function shopifyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/install', async (request, reply) => {
    const parsed = installQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }

    const { shop } = parsed.data

    if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_SCOPES || !env.SHOPIFY_APP_URL) {
      return reply.status(503).send({ error: 'Shopify integration not configured' })
    }

    const state = crypto.randomBytes(16).toString('hex')
    await redisConnection.set(`oauth_state:${state}`, shop, 'EX', 600)

    const installUrl = buildInstallUrl(shop, state)
    return reply.redirect(installUrl)
  })

  fastify.get('/callback', async (request, reply) => {
    const parsed = callbackQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }

    const { code, shop, state, timestamp } = parsed.data
    // HMAC must be computed over the FULL raw query Shopify sent (including `host`
    // and any future params), not the Zod-whitelisted subset — otherwise the
    // reconstructed message is missing params and the signature never matches.
    const allParams = request.query as Record<string, string>

    if (!env.SHOPIFY_API_SECRET || !env.SHOPIFY_APP_URL) {
      return reply.status(503).send({ error: 'Shopify integration not configured' })
    }

    if (!validateHmac(allParams, env.SHOPIFY_API_SECRET)) {
      return reply.status(401).send({ error: 'Invalid HMAC signature' })
    }

    const storedShop = await redisConnection.get(`oauth_state:${state}`)
    if (!storedShop || storedShop !== shop) {
      return reply.status(401).send({ error: 'Invalid or expired OAuth state' })
    }

    await redisConnection.del(`oauth_state:${state}`)

    const nowSeconds = Math.floor(Date.now() / 1000)
    if (nowSeconds - parseInt(timestamp, 10) > 300) {
      return reply.status(401).send({ error: 'OAuth request expired' })
    }

    const { access_token: shopifyAccessToken, scope: shopifyScope } =
      await exchangeCodeForToken(shop, code)

    const merchant = await prisma.merchant.upsert({
      where: { shopifyDomain: shop },
      update: {
        shopifyAccessToken,
        shopifyScope,
        shopifyInstalledAt: new Date(),
        shopifyUninstalledAt: null,
      },
      create: {
        name: shop,
        shopifyDomain: shop,
        shopifyAccessToken,
        shopifyScope,
        shopifyInstalledAt: new Date(),
      },
      select: { id: true, backfillCompletedAt: true },
    })

    await registerWebhooks(shop, shopifyAccessToken, env.SHOPIFY_APP_URL)

    // Trigger historical backfill on first install (or if it never completed)
    if (!merchant.backfillCompletedAt) {
      await backfillQueue.add('backfill', { merchantId: merchant.id }, { jobId: merchant.id })
    }

    return reply.redirect('/dashboard')
  })

  fastify.post('/webhooks/:topic', {
    config: { rawBody: true },
    handler: async (request, reply) => {
      const hmacHeader = request.headers['x-shopify-hmac-sha256'] as string | undefined
      const shopDomain = request.headers['x-shopify-shop-domain'] as string | undefined
      const topic = request.headers['x-shopify-topic'] as string | undefined

      if (!hmacHeader || !shopDomain || !topic) {
        return reply.status(401).send({ error: 'Missing required Shopify headers' })
      }

      const rawBodyBuf = request.rawBody
      if (!rawBodyBuf || !Buffer.isBuffer(rawBodyBuf)) {
        return reply.status(400).send({ error: 'Missing raw body' })
      }

      if (!env.SHOPIFY_API_SECRET || !validateWebhookHmac(rawBodyBuf, hmacHeader, env.SHOPIFY_API_SECRET)) {
        return reply.status(401).send({ error: 'Invalid webhook HMAC' })
      }

      const merchant = await prisma.merchant.findUnique({
        where: { shopifyDomain: shopDomain },
        select: { id: true },
      })

      if (!merchant) {
        return reply.status(404).send({ error: 'Merchant not found' })
      }

      const shopifyWebhookId =
        (request.headers['x-shopify-webhook-id'] as string | undefined) ?? crypto.randomUUID()

      const job: ShopifyWebhookJob = {
        shop: shopDomain,
        topic,
        payload: request.body,
        shopifyWebhookId,
        receivedAt: new Date().toISOString(),
        merchantId: merchant.id,
      }

      await webhookIngestionQueue.add(topic, job, {
        jobId: shopifyWebhookId,
      })

      return reply.status(200).send({ ok: true })
    },
  })

  fastify.get('/app-embed', async (_request, reply) => {
    return reply.send({ status: 'ok', version: '1.0.0', sdk: 'pending' })
  })
}

export default shopifyRoutes
