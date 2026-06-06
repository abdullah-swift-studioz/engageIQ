import { z } from 'zod'

export const CreateSegmentBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  conditions: z.unknown(),
  isDynamic: z.boolean().default(true),
})

export const UpdateSegmentBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  conditions: z.unknown().optional(),
  isDynamic: z.boolean().optional(),
})

export const SegmentParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListSegmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export type CreateSegmentBody = z.infer<typeof CreateSegmentBodySchema>
export type UpdateSegmentBody = z.infer<typeof UpdateSegmentBodySchema>
export type SegmentParams = z.infer<typeof SegmentParamsSchema>
export type ListSegmentsQuery = z.infer<typeof ListSegmentsQuerySchema>
