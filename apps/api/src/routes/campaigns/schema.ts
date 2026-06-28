import { z } from 'zod'

// Channel union mirrors the Prisma `Channel` enum (and @engageiq/shared ChannelName).
export const CampaignChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH'])

export const CreateCampaignBodySchema = z.object({
  name: z.string().min(1).max(200),
  channel: CampaignChannelSchema,
  // Optional at create so a draft can be saved before a target segment is chosen.
  // Required at schedule/send time (validated in the controller).
  segmentId: z.string().cuid().optional(),
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(10000),
  utmCampaign: z.string().max(200).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
})

export const UpdateCampaignBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  channel: CampaignChannelSchema.optional(),
  segmentId: z.string().cuid().nullable().optional(),
  subject: z.string().max(300).nullable().optional(),
  body: z.string().min(1).max(10000).optional(),
  utmCampaign: z.string().max(200).nullable().optional(),
  utmSource: z.string().max(200).nullable().optional(),
  utmMedium: z.string().max(200).nullable().optional(),
})

// sendAt omitted / null = send immediately; a future ISO datetime = schedule.
export const SendCampaignBodySchema = z.object({
  sendAt: z.string().datetime().nullable().optional(),
})

export const CampaignParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED', 'CANCELLED'])
    .optional(),
})

export type CampaignChannel = z.infer<typeof CampaignChannelSchema>
export type CreateCampaignBody = z.infer<typeof CreateCampaignBodySchema>
export type UpdateCampaignBody = z.infer<typeof UpdateCampaignBodySchema>
export type SendCampaignBody = z.infer<typeof SendCampaignBodySchema>
export type CampaignParams = z.infer<typeof CampaignParamsSchema>
export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuerySchema>
