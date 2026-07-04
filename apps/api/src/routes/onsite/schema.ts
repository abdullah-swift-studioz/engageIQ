import { z } from 'zod'

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

export const OnSiteTypeSchema = z.enum(['POPUP', 'STICKY_BAR', 'EMBED'])
export const OnSiteStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'])
export const OnSiteTriggerSchema = z.enum([
  'new_visitor',
  'exit_intent',
  'timed',
  'cart_value',
  'product_view_restock',
])
export const OnSiteFrequencySchema = z.enum([
  'always',
  'once_per_session',
  'once_per_day',
  'once_ever',
])
export const OnSitePositionSchema = z.enum([
  'center',
  'top',
  'bottom',
  'bottom_left',
  'bottom_right',
])

export const OnSiteConfigSchema = z.object({
  headline: z.string().max(300).optional(),
  body: z.string().max(2000).optional(),
  ctaText: z.string().max(120).optional(),
  ctaUrl: z.string().max(2048).optional(),
  captureEmail: z.boolean().optional(),
  incentiveCode: z.string().max(120).optional(),
  position: OnSitePositionSchema.optional(),
  imageUrl: z.string().max(2048).optional(),
  dismissible: z.boolean().optional(),
  embedSelector: z.string().max(300).optional(),
})

export const OnSiteDisplayRulesSchema = z
  .object({
    trigger: OnSiteTriggerSchema,
    timedDelaySeconds: z.number().int().min(0).max(3600).optional(),
    cartValueThreshold: z.number().min(0).optional(),
    pagePattern: z.string().max(300).optional(),
    frequency: OnSiteFrequencySchema.optional(),
  })
  .superRefine((rules, ctx) => {
    if (rules.trigger === 'timed' && rules.timedDelaySeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'timedDelaySeconds is required when trigger is "timed"',
        path: ['timedDelaySeconds'],
      })
    }
    if (rules.trigger === 'cart_value' && rules.cartValueThreshold === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cartValueThreshold is required when trigger is "cart_value"',
        path: ['cartValueThreshold'],
      })
    }
  })

// ─── Element CRUD ─────────────────────────────────────────────────────────────

export const CreateElementBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: OnSiteTypeSchema,
  config: OnSiteConfigSchema,
  displayRules: OnSiteDisplayRulesSchema,
  segmentId: z.string().cuid().nullable().optional(),
  status: OnSiteStatusSchema.optional(),
  priority: z.number().int().nullable().optional(),
})

export const UpdateElementBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: OnSiteTypeSchema.optional(),
  config: OnSiteConfigSchema.optional(),
  displayRules: OnSiteDisplayRulesSchema.optional(),
  segmentId: z.string().cuid().nullable().optional(),
  status: OnSiteStatusSchema.optional(),
  priority: z.number().int().nullable().optional(),
})

export const ElementParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListElementsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: OnSiteStatusSchema.optional(),
  type: OnSiteTypeSchema.optional(),
})

// ─── A/B test ─────────────────────────────────────────────────────────────────

export const AbVariantSchema = z.object({
  name: z.string().min(1).max(120),
  config: OnSiteConfigSchema,
  allocationPct: z.number().min(0).max(100),
})

export const CreateAbTestBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    winnerMetric: z.enum(['conversion_rate', 'impressions', 'conversions']).default('conversion_rate'),
    variants: z.array(AbVariantSchema).min(2).max(4),
  })
  .superRefine((body, ctx) => {
    const sum = body.variants.reduce((acc, v) => acc + v.allocationPct, 0)
    if (Math.round(sum) !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `variant allocations must sum to 100 (got ${sum})`,
        path: ['variants'],
      })
    }
  })

export const AbTestParamsSchema = z.object({
  id: z.string().cuid(),
  testId: z.string().cuid(),
})

export const DecideAbTestBodySchema = z.object({
  winnerVariantId: z.string().min(1),
})

// ─── Public delivery ──────────────────────────────────────────────────────────

export const DeliveryBodySchema = z.object({
  merchantId: z.string().min(1),
  anonId: z.string().min(1),
  customerId: z.string().nullable().optional(),
  pagePath: z.string().max(2048).optional(),
  cartValue: z.number().min(0).optional(),
  viewedProductIds: z.array(z.string().max(100)).max(200).optional(),
})

export type CreateElementBody = z.infer<typeof CreateElementBodySchema>
export type UpdateElementBody = z.infer<typeof UpdateElementBodySchema>
export type ListElementsQuery = z.infer<typeof ListElementsQuerySchema>
export type CreateAbTestBody = z.infer<typeof CreateAbTestBodySchema>
export type DeliveryBody = z.infer<typeof DeliveryBodySchema>
