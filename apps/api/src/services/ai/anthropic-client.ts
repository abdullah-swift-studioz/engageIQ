import Anthropic from '@anthropic-ai/sdk'
import { env } from '@engageiq/shared'

// Lazily-constructed Anthropic client singleton. The AI copywriter is the only consumer.
// The key is optional (env.ANTHROPIC_API_KEY) so the app boots credential-free; when it is
// absent the copywriter returns a clear AI_NOT_CONFIGURED error instead of fabricating copy.
let client: Anthropic | null = null

export function isAiConfigured(): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.length > 0
}

export function getAnthropicClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new Error('Anthropic client requested but ANTHROPIC_API_KEY is not configured')
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }
  return client
}

// Test seam: allow unit tests to inject a stub client (avoids network + real key).
export function __setAnthropicClientForTests(stub: Anthropic | null): void {
  client = stub
}
