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
await app.register(authRoutes, { prefix: '/auth' })
await app.register(shopifyRoutes, { prefix: '/shopify' })
await app.register(backfillRoutes, { prefix: '/backfill' })
await app.register(sdkRoutes)
await app.register(customersRoutes, { prefix: '/api/v1/customers' })
await app.register(eventsRoutes, { prefix: '/api/v1/events' })
await app.register(segmentsRoutes, { prefix: '/api/v1/segments' })

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
