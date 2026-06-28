import { z } from 'zod'

// lane:ml — product recommendation read API (milestone 7.2)
export const GetRecommendationsParamsSchema = z.object({
  customerId: z.string().min(1),
})

export const GetRecommendationsQuerySchema = z.object({
  type: z.enum(['ALSO_BOUGHT', 'MIGHT_LIKE', 'COMPLETE_LOOK', 'RESTOCK']).optional(),
})
