import { prisma } from '@engageiq/db'
import type {
  SubjectPredictFactor,
  SubjectPredictRequestDto,
  SubjectPredictResultDto,
} from '@engageiq/shared'
import type { AiServiceResult } from './copywriter.service.js'

// Transparent, heuristic subject-line open-rate predictor (feature-guide §8.3). It blends the
// merchant's OWN historical email open rate (from Campaign counters) with well-known subject-line
// features. This is deliberately NOT an ML model — it needs no training pipeline and is fully
// explainable via the returned `factors`. When the ML lane later ships a real predictor it can
// replace this behind the same DTO.

// Fallback email open-rate benchmark when the merchant has no email history yet (~industry avg).
const INDUSTRY_BASELINE = 0.2
const MIN_RATE = 0.02
const MAX_RATE = 0.85

const URGENCY_WORDS = [
  'now', 'today', 'hurry', 'last chance', 'ends', 'ending', 'limited', 'sale', 'off',
  'deal', 'today only', 'flash', 'expires', 'don’t miss', 'dont miss',
]

// Emoji presence (covers the common pictographic ranges; good enough for a heuristic signal).
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
// Any Arabic/Urdu script character.
const URDU_RE = /[؀-ۿݐ-ݿ]/
// Personalization merge tags like {{first_name}} or {first_name}.
const MERGE_TAG_RE = /\{\{?\s*[\w.]+\s*\}?\}/

function countExclamations(s: string): number {
  return (s.match(/!/g) ?? []).length
}

function hasAllCapsWord(s: string): boolean {
  // A "shouty" token: 3+ consecutive uppercase Latin letters.
  return /\b[A-Z]{3,}\b/.test(s)
}

interface Adjustment {
  factor: SubjectPredictFactor
  multiplier: number
}

function evaluateFeatures(subject: string): Adjustment[] {
  const adjustments: Adjustment[] = []
  const trimmed = subject.trim()
  const len = [...trimmed].length

  // Length — inbox-friendly subjects (~28–50 chars) read best.
  if (len === 0) {
    adjustments.push({ factor: { label: 'Length', impact: 'negative', detail: 'Subject is empty.' }, multiplier: 0.5 })
  } else if (len > 60) {
    adjustments.push({ factor: { label: 'Length', impact: 'negative', detail: `${len} chars — likely truncated on mobile; aim for under 55.` }, multiplier: 0.85 })
  } else if (len < 15) {
    adjustments.push({ factor: { label: 'Length', impact: 'neutral', detail: `${len} chars — quite short; make sure it carries enough value.` }, multiplier: 0.97 })
  } else {
    adjustments.push({ factor: { label: 'Length', impact: 'positive', detail: `${len} chars — a good, scannable length.` }, multiplier: 1.08 })
  }

  // Personalization merge tag.
  if (MERGE_TAG_RE.test(trimmed)) {
    adjustments.push({ factor: { label: 'Personalization', impact: 'positive', detail: 'Uses a personalization token — personalized subjects lift open rates.' }, multiplier: 1.12 })
  }

  // Urgency / promo language.
  const lower = trimmed.toLowerCase()
  if (URGENCY_WORDS.some((w) => lower.includes(w))) {
    adjustments.push({ factor: { label: 'Urgency', impact: 'positive', detail: 'Time / offer urgency tends to raise opens for promotional sends.' }, multiplier: 1.06 })
  }

  // Question — invites engagement.
  if (trimmed.includes('?')) {
    adjustments.push({ factor: { label: 'Question', impact: 'positive', detail: 'A question can spark curiosity and opens.' }, multiplier: 1.04 })
  }

  // Emoji.
  if (EMOJI_RE.test(trimmed)) {
    adjustments.push({ factor: { label: 'Emoji', impact: 'positive', detail: 'A single relevant emoji can help the subject stand out — avoid overusing.' }, multiplier: 1.03 })
  }

  // Shouty caps — reads as spam.
  if (hasAllCapsWord(trimmed)) {
    adjustments.push({ factor: { label: 'All-caps', impact: 'negative', detail: 'ALL-CAPS words read as spammy and can hurt deliverability and opens.' }, multiplier: 0.88 })
  }

  // Excessive punctuation.
  if (countExclamations(trimmed) >= 2) {
    adjustments.push({ factor: { label: 'Punctuation', impact: 'negative', detail: 'Multiple exclamation marks trip spam filters and reader fatigue.' }, multiplier: 0.9 })
  }

  // Urdu subject — note RTL; neutral effect on the estimate itself.
  if (URDU_RE.test(trimmed)) {
    adjustments.push({ factor: { label: 'Urdu', impact: 'neutral', detail: 'Urdu subject detected — will render right-to-left; have a native speaker sanity-check tone.' }, multiplier: 1 })
  }

  return adjustments
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

export async function predictSubjectOpenRate(
  merchantId: string,
  dto: SubjectPredictRequestDto,
): Promise<AiServiceResult<SubjectPredictResultDto>> {
  // Merchant's historical email open rate (tenant-scoped) from sent-campaign counters.
  const agg = await prisma.campaign.aggregate({
    where: { merchantId, channel: 'EMAIL', recipientCount: { gt: 0 } },
    _sum: { openedCount: true, recipientCount: true },
    _count: true,
  })

  const sumOpened = agg._sum.openedCount ?? 0
  const sumRecipients = agg._sum.recipientCount ?? 0
  const sampleSize = agg._count
  const merchantBaselineOpenRate = sumRecipients > 0 ? sumOpened / sumRecipients : null

  const base = merchantBaselineOpenRate ?? INDUSTRY_BASELINE
  const adjustments = evaluateFeatures(dto.subject)
  const combinedMultiplier = adjustments.reduce((m, a) => m * a.multiplier, 1)
  const predictedOpenRate = clamp(base * combinedMultiplier, MIN_RATE, MAX_RATE)

  const confidence: SubjectPredictResultDto['confidence'] =
    sampleSize >= 10 ? 'high' : sampleSize >= 3 ? 'medium' : 'low'

  const factors = adjustments.map((a) => a.factor)
  // Lead with a baseline factor so the merchant understands where the estimate starts.
  factors.unshift({
    label: 'Baseline',
    impact: 'neutral',
    detail:
      merchantBaselineOpenRate !== null
        ? `Based on your ${sampleSize} past email campaign(s): ${(merchantBaselineOpenRate * 100).toFixed(1)}% average open rate.`
        : `No email history yet — using a ${(INDUSTRY_BASELINE * 100).toFixed(0)}% industry benchmark.`,
  })

  return {
    ok: true,
    data: {
      subject: dto.subject,
      predictedOpenRate,
      confidence,
      merchantBaselineOpenRate,
      sampleSize,
      factors,
    },
  }
}
