import { z } from 'zod'
import type { EmailBlock } from '@engageiq/shared'

// ─── Email block validation (mirrors the EmailBlock union in @engageiq/shared) ──
// Recursive because a conditional block nests child blocks, so we use z.lazy + z.union
// (discriminatedUnion can't reference a lazily-defined recursive member).

const AlignSchema = z.enum(['left', 'center', 'right']).optional()

const TextBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('text'),
  html: z.string(),
  align: AlignSchema,
})

const ImageBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('image'),
  src: z.string().min(1),
  alt: z.string().optional(),
  href: z.string().optional(),
  width: z.number().int().positive().max(600).optional(),
  align: AlignSchema,
})

const ButtonBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('button'),
  text: z.string().min(1),
  href: z.string().min(1),
  align: AlignSchema,
})

const DividerBlockSchema = z.object({ id: z.string().min(1), type: z.literal('divider') })

const SpacerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('spacer'),
  height: z.number().int().min(0).max(200),
})

const DynamicProductBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('dynamic-product'),
  source: z.enum(['top_sellers', 'recommended', 'viewed', 'manual']),
  limit: z.number().int().min(1).max(12),
  columns: z.number().int().min(1).max(4).optional(),
  heading: z.string().optional(),
  productIds: z.array(z.string()).optional(),
})

export const BlockSchema: z.ZodType<EmailBlock> = z.lazy(() =>
  z.union([
    TextBlockSchema,
    ImageBlockSchema,
    ButtonBlockSchema,
    DividerBlockSchema,
    SpacerBlockSchema,
    DynamicProductBlockSchema,
    ConditionalBlockSchema,
  ]),
)

const ConditionalBlockSchema: z.ZodType<EmailBlock> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.literal('conditional'),
    segmentId: z.string().min(1),
    label: z.string().optional(),
    blocks: z.array(BlockSchema).max(50),
  }),
) as z.ZodType<EmailBlock>

export const CreateTemplateBodySchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().max(300).optional(),
  preheader: z.string().max(300).optional(),
  blocks: z.array(BlockSchema).max(100).default([]),
  isTransactional: z.boolean().optional(),
})

export const UpdateTemplateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().max(300).nullable().optional(),
  preheader: z.string().max(300).nullable().optional(),
  blocks: z.array(BlockSchema).max(100).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  isTransactional: z.boolean().optional(),
})

export const TemplateParamsSchema = z.object({ id: z.string().cuid() })

export const ListTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

// A sample customer used for preview/spam-check/test-send when no real customerId is given.
export const SampleCustomerSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    city: z.string().optional(),
  })
  .optional()

// customerId / segmentId can reference seeded rows whose ids are readable slugs
// (e.g. "seed-segment-champions"), not cuids — so these are min(1) strings, not .cuid().
export const PreviewBodySchema = z.object({
  // Optional: render for a real customer (resolves their segments + recommendations).
  customerId: z.string().min(1).optional(),
  sampleCustomer: SampleCustomerSchema,
})

export const TestSendBodySchema = z.object({
  toEmail: z.string().email(),
  customerId: z.string().min(1).optional(),
  sampleCustomer: SampleCustomerSchema,
})

export const SendBodySchema = z.object({
  segmentId: z.string().min(1),
  // Optional A/B test id governing this template's variants.
  abTestId: z.string().min(1).optional(),
})

export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateBodySchema>
export type PreviewBody = z.infer<typeof PreviewBodySchema>
export type TestSendBody = z.infer<typeof TestSendBodySchema>
export type SendBody = z.infer<typeof SendBodySchema>
