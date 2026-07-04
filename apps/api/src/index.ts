import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
import rawBody from 'fastify-raw-body'
import { env } from '@engageiq/shared'
import jwtPlugin from './plugins/jwt.js'
import authenticatePlugin from './plugins/authenticate.js'
import apiKeyPlugin from './plugins/api-key.js'
import authRoutes from './routes/auth.js'
import shopifyRoutes from './routes/shopify.js'
import backfillRoutes from './routes/backfill.js'
import sdkRoutes from './routes/sdk.js'
import customersRoutes from './routes/customers/index.js'
import eventsRoutes from './routes/events/index.js'
import segmentsRoutes from './routes/segments/index.js'
import journeysRoutes from './routes/journeys/index.js'
// lane:channels START
import whatsappTemplatesRoutes from './routes/whatsapp-templates/index.js'
import messagesRoutes from './routes/messages/index.js'
import whatsappWebhookRoutes from './routes/webhooks/whatsapp.js'
// lane:channels END
// lane:analytics START
import analyticsRoutes from './routes/analytics/index.js'
// lane:analytics END
// lane:ml START
import recommendationsRoutes from './routes/recommendations/index.js'
// lane:ml END
// lane:campaigns START
import campaignsRoutes from './routes/campaigns/index.js'
// lane:campaigns END
// lane:copywriter START
import aiRoutes from './routes/ai/index.js'
// lane:copywriter END
// lane:push START
import pushRoutes from './routes/push/index.js'
// lane:push END
// lane:courier START
import couriersRoutes from './routes/couriers/index.js'
// lane:courier END
// lane:public-api START
import settingsRoutes from './routes/settings/index.js'
import publicApiRoutes from './routes/public/index.js'
// lane:public-api END
// lane:onsite START
import onsiteRoutes from './routes/onsite/index.js'
// lane:onsite END
// lane:sms START
import smsWebhookRoutes from './routes/webhooks/sms.js'
// lane:sms END
// lane:email START
import emailTemplatesRoutes from './routes/email-templates/index.js'
import sendingDomainsRoutes from './routes/sending-domains/index.js'
import emailTrackingRoutes from './routes/email/tracking.js'
// lane:email END
// lane:wa-conversation START
import conversationsRoutes from './routes/conversations/index.js'
// lane:wa-conversation END
// lane:ai-wiring START
import clustersRoutes from './routes/clusters/index.js'
// lane:ai-wiring END
// lane:rbac START
// settingsRoutes is imported above (public-api); the merged settings plugin serves both the
// API-keys/webhooks routes and the team/roles routes, so it is imported and registered once.
import agencyRoutes from './routes/agency/index.js'
import { actingMerchantPreHandler } from './services/agency/index.js'
// lane:rbac END
// lane:cod-verify START
import verificationsRoutes from './routes/verifications/index.js'
// lane:cod-verify END
// lane:flows START
import flowLibraryRoutes from './routes/flow-library/index.js'
// lane:flows END

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    serializers: {
      req(req) {
        return { method: req.method, url: req.url }
      },
    },
  },
  trustProxy: true,
  requestIdLogLabel: 'requestId',
  genReqId: () => crypto.randomUUID(),
})

await app.register(helmet)
await app.register(cors, {
  // SDK endpoints are called cross-origin from Shopify storefronts
  origin: (origin, cb) => {
    // Allow all origins in development; in production, Shopify stores are
    // on *.myshopify.com or custom domains — we allow all since the SDK
    // endpoints are public and rate-limited.
    cb(null, true)
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})
await app.register(sensible)
await app.register(rawBody, {
  global: false,
  encoding: false,
  runFirst: true,
})
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
})
await app.register(jwtPlugin)
await app.register(authenticatePlugin)
await app.register(apiKeyPlugin)
// lane:rbac START — global acting-merchant re-scope for agency account switching (guide §9.4).
// Registered BEFORE the route groups so it applies to all of them. Runs as a preHandler
// (after every group's authenticate onRequest hook), gated: no-op unless an agency user
// sends a verified x-acting-merchant-id header. See services/agency/acting-merchant.hook.ts.
app.addHook('preHandler', actingMerchantPreHandler)
// lane:rbac END
await app.register(authRoutes, { prefix: '/auth' })
await app.register(shopifyRoutes, { prefix: '/shopify' })
await app.register(backfillRoutes, { prefix: '/backfill' })
await app.register(sdkRoutes)
await app.register(customersRoutes, { prefix: '/api/v1/customers' })
await app.register(eventsRoutes, { prefix: '/api/v1/events' })
await app.register(segmentsRoutes, { prefix: '/api/v1/segments' })
await app.register(journeysRoutes, { prefix: '/api/v1/journeys' })
// lane:channels START
await app.register(whatsappTemplatesRoutes, { prefix: '/api/v1/whatsapp-templates' })
await app.register(messagesRoutes, { prefix: '/api/v1/messages' })
await app.register(whatsappWebhookRoutes, { prefix: '/webhooks' })
// lane:channels END
// lane:analytics START
await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' })
// lane:analytics END
// lane:ml START
await app.register(recommendationsRoutes, { prefix: '/api/v1/recommendations' })
// lane:ml END
// lane:campaigns START
await app.register(campaignsRoutes, { prefix: '/api/v1/campaigns' })
// lane:campaigns END
// lane:copywriter START
await app.register(aiRoutes, { prefix: '/api/v1/ai' })
// lane:copywriter END
// lane:push START
await app.register(pushRoutes, { prefix: '/api/v1/push' })
// lane:push END
// lane:courier START
await app.register(couriersRoutes, { prefix: '/api/v1/couriers' })
// lane:courier END
// lane:public-api START
await app.register(settingsRoutes, { prefix: '/api/v1/settings' })
await app.register(publicApiRoutes, { prefix: '/api/v1/public' })
// lane:public-api END
// lane:onsite START
await app.register(onsiteRoutes, { prefix: '/api/v1/onsite' })
// lane:onsite END
// lane:sms START
// Twilio delivery-status + inbound STOP webhook (POST /webhooks/sms). Shares the
// /webhooks prefix with the WhatsApp webhook; distinct path so no route collision.
await app.register(smsWebhookRoutes, { prefix: '/webhooks' })
// lane:sms END
// lane:email START
await app.register(emailTemplatesRoutes, { prefix: '/api/v1/email-templates' })
await app.register(sendingDomainsRoutes, { prefix: '/api/v1/sending-domains' })
await app.register(emailTrackingRoutes, { prefix: '/email' })
// lane:email END
// lane:wa-conversation START
await app.register(conversationsRoutes, { prefix: '/api/v1/conversations' })
// lane:wa-conversation END
// lane:ai-wiring START
await app.register(clustersRoutes, { prefix: '/api/v1/clusters' })
// lane:ai-wiring END
// lane:rbac START
// settingsRoutes registered above (public-api); the merged plugin serves team/roles too.
await app.register(agencyRoutes, { prefix: '/api/v1/agency' })
// lane:rbac END
// lane:cod-verify START
await app.register(verificationsRoutes, { prefix: '/api/v1/verifications' })
// lane:cod-verify END
// lane:flows START
await app.register(flowLibraryRoutes, { prefix: '/api/v1/flow-library' })
// lane:flows END

app.get('/health', () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  environment: env.NODE_ENV,
}))

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
