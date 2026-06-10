import { z } from 'zod'

export const CreateStepSchema = z.object({
  stepType: z.enum(['TRIGGER', 'ACTION', 'CONDITION', 'DELAY']),
  parentStepId: z.string().cuid().nullable().default(null),
  label: z.string().max(100).nullable().default(null),
  config: z.unknown(),
  positionX: z.number().int().default(0),
  positionY: z.number().int().default(0),
})

export const CreateJourneyBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  triggerType: z.enum(['segment_entered', 'order_placed', 'custom_event', 'scheduled']),
  triggerConfig: z.unknown().default({}),
  reEntryRule: z.enum(['ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT']).default('DISALLOW'),
  exitTrigger: z.enum(['order_placed', 'segment_entered', 'custom_event']).nullable().optional(),
  steps: z.array(CreateStepSchema).default([]),
})

export const UpdateJourneyBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.enum(['segment_entered', 'order_placed', 'custom_event', 'scheduled']).optional(),
  triggerConfig: z.unknown().optional(),
  reEntryRule: z.enum(['ALLOW', 'DISALLOW', 'RE_ENROLL_AFTER_EXIT']).optional(),
  exitTrigger: z.enum(['order_placed', 'segment_entered', 'custom_event']).nullable().optional(),
  steps: z.array(CreateStepSchema).optional(),
})

export const JourneyParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListJourneysQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export const ListEnrollmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['ACTIVE', 'COMPLETED', 'EXITED', 'FAILED']).optional(),
})

export type CreateJourneyBody = z.infer<typeof CreateJourneyBodySchema>
export type UpdateJourneyBody = z.infer<typeof UpdateJourneyBodySchema>
export type JourneyParams = z.infer<typeof JourneyParamsSchema>
export type ListJourneysQuery = z.infer<typeof ListJourneysQuerySchema>
export type ListEnrollmentsQuery = z.infer<typeof ListEnrollmentsQuerySchema>
