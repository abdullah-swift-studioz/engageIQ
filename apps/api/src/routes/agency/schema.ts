import { z } from 'zod'

export const SwitchBodySchema = z.object({
  merchantId: z.string().min(1),
})

export const AssignmentBodySchema = z.object({
  userId: z.string().min(1),
  childMerchantId: z.string().min(1),
})

export const ListAssignmentsQuerySchema = z.object({
  userId: z.string().min(1).optional(),
})
