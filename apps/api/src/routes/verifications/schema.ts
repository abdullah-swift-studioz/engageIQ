import { z } from 'zod'

// Status filter mirrors the CodVerificationStatus values an order can have while in/through the flow.
export const InVerificationStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'VERIFIED',
  'AUTO_CANCELLED',
])

export const ListVerificationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(30),
  status: InVerificationStatusSchema.optional(),
})

// id validated as a non-empty string (not .cuid()) — matches the project's route-param convention
// (seed/demo ids are historically non-cuid; .cuid() would 400 them).
export const VerificationParamsSchema = z.object({
  id: z.string().min(1),
})

// Manual agent action on an order held for review (the /:id/confirm and /:id/cancel routes carry no body).
export const ManualDecisionBodySchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .optional()

export type ListVerificationsQuery = z.infer<typeof ListVerificationsQuerySchema>
export type VerificationParams = z.infer<typeof VerificationParamsSchema>
