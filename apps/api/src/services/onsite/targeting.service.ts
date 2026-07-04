import { prisma } from '@engageiq/db'
import type {
  OnSiteDeliveryElement,
  OnSiteDeliveryRequest,
  OnSiteDisplayRules,
  OnSiteElementConfig,
  OnSiteElementTypeName,
  OnSiteVariant,
} from '@engageiq/shared'

// ─── Pure helpers (unit-tested directly, no DB) ───────────────────────────────

/**
 * Deterministic 0..99 bucket for a visitor within one A/B test. FNV-1a over
 * `anonId:abTestId` so the SAME visitor always lands in the SAME bucket for the
 * SAME test — that stability is the whole point of A/B assignment.
 */
export function hashToBucket(anonId: string, abTestId: string): number {
  const seed = `${anonId}:${abTestId}`
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    // FNV prime multiply, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 → unsigned; modulo 100 → 0..99.
  return (h >>> 0) % 100
}

/**
 * Pick the variant whose cumulative allocation window contains `bucket`.
 * Variants are walked in array order; allocations are expected to sum to 100 but
 * we clamp defensively so a mis-summed test still resolves to a real variant.
 */
export function pickVariant(bucket: number, variants: OnSiteVariant[]): OnSiteVariant | null {
  if (variants.length === 0) return null
  let cumulative = 0
  for (const variant of variants) {
    cumulative += Math.max(0, variant.allocationPct)
    if (bucket < cumulative) return variant
  }
  // Bucket fell past the summed allocation (under-100 test) — last variant wins.
  return variants[variants.length - 1] ?? null
}

/** location.pathname substring match. Empty/absent pattern matches everything. */
export function matchesPage(pattern: string | undefined, pagePath: string | undefined): boolean {
  if (!pattern) return true
  if (!pagePath) return false
  return pagePath.includes(pattern)
}

// ─── A/B test shape as read from the AbTest row ───────────────────────────────

interface ActiveAbTest {
  id: string
  status: string
  variants: OnSiteVariant[]
  winnerVariantId: string | null
}

/**
 * Resolve the config + A/B assignment for one element. Priority:
 *  - WINNER_DECIDED test → everyone gets the winning variant's config.
 *  - RUNNING test        → deterministic per-visitor variant.
 *  - no active test      → the element's own stored config.
 */
export function resolveElementConfig(
  anonId: string,
  baseConfig: OnSiteElementConfig,
  test: ActiveAbTest | undefined,
): { config: OnSiteElementConfig; abTestId?: string; variantId?: string } {
  if (!test || test.variants.length === 0) return { config: baseConfig }

  if (test.status === 'WINNER_DECIDED' && test.winnerVariantId) {
    const winner = test.variants.find((v) => v.id === test.winnerVariantId)
    if (winner) return { config: winner.config, abTestId: test.id, variantId: winner.id }
  }

  if (test.status === 'RUNNING') {
    const variant = pickVariant(hashToBucket(anonId, test.id), test.variants)
    if (variant) return { config: variant.config, abTestId: test.id, variantId: variant.id }
  }

  return { config: baseConfig }
}

// ─── Visitor → segments ───────────────────────────────────────────────────────

/**
 * The set of segment ids this visitor currently belongs to. Known customers
 * (by customerId, or by an anon id stitched into `anonIds`) resolve to their
 * active memberships; a purely anonymous visitor resolves to the empty set, so
 * segment-scoped elements simply won't match them.
 *
 * Tenant-safe: the customer lookup is scoped by merchantId, and memberships are
 * read through that merchant-owned customer.
 */
export async function resolveVisitorSegments(
  merchantId: string,
  anonId: string,
  customerId: string | null | undefined,
): Promise<Set<string>> {
  const customer = customerId
    ? await prisma.customer.findFirst({
        where: { id: customerId, merchantId },
        select: { id: true },
      })
    : await prisma.customer.findFirst({
        where: { merchantId, anonIds: { has: anonId } },
        select: { id: true },
      })

  if (!customer) return new Set<string>()

  const memberships = await prisma.segmentMembership.findMany({
    where: { customerId: customer.id, exitedAt: null, segment: { merchantId } },
    select: { segmentId: true },
  })
  return new Set(memberships.map((m) => m.segmentId))
}

// ─── Delivery selection ───────────────────────────────────────────────────────

/**
 * The core delivery query. Returns every ACTIVE element eligible for this
 * visitor — segment gate + optional page-pattern gate — with any A/B variant
 * already resolved. The SDK enforces the *timing* of each element's trigger
 * (exit-intent, timed, cart-value, restock) client-side using `displayRules`.
 */
export async function selectElementsForVisitor(
  merchantId: string,
  ctx: OnSiteDeliveryRequest,
): Promise<OnSiteDeliveryElement[]> {
  const elements = await prisma.onSiteElement.findMany({
    where: { merchantId, status: 'ACTIVE' },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })
  if (elements.length === 0) return []

  const visitorSegments = await resolveVisitorSegments(merchantId, ctx.anonId, ctx.customerId)

  // Load running / decided A/B tests for these elements in one query.
  const tests = await prisma.abTest.findMany({
    where: {
      merchantId,
      entityType: 'ONSITE_ELEMENT',
      entityId: { in: elements.map((e) => e.id) },
      status: { in: ['RUNNING', 'WINNER_DECIDED'] },
    },
    select: { id: true, entityId: true, status: true, variants: true, winnerVariantId: true },
  })
  const testByElementId = new Map<string, ActiveAbTest>()
  for (const t of tests) {
    if (!t.entityId) continue
    testByElementId.set(t.entityId, {
      id: t.id,
      status: t.status,
      variants: (t.variants as unknown as OnSiteVariant[]) ?? [],
      winnerVariantId: t.winnerVariantId,
    })
  }

  const out: OnSiteDeliveryElement[] = []
  for (const el of elements) {
    // Segment gate: null segmentId = show to all; otherwise the visitor must be a member.
    if (el.segmentId && !visitorSegments.has(el.segmentId)) continue

    const rules = (el.displayRules as unknown as OnSiteDisplayRules) ?? { trigger: 'timed' }
    if (!matchesPage(rules.pagePattern, ctx.pagePath)) continue

    const base = (el.config as unknown as OnSiteElementConfig) ?? {}
    const resolved = resolveElementConfig(ctx.anonId, base, testByElementId.get(el.id))

    out.push({
      id: el.id,
      type: el.type as OnSiteElementTypeName,
      config: resolved.config,
      displayRules: rules,
      ...(resolved.abTestId ? { abTestId: resolved.abTestId } : {}),
      ...(resolved.variantId ? { variantId: resolved.variantId } : {}),
    })
  }
  return out
}
