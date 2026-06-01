import { z } from 'zod'

export const CustomEventBodySchema = z.object({
  event_name: z.string().min(1).max(100),
  customer_id: z.string().cuid().optional(),
  anon_id: z.string().uuid().optional(),
  properties: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime({ offset: true }).optional(),
})

export type CustomEventBody = z.infer<typeof CustomEventBodySchema>
