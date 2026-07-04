import { APIError, AuthenticationError } from '@anthropic-ai/sdk'
import { prisma } from '@engageiq/db'
import { env } from '@engageiq/shared'
import type {
  AiCopyContext,
  AiCopyVariant,
  AiGenerateRequestDto,
  AiGenerateResultDto,
  CopyLanguage,
  CopyPurpose,
} from '@engageiq/shared'
import { getAnthropicClient, isAiConfigured } from './anthropic-client.js'
import { computeCostUsd } from './pricing.js'

// Discriminated result so the controller can map failures onto the standard error envelope
// without throwing across the HTTP boundary (mirrors the campaigns lane convention).
export type AiServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string }

const DEFAULT_COUNT = 3
const MAX_COUNT = 5

// Human-readable guidance per purpose. Channel constraints are baked into the prompt so the
// model respects SMS length / subject-line brevity without us post-truncating.
const PURPOSE_BRIEF: Record<CopyPurpose, string> = {
  email_subject:
    'Write email SUBJECT LINES. Keep each under ~55 characters so it is not truncated in inboxes. ' +
    'Make them curiosity-driving and specific; avoid spammy ALL-CAPS and excessive punctuation.',
  whatsapp_body:
    'Write WhatsApp message bodies. Conversational and personal, 1–3 short sentences, may use a ' +
    'tasteful emoji, and end with a clear call to action. WhatsApp is high-intent — sound human, not corporate.',
  sms_copy:
    'Write SMS copy. Hard limit 160 characters INCLUDING a short call to action. Plain text, no emoji ' +
    'unless it saves space, front-load the value.',
}

const LANGUAGE_BRIEF: Record<CopyLanguage, string> = {
  en: 'Write in natural, fluent English.',
  ur: 'Write in natural, fluent Urdu using Urdu script (right-to-left). Use everyday conversational Urdu a ' +
    'Pakistani shopper would use, not stiff literary Urdu. The merchant will have a native speaker review before sending.',
}

// Structured-output schema. No length/min/max constraints (unsupported by structured outputs);
// the exact variant count is enforced via the prompt instead.
function buildSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'rationale'],
          properties: {
            text: { type: 'string', description: 'The generated copy, ready to send.' },
            rationale: {
              type: 'string',
              description: 'One short sentence on why this variant fits the goal and tone.',
            },
          },
        },
      },
    },
  }
}

function buildSystemPrompt(purpose: CopyPurpose, ctx: AiCopyContext): string {
  return [
    'You are an expert e-commerce marketing copywriter for EngageIQ, a customer-engagement platform',
    'for Shopify merchants in Pakistan and the wider South Asia / MENA region. You write high-converting,',
    'on-brand copy that respects the channel and the local market (WhatsApp-first, COD-heavy, price-sensitive).',
    '',
    PURPOSE_BRIEF[purpose],
    LANGUAGE_BRIEF[ctx.language],
    '',
    'Return ONLY the requested variants. Each variant must be distinct in angle — do not paraphrase the same',
    'idea. Never invent discounts, prices, or claims that were not provided.',
  ].join('\n')
}

function buildUserPrompt(count: number, ctx: AiCopyContext): string {
  const lines: string[] = [`Produce exactly ${count} distinct variants for this campaign:`, '']
  lines.push(`- Goal: ${ctx.goal}`)
  if (ctx.segment) lines.push(`- Target segment: ${ctx.segment}`)
  if (ctx.offer) lines.push(`- Offer: ${ctx.offer}`)
  if (ctx.productName) lines.push(`- Product / store: ${ctx.productName}`)
  lines.push(`- Tone: ${ctx.tone}`)
  if (ctx.brandVoice) lines.push(`- Brand voice notes: ${ctx.brandVoice}`)
  return lines.join('\n')
}

interface ParsedVariants {
  variants: AiCopyVariant[]
}

function extractJsonText(content: Array<{ type: string; text?: string }>): string | null {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return null
}

function parseVariants(raw: string, count: number): AiCopyVariant[] {
  let parsed: ParsedVariants
  try {
    parsed = JSON.parse(raw) as ParsedVariants
  } catch {
    throw new Error('AI_BAD_RESPONSE')
  }
  if (!parsed || !Array.isArray(parsed.variants)) throw new Error('AI_BAD_RESPONSE')
  const variants = parsed.variants
    .filter((v): v is AiCopyVariant => !!v && typeof v.text === 'string' && v.text.trim().length > 0)
    .slice(0, count)
    .map((v) => ({
      text: v.text.trim(),
      rationale: typeof v.rationale === 'string' && v.rationale.trim() ? v.rationale.trim() : undefined,
    }))
  if (variants.length === 0) throw new Error('AI_BAD_RESPONSE')
  return variants
}

// Generate copy variants for one campaign context, persist the generation to AiGeneration
// (audit + cost trail + training data for the subject-line predictor), and return them.
export async function generateCopy(
  merchantId: string,
  dto: AiGenerateRequestDto,
  userId: string | null,
): Promise<AiServiceResult<AiGenerateResultDto>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'AI_NOT_CONFIGURED',
      message:
        'AI copywriting is not configured. Set ANTHROPIC_API_KEY on the server to enable "Generate with AI".',
    }
  }

  const count = Math.min(Math.max(dto.count ?? DEFAULT_COUNT, 1), MAX_COUNT)
  const model = env.ANTHROPIC_MODEL

  let variants: AiCopyVariant[]
  let promptTokens: number
  let completionTokens: number

  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: env.ANTHROPIC_COPYWRITER_MAX_TOKENS,
      output_config: {
        effort: env.ANTHROPIC_COPYWRITER_EFFORT,
        format: { type: 'json_schema', schema: buildSchema() },
      },
      system: buildSystemPrompt(dto.purpose, dto.context),
      messages: [{ role: 'user', content: buildUserPrompt(count, dto.context) }],
    })

    const jsonText = extractJsonText(response.content as Array<{ type: string; text?: string }>)
    if (!jsonText) throw new Error('AI_BAD_RESPONSE')
    variants = parseVariants(jsonText, count)
    promptTokens = response.usage.input_tokens
    completionTokens = response.usage.output_tokens
  } catch (err) {
    if (err instanceof AuthenticationError) {
      return { ok: false, status: 502, code: 'AI_AUTH_FAILED', message: 'The configured ANTHROPIC_API_KEY was rejected.' }
    }
    if (err instanceof APIError) {
      return { ok: false, status: 502, code: 'AI_UPSTREAM_ERROR', message: 'The AI provider returned an error. Please retry.' }
    }
    if (err instanceof Error && err.message === 'AI_BAD_RESPONSE') {
      return { ok: false, status: 502, code: 'AI_BAD_RESPONSE', message: 'The AI provider returned copy that could not be parsed.' }
    }
    return { ok: false, status: 502, code: 'AI_UPSTREAM_ERROR', message: 'AI copy generation failed. Please retry.' }
  }

  const costUsd = computeCostUsd(model, promptTokens, completionTokens)

  const row = await prisma.aiGeneration.create({
    data: {
      merchantId,
      userId,
      purpose: dto.purpose,
      channel: dto.channel ?? null,
      language: dto.context.language,
      contextJson: dto.context as unknown as object,
      variants: variants as unknown as object,
      model,
      promptTokens,
      completionTokens,
      costUsd,
    },
    select: { id: true },
  })

  return {
    ok: true,
    data: {
      generationId: row.id,
      purpose: dto.purpose,
      language: dto.context.language,
      model,
      variants,
      usage: { promptTokens, completionTokens, costUsd },
    },
  }
}
