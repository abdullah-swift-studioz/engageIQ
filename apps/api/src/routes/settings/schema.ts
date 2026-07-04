import { z } from 'zod'
import { PUBLIC_API_SCOPES } from './scopes.js'
import { ALL_OUTBOUND_EVENTS } from '../../services/webhooks-outbound/events.js'

const scopeEnum = z.enum(PUBLIC_API_SCOPES)
const eventEnum = z.enum(ALL_OUTBOUND_EVENTS as [string, ...string[]])

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(scopeEnum).min(1, 'At least one scope is required'),
  // ISO date string; optional expiry.
  expiresAt: z.string().datetime().optional(),
})
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>

export const updateApiKeySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    scopes: z.array(scopeEnum).min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>

export const createWebhookSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Must be an http(s) URL'),
  events: z.array(eventEnum).min(1, 'Subscribe to at least one event'),
  description: z.string().max(280).optional(),
})
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>

export const updateWebhookSchema = z
  .object({
    url: z.string().url().optional(),
    events: z.array(eventEnum).min(1).optional(),
    description: z.string().max(280).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>

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
