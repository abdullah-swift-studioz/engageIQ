import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),

  CLICKHOUSE_URL: z.string().url().default('http://localhost:8123'),
  CLICKHOUSE_DATABASE: z.string().default('engageiq'),
  CLICKHOUSE_USER: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().default(''),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('1h'),

  SHOPIFY_API_KEY: z.string().min(1).optional(),
  SHOPIFY_API_SECRET: z.string().min(1).optional(),
  SHOPIFY_SCOPES: z.string().min(1).optional(),
  SHOPIFY_APP_URL: z.string().url().optional(),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SES_FROM_EMAIL: z.string().email().optional(),

  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // lane:channels START
  // Meta App Secret — HMAC-verifies inbound WhatsApp webhook signatures (X-Hub-Signature-256).
  // Optional so the app boots credential-free; the webhook rejects unsigned payloads only when set.
  META_APP_SECRET: z.string().optional(),
  // Graph API version for WhatsApp Cloud API calls. Never hardcode the version in a URL string.
  META_API_VERSION: z.string().default('v21.0'),
  // WhatsApp Business Account (WABA) id — required ONLY to submit templates to Meta for approval.
  // Absent → template submit sets status=PENDING locally (offline-testable flow) without an API call.
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  // lane:channels END

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  PK_SMS_API_KEY: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),

  SENTRY_DSN: z.string().url().optional().or(z.literal('')).optional(),

  // lane:ml START
  // Base URL of the Python FastAPI ML microservice the scoring worker calls.
  ML_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  // Per-request timeout (ms) for ML service calls.
  ML_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // Cron for the daily RFM/churn/LTV/fake-order/recommendations run.
  ML_SCORING_CRON: z.string().default('0 3 * * *'),
  // Cron for the weekly AI segment-discovery run.
  ML_SEGMENT_DISCOVERY_CRON: z.string().default('0 4 * * 0'),
  // Set false to skip auto-registering the repeatable scoring schedulers on worker boot.
  ML_SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // lane:ml END
  // lane:push START
  // VAPID keypair for the self-hosted Web Push Protocol. Generate once with:
  //   npx web-push generate-vapid-keys   (or: node -e "console.log(require('web-push').generateVAPIDKeys())")
  // Both optional so the app boots credential-free; the PushAdapter returns a clean
  // "push not configured" until both are set. The PUBLIC key is safe to expose to browsers
  // (the SDK fetches it to subscribe); the PRIVATE key must stay server-side only.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Contact URI Meta/push services use to reach you about your pushes — a mailto: or https: URL.
  VAPID_SUBJECT: z.string().default('mailto:push@engageiq.app'),
  // lane:push END
})

const result = schema.safeParse(process.env)

if (!result.success) {
  const errors = result.error.flatten().fieldErrors
  const missing = Object.entries(errors)
    .map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
    .join('\n')
  console.error(`[env] Invalid environment variables:\n${missing}`)
  process.exit(1)
}

export const env = result.data
export type Env = typeof env
