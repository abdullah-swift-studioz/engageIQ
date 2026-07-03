import { z } from 'zod'

export const RoleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'MARKETER',
  'ANALYST',
  'AGENCY_ADMIN',
  'AGENCY_MEMBER',
])

export const CreateTeamMemberBodySchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: RoleSchema,
  password: z.string().min(8).max(200),
})

export const UpdateTeamMemberBodySchema = z
  .object({
    role: RoleSchema.optional(),
    isActive: z.boolean().optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const UserParamsSchema = z.object({ id: z.string().min(1) })
