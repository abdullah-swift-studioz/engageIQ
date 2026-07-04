import { z } from 'zod'

// Mirror the @engageiq/shared copy unions. Channel union mirrors the Prisma `Channel` enum.
export const CopyPurposeSchema = z.enum(['email_subject', 'whatsapp_body', 'sms_copy'])
export const CopyToneSchema = z.enum(['formal', 'casual', 'urgent', 'friendly'])
export const CopyLanguageSchema = z.enum(['en', 'ur'])
export const ChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH'])

export const AiCopyContextSchema = z.object({
  goal: z.string().min(1, 'goal is required').max(200),
  segment: z.string().max(200).optional(),
  offer: z.string().max(300).optional(),
  tone: CopyToneSchema,
  language: CopyLanguageSchema,
  brandVoice: z.string().max(500).optional(),
  productName: z.string().max(200).optional(),
})

export const GenerateBodySchema = z.object({
  purpose: CopyPurposeSchema,
  channel: ChannelSchema.optional(),
  context: AiCopyContextSchema,
  count: z.number().int().min(1).max(5).optional(),
})

export const PredictSubjectBodySchema = z.object({
  subject: z.string().min(1, 'subject is required').max(300),
  segment: z.string().max(200).optional(),
})

export type GenerateBody = z.infer<typeof GenerateBodySchema>
export type PredictSubjectBody = z.infer<typeof PredictSubjectBodySchema>
