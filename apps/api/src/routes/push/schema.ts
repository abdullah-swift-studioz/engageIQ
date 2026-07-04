// apps/api/src/routes/push/schema.ts
import { z } from 'zod'

// A browser Web Push subscription as produced by PushManager.subscribe().toJSON().
export const webPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
})

// POST /api/v1/push/subscribe — storefront registers a browser for push.
// Must carry at least one way to attach to a customer: anon_id (SDK cookie) or customer_id.
export const subscribeSchema = z.object({
  merchant_id: z.string().min(1),
  anon_id: z.string().uuid().optional(),
  customer_id: z.string().min(1).optional(),
  subscription: webPushSubscriptionSchema,
  user_agent: z.string().max(512).optional(),
})

// POST /api/v1/push/unsubscribe — browser-side unsubscribe (or permission revoked).
export const unsubscribeSchema = z.object({
  merchant_id: z.string().min(1),
  endpoint: z.string().url().max(2048),
})

// POST /api/v1/push/test — authenticated operator test send (merchant from the JWT).
export const testSendSchema = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  url: z.string().url().max(2048).optional(),
  icon: z.string().url().max(2048).optional(),
  pushSubscriptionId: z.string().min(1).optional(),
})
