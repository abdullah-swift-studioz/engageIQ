import { z } from 'zod'

// Distinct {{n}} placeholder indices in a template body, ascending.
export function extractPlaceholderIndices(bodyText: string): number[] {
  const matches = bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)
  const set = new Set<number>()
  for (const m of matches) {
    if (m[1] !== undefined) set.add(parseInt(m[1], 10))
  }
  return [...set].sort((a, b) => a - b)
}

const VariableMapEntrySchema = z.object({
  index: z.number().int().positive(),
  field: z.string().min(1),
  default: z.string().optional(),
})

// Meta language codes are short (e.g. en, en_US, ur, ar_AE). Soft check only —
// we warn on unknown codes in the service layer rather than hard-blocking, since
// Meta's set evolves (spec §3.1).
const LanguageSchema = z.string().min(1).max(15)

const CategorySchema = z.enum(['UTILITY', 'MARKETING'])

// Cross-field rule: variableMap entries must have contiguous indices 1..N and match
// exactly the {{n}} placeholders in bodyText (spec §4.7).
function variableMapMatchesBody(data: { bodyText: string; variableMap: Array<{ index: number }> }): boolean {
  const placeholders = extractPlaceholderIndices(data.bodyText)
  const indices = [...data.variableMap.map((v) => v.index)].sort((a, b) => a - b)

  // Contiguous from 1.
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i + 1) return false
  }
  // Exact match with placeholders.
  if (placeholders.length !== indices.length) return false
  return placeholders.every((p, i) => p === indices[i])
}

export const CreateTemplateBodySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'name must be lowercase letters, digits, and underscores'),
    language: LanguageSchema,
    category: CategorySchema,
    bodyText: z.string().min(1).max(1024),
    variableMap: z.array(VariableMapEntrySchema).default([]),
  })
  .refine(variableMapMatchesBody, {
    message: 'variableMap must have contiguous indices 1..N matching the {{n}} placeholders in bodyText',
    path: ['variableMap'],
  })

export const UpdateTemplateBodySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'name must be lowercase letters, digits, and underscores')
      .optional(),
    language: LanguageSchema.optional(),
    category: CategorySchema.optional(),
    bodyText: z.string().min(1).max(1024).optional(),
    variableMap: z.array(VariableMapEntrySchema).optional(),
  })

export const TemplateParamsSchema = z.object({
  id: z.string().cuid(),
})

export const ListTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateBodySchema>
