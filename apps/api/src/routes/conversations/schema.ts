import { z } from 'zod'

// state filter mirrors the WhatsAppConversationState enum.
export const ConversationStateSchema = z.enum(['OPEN', 'AWAITING_REPLY', 'CLOSED', 'EXPIRED'])

export const ListConversationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(30),
  state: ConversationStateSchema.optional(),
})

// NOTE: id is validated as a non-empty string, NOT .cuid() — the seed/demo data has historically
// used non-cuid ids, and .cuid() would 400 those rows (known project gotcha).
export const ConversationParamsSchema = z.object({
  id: z.string().min(1),
})

export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>
export type ConversationParams = z.infer<typeof ConversationParamsSchema>
