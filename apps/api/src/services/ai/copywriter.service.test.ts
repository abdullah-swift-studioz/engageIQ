import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock @engageiq/shared's env (its module validates process.env on load, which the test
// process doesn't satisfy) — same convention as the channels lane's adapter test.
vi.mock('@engageiq/shared', () => ({
  env: {
    ANTHROPIC_MODEL: 'claude-opus-4-8',
    ANTHROPIC_COPYWRITER_MAX_TOKENS: 1024,
    ANTHROPIC_COPYWRITER_EFFORT: 'low',
  },
}))

// Mock the DB and the Anthropic client seam BEFORE importing the service (Vitest hoists mocks).
vi.mock('@engageiq/db', () => ({
  prisma: {
    aiGeneration: { create: vi.fn() },
  },
}))

vi.mock('./anthropic-client.js', () => ({
  isAiConfigured: vi.fn(),
  getAnthropicClient: vi.fn(),
}))

import { prisma } from '@engageiq/db'
import { isAiConfigured, getAnthropicClient } from './anthropic-client.js'
import { generateCopy } from './copywriter.service.js'
import type { AiGenerateRequestDto } from '@engageiq/shared'

const createMock = prisma.aiGeneration.create as unknown as ReturnType<typeof vi.fn>
const isConfiguredMock = isAiConfigured as unknown as ReturnType<typeof vi.fn>
const getClientMock = getAnthropicClient as unknown as ReturnType<typeof vi.fn>

const baseDto: AiGenerateRequestDto = {
  purpose: 'email_subject',
  channel: 'EMAIL',
  context: { goal: 'cart recovery', tone: 'friendly', language: 'en' },
}

function stubClientReturning(text: string, usage = { input_tokens: 100, output_tokens: 50 }) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text }],
    usage,
  })
  getClientMock.mockReturnValue({ messages: { create } })
  return create
}

describe('generateCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMock.mockResolvedValue({ id: 'gen_1' })
  })

  it('returns AI_NOT_CONFIGURED (no fake copy) when the API key is absent', async () => {
    isConfiguredMock.mockReturnValue(false)

    const result = await generateCopy('m1', baseDto, 'u1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('AI_NOT_CONFIGURED')
      expect(result.status).toBe(503)
    }
    expect(getClientMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('generates variants, computes cost, and persists an AiGeneration row', async () => {
    isConfiguredMock.mockReturnValue(true)
    const create = stubClientReturning(
      JSON.stringify({
        variants: [
          { text: 'Your cart misses you 🛒', rationale: 'playful nudge' },
          { text: 'Still thinking it over?' },
          { text: 'Complete your order in 1 tap' },
        ],
      }),
    )

    const result = await generateCopy('m1', baseDto, 'u1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.generationId).toBe('gen_1')
      expect(result.data.variants).toHaveLength(3)
      expect(result.data.variants[1]?.rationale).toBeUndefined()
      // opus-4-8: 100 in * $5/M + 50 out * $25/M = 0.00175 → rounded to 0.0018
      expect(result.data.usage.costUsd).toBeCloseTo(0.0018, 4)
      expect(result.data.model).toBe('claude-opus-4-8')
    }

    // Persisted with the right tenant + cost trail
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          merchantId: 'm1',
          userId: 'u1',
          purpose: 'email_subject',
          promptTokens: 100,
          completionTokens: 50,
        }),
      }),
    )

    // Structured output was requested
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: expect.objectContaining({
          format: expect.objectContaining({ type: 'json_schema' }),
        }),
      }),
    )
  })

  it('caps variants at the requested count', async () => {
    isConfiguredMock.mockReturnValue(true)
    stubClientReturning(
      JSON.stringify({ variants: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] }),
    )

    const result = await generateCopy('m1', { ...baseDto, count: 2 }, null)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.variants).toHaveLength(2)
  })

  it('returns AI_BAD_RESPONSE when the model output is not valid JSON', async () => {
    isConfiguredMock.mockReturnValue(true)
    stubClientReturning('sorry, here are some ideas: ...')

    const result = await generateCopy('m1', baseDto, 'u1')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('AI_BAD_RESPONSE')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('maps an upstream failure to AI_UPSTREAM_ERROR and does not persist', async () => {
    isConfiguredMock.mockReturnValue(true)
    const create = vi.fn().mockRejectedValue(new Error('network down'))
    getClientMock.mockReturnValue({ messages: { create } })

    const result = await generateCopy('m1', baseDto, 'u1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('AI_UPSTREAM_ERROR')
      expect(result.status).toBe(502)
    }
    expect(createMock).not.toHaveBeenCalled()
  })
})
