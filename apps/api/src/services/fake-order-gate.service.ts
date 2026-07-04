// Real-time COD fake-order gating (roadmap 7.3).
//
// The batch scoring worker (scoring.worker.ts) scores every COD order nightly. This
// service adds the *synchronous* path: when a COD order is ingested, score it inline via
// the ML service and apply the merchant's risk thresholds so downstream gating is immediate
// (verification handoff for the middle band, a hold marker for the top band).
//
// It writes only existing columns: CodOrder.fakeScore / fakeScoreDetails / verificationStatus
// and the Customer.fakeOrderScore rollup. No schema changes. Failures never block ingestion —
// an unscored order is simply picked up by the nightly batch run.

import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { CodVerificationStatus } from '@prisma/client'
import {
  createMlClient,
  buildFakeOrderInput,
  type MlClient,
} from '../workers/scoring.worker.js'

const DAY_MS = 24 * 60 * 60 * 1000

export type FakeGate = 'process' | 'verify' | 'hold'

export interface FakeOrderThresholds {
  /** score at/above which the order needs COD verification. */
  verify: number
  /** score at/above which the order is held (top-risk band). */
  hold: number
}

// Defaults mirror the ML service bands: 0–<40 process / 40–<70 verify / ≥70 hold.
export const DEFAULT_THRESHOLDS: FakeOrderThresholds = { verify: 40, hold: 70 }

/**
 * Read per-merchant thresholds from MerchantSettings.fakeOrderThresholds (Json:
 * `{ process, verify, cancel }` bands per the schema). We map `cancel` → hold. Any
 * missing/invalid value falls back to the default. Pure + exported for testing.
 */
export function resolveThresholds(raw: unknown): FakeOrderThresholds {
  const t = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback
  const verify = num(t.verify, DEFAULT_THRESHOLDS.verify)
  // Accept either `hold` or the schema's `cancel` key for the top band.
  const hold = num(t.hold ?? t.cancel, DEFAULT_THRESHOLDS.hold)
  // Guard against inverted config (hold must be ≥ verify).
  return hold >= verify ? { verify, hold } : { verify, hold: verify }
}

/** Decide the gate for a numeric fake-order score. Pure + exported for testing. */
export function decideGate(score: number, t: FakeOrderThresholds): FakeGate {
  if (score >= t.hold) return 'hold'
  if (score >= t.verify) return 'verify'
  return 'process'
}

/**
 * Score one freshly-ingested COD order inline and apply the merchant's gate.
 * Idempotent: re-running recomputes and overwrites the same columns.
 * Never throws to the caller path (see wiring in order.processor) — resolves silently
 * on ML errors so an outage cannot drop an order.
 */
export async function scoreFakeOrderRealtime(
  merchantId: string,
  shopifyOrderId: string,
  ml: MlClient = createMlClient(),
  now: Date = new Date(),
): Promise<{ score: number; gate: FakeGate } | null> {
  const cod = await prisma.codOrder.findUnique({
    where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
  })
  if (!cod) return null

  // Matching Order (for shipping address) + customer, tenant-scoped.
  const [order, customer] = await Promise.all([
    prisma.order.findUnique({
      where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId } },
    }),
    cod.customerId
      ? prisma.customer.findFirst({ where: { id: cod.customerId, merchantId } })
      : Promise.resolve(null),
  ])

  // Velocity: this customer's other COD orders within 24h of this one.
  const codCountLast24h = cod.customerId
    ? await prisma.codOrder.count({
        where: {
          merchantId,
          customerId: cod.customerId,
          id: { not: cod.id },
          placedAt: {
            gte: new Date(cod.placedAt.getTime() - DAY_MS),
            lte: new Date(cod.placedAt.getTime() + DAY_MS),
          },
        },
      })
    : 0

  const input = buildFakeOrderInput(cod, order ?? undefined, customer ?? undefined, codCountLast24h)
  const [scored] = await ml.fakeOrder([input])
  if (!scored) return null

  const thresholds = resolveThresholds(
    (await prisma.merchantSettings.findUnique({ where: { merchantId } }))?.fakeOrderThresholds,
  )
  const gate = decideGate(scored.fakeScore, thresholds)

  // Middle + top bands hand off to COD verification. The top band is additionally marked
  // held so the (future) verification/agent UI can prioritise it. We never auto-cancel and
  // never touch Customer.isBlocked from a single order — a per-order signal must not nuke
  // the customer (deferred to explicit merchant/agent action).
  const details = {
    ...scored.details,
    riskBand: scored.riskBand,
    gate,
    held: gate === 'hold',
    thresholdVerify: thresholds.verify,
    thresholdHold: thresholds.hold,
    scoredRealtimeAt: now.toISOString(),
  }

  // Only advance verificationStatus forward from UNVERIFIED — never override a status a
  // verification flow has already moved to VERIFIED/AUTO_CANCELLED.
  const nextVerification: CodVerificationStatus | undefined =
    (gate === 'verify' || gate === 'hold') && cod.verificationStatus === 'UNVERIFIED'
      ? 'PENDING_VERIFICATION'
      : undefined

  await prisma.codOrder.update({
    where: { id: cod.id },
    data: {
      fakeScore: scored.fakeScore,
      fakeScoreDetails: details as Prisma.InputJsonValue,
      ...(nextVerification ? { verificationStatus: nextVerification } : {}),
    },
  })

  // Roll up to Customer.fakeOrderScore = worst (max) across the customer's COD orders.
  if (customer) {
    const worst = Math.max(customer.fakeOrderScore ?? 0, scored.fakeScore)
    if (worst !== customer.fakeOrderScore) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { fakeOrderScore: worst },
      })
    }
  }

  return { score: scored.fakeScore, gate }
}
