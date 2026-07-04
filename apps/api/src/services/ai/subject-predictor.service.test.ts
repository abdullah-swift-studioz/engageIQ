import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@engageiq/db', () => ({
  prisma: {
    campaign: { aggregate: vi.fn() },
  },
}))

import { prisma } from '@engageiq/db'
import { predictSubjectOpenRate } from './subject-predictor.service.js'

const aggregateMock = prisma.campaign.aggregate as unknown as ReturnType<typeof vi.fn>

function mockHistory(openedCount: number | null, recipientCount: number | null, count: number) {
  aggregateMock.mockResolvedValue({
    _sum: { openedCount, recipientCount },
    _count: count,
  })
}

describe('predictSubjectOpenRate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the industry benchmark and low confidence when the merchant has no email history', async () => {
    mockHistory(null, null, 0)

    const result = await predictSubjectOpenRate('m1', { subject: 'A great deal for you' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.merchantBaselineOpenRate).toBeNull()
      expect(result.data.sampleSize).toBe(0)
      expect(result.data.confidence).toBe('low')
      expect(result.data.predictedOpenRate).toBeGreaterThan(0)
      expect(result.data.factors[0]?.label).toBe('Baseline')
    }
  })

  it('derives the baseline from the merchant email history and reports high confidence', async () => {
    mockHistory(300, 1000, 12) // 30% historical open rate, 12 campaigns

    const result = await predictSubjectOpenRate('m1', { subject: 'Your order is waiting' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.merchantBaselineOpenRate).toBeCloseTo(0.3, 5)
      expect(result.data.confidence).toBe('high')
      // ~30% baseline nudged by features, still clamped under 0.85
      expect(result.data.predictedOpenRate).toBeGreaterThan(0.2)
      expect(result.data.predictedOpenRate).toBeLessThanOrEqual(0.85)
    }
  })

  it('penalizes spammy ALL-CAPS + excessive punctuation vs a clean subject', async () => {
    mockHistory(200, 1000, 5) // 20% baseline

    const spammy = await predictSubjectOpenRate('m1', { subject: 'HUGE SALE!!! BUY NOW!!!' })
    const clean = await predictSubjectOpenRate('m1', { subject: 'A little something for you' })

    expect(spammy.ok && clean.ok).toBe(true)
    if (spammy.ok && clean.ok) {
      expect(spammy.data.predictedOpenRate).toBeLessThan(clean.data.predictedOpenRate)
      expect(spammy.data.factors.some((f) => f.label === 'All-caps' && f.impact === 'negative')).toBe(true)
    }
  })

  it('rewards a personalization token', async () => {
    mockHistory(200, 1000, 5)

    const result = await predictSubjectOpenRate('m1', { subject: 'Hey {{first_name}}, a pick for you' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.factors.some((f) => f.label === 'Personalization' && f.impact === 'positive')).toBe(true)
    }
  })
})
