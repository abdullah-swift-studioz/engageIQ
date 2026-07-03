// Anthropic token pricing (USD per 1M tokens) for the copywriter cost trail persisted on
// AiGeneration.costUsd. Kept as a small local table — the models we actually route to are few.
// Update alongside ANTHROPIC_MODEL when a new default is chosen. Unknown models fall back to
// the Opus-4 tier so cost is over- rather than under-estimated.
interface ModelRate {
  inputPerM: number
  outputPerM: number
}

const RATES: Record<string, ModelRate> = {
  'claude-opus-4-8': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-7': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25 },
  'claude-sonnet-5': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
}

const FALLBACK: ModelRate = { inputPerM: 5, outputPerM: 25 }

// Round to 4 decimal places to match AiGeneration.costUsd Decimal(10,4).
export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rate = RATES[model] ?? FALLBACK
  const cost =
    (promptTokens / 1_000_000) * rate.inputPerM +
    (completionTokens / 1_000_000) * rate.outputPerM
  return Math.round(cost * 10_000) / 10_000
}
