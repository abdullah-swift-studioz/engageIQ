// apps/api/src/services/email/ab-test.ts
//
// A/B testing for email templates (guide 7.3): test subject line or full variant, split
// the audience deterministically, track per-variant metrics, and decide a statistically
// significant winner (two-proportion z-test). Stored in the frozen AbTest table
// (entityType = EMAIL_TEMPLATE, entityId = the template id, variants = Json).

import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { EmailBlock } from '@engageiq/shared'

// One arm of an A/B test. `subject`/`blocks` override the base template when this variant
// is chosen for a recipient. Metrics are recomputed from Message rows or incremented by
// the tracking routes.
export interface AbVariant {
  id: string
  name: string
  subject?: string
  blocks?: EmailBlock[]
  // Allocation weight (0–100). The engine normalizes weights that don't sum to 100.
  allocationPct: number
  metrics?: { sent: number; opened: number; clicked: number }
}

export type WinnerMetric = 'open_rate' | 'click_rate'

// Deterministic 0..1 hash of a seed string (FNV-1a → normalized). Same customer always
// lands in the same variant, so a re-send never reshuffles the split.
function hashUnit(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 → unsigned; divide by 2^32 for [0,1).
  return (h >>> 0) / 0x100000000
}

// Weighted, deterministic variant assignment for one recipient.
export function assignVariant(variants: AbVariant[], seed: string): AbVariant | null {
  if (variants.length === 0) return null
  const total = variants.reduce((s, v) => s + Math.max(0, v.allocationPct), 0)
  const point = total > 0 ? hashUnit(seed) * total : 0
  let acc = 0
  for (const v of variants) {
    // With no positive weights, treat variants as equal (each contributes 1).
    acc += total > 0 ? Math.max(0, v.allocationPct) : 1
    if (point < acc) return v
  }
  return variants[variants.length - 1] ?? null
}

function parseVariants(json: Prisma.JsonValue | null): AbVariant[] {
  if (!Array.isArray(json)) return []
  return json as unknown as AbVariant[]
}

// The AbTest that governs a given email template, if one is active.
async function activeTestForTemplate(merchantId: string, templateId: string) {
  return prisma.abTest.findFirst({
    where: {
      merchantId,
      entityType: 'EMAIL_TEMPLATE',
      entityId: templateId,
      status: { in: ['RUNNING', 'WINNER_DECIDED'] },
    },
  })
}

// Pick the variant for one recipient. Once a winner is decided, everyone gets the winner.
// Returns the variant id to stamp on the dispatch job, or null when no test is running.
export async function pickVariantForCustomer(
  merchantId: string,
  templateId: string,
  customerId: string,
): Promise<string | null> {
  const test = await activeTestForTemplate(merchantId, templateId)
  if (!test) return null
  if (test.status === 'WINNER_DECIDED' && test.winnerVariantId) return test.winnerVariantId
  const variants = parseVariants(test.variants)
  const chosen = assignVariant(variants, `${test.id}:${customerId}`)
  return chosen?.id ?? null
}

// Resolve a variant's subject/blocks override for the dispatch worker.
export async function resolveVariantForRecipient(
  merchantId: string,
  templateId: string,
  variantId: string,
): Promise<{ subject?: string; blocks?: EmailBlock[] } | null> {
  const test = await activeTestForTemplate(merchantId, templateId)
  if (!test) return null
  const variant = parseVariants(test.variants).find((v) => v.id === variantId)
  if (!variant) return null
  return {
    ...(variant.subject !== undefined && { subject: variant.subject }),
    ...(variant.blocks !== undefined && { blocks: variant.blocks }),
  }
}

// ─── Significance: two-proportion z-test ──────────────────────────────────────

export interface VariantRate {
  id: string
  n: number // sent
  x: number // successes (opened or clicked)
}

export interface WinnerDecision {
  winnerVariantId: string | null
  confidenceLevel: number // 0–1 (e.g. 0.95)
  significant: boolean
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26 approximation) — for the p-value.
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

/**
 * Decide the winner among variant rates. Compares the top-rate variant against the
 * runner-up with a two-proportion z-test; significant at the given alpha (default 95%).
 */
export function decideWinner(rates: VariantRate[], alpha = 0.05): WinnerDecision {
  const usable = rates.filter((r) => r.n > 0)
  if (usable.length < 2) return { winnerVariantId: null, confidenceLevel: 0, significant: false }

  const sorted = [...usable].sort((a, b) => b.x / b.n - a.x / a.n)
  const top = sorted[0]
  const second = sorted[1]
  if (!top || !second) return { winnerVariantId: null, confidenceLevel: 0, significant: false }

  const p1 = top.x / top.n
  const p2 = second.x / second.n
  const pPool = (top.x + second.x) / (top.n + second.n)
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / top.n + 1 / second.n))
  if (se === 0) return { winnerVariantId: null, confidenceLevel: 0, significant: false }

  const z = (p1 - p2) / se
  // Two-sided p-value → confidence that the difference is real.
  const pValue = 2 * (1 - normalCdf(Math.abs(z)))
  const confidenceLevel = Math.max(0, Math.min(1, 1 - pValue))
  const significant = pValue < alpha
  return { winnerVariantId: significant ? top.id : null, confidenceLevel, significant }
}

// Compute per-variant sent/opened/clicked from Message rows tagged with abVariantId, then
// decide + (optionally) persist the winner. Returns the decision.
export async function evaluateAndMaybeDecide(
  merchantId: string,
  abTestId: string,
  persist = true,
): Promise<WinnerDecision | null> {
  const test = await prisma.abTest.findFirst({ where: { id: abTestId, merchantId } })
  if (!test || !test.entityId) return null
  const entityId = test.entityId
  const variants = parseVariants(test.variants)
  if (variants.length < 2) return null

  const metric: WinnerMetric = test.winnerMetric === 'click_rate' ? 'click_rate' : 'open_rate'

  // The chosen variant id is persisted on Message.metadata.abVariantId (Message has no
  // dedicated column). Filter opens/clicks/sends by that JSON path.
  const rates: VariantRate[] = await Promise.all(
    variants.map(async (v) => {
      const variantWhere = { path: ['abVariantId'], equals: v.id }
      const sent = await prisma.message.count({
        where: {
          merchantId,
          emailTemplateId: entityId,
          metadata: variantWhere,
          status: { in: ['SENT', 'DELIVERED', 'READ'] },
        },
      })
      const successWhere =
        metric === 'click_rate' ? { clickedAt: { not: null } } : { openedAt: { not: null } }
      const success = await prisma.message.count({
        where: { merchantId, emailTemplateId: entityId, metadata: variantWhere, ...successWhere },
      })
      return { id: v.id, n: sent, x: success }
    }),
  )

  const decision = decideWinner(rates)

  if (persist && decision.significant && decision.winnerVariantId) {
    await prisma.abTest.update({
      where: { id: test.id },
      data: {
        status: 'WINNER_DECIDED',
        winnerVariantId: decision.winnerVariantId,
        confidenceLevel: decision.confidenceLevel,
        decidedAt: new Date(),
      },
    })
  }
  return decision
}
