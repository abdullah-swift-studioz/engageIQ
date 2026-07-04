import { z } from 'zod'

// Template keys are stable snake_case identifiers (e.g. "abandoned_cart_whatsapp_first").
export const FlowKeyParamsSchema = z.object({
  key: z.string().min(1).max(100),
})

export type FlowKeyParams = z.infer<typeof FlowKeyParamsSchema>
