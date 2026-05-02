import { prisma, clickhouse } from '@engageiq/db'
import type { EnrichedCustomerProfile, CustomerEventStats } from '@engageiq/shared'
import type { CustomerListItem } from './schema.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListCustomersResult {
  customers: CustomerListItem[]
  total: number
}

interface ClickHouseEventStatsRow {
  page_view_count: string
  add_to_cart_count: string
  checkout_started_count: string
  session_count: string
}

// ---------------------------------------------------------------------------
// ClickHouse helpers
// ---------------------------------------------------------------------------

async function fetchEventStats(
  merchantId: string,
  customerId: string,
  anonIds: string[],
  mergedFromIds: string[],
): Promise<CustomerEventStats> {
  try {
    const extraConditions: string[] = []
    if (anonIds.length > 0) extraConditions.push(`has({anonIds:Array(String)}, anon_id)`)
    if (mergedFromIds.length > 0) extraConditions.push(`has({mergedFromIds:Array(String)}, customer_id)`)

    const whereExtra = extraConditions.length > 0
      ? `OR (${extraConditions.join(' OR ')})`
      : ''

    const query = `
        SELECT
          countIf(event_type = 'page_view')         AS page_view_count,
          countIf(event_type = 'add_to_cart')       AS add_to_cart_count,
          countIf(event_type = 'checkout_started')  AS checkout_started_count,
          uniqExact(session_id)                     AS session_count
        FROM engageiq.events
        WHERE merchant_id = {merchantId:String}
          AND (customer_id = {customerId:String} ${whereExtra})
      `

    const queryParams: Record<string, unknown> = { merchantId, customerId }
    if (anonIds.length > 0) queryParams.anonIds = anonIds
    if (mergedFromIds.length > 0) queryParams.mergedFromIds = mergedFromIds

    const result = await clickhouse.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    })

    const rows = await result.json<ClickHouseEventStatsRow>()

    if (rows.length === 0) {
      return { pageViewCount: 0, addToCartCount: 0, checkoutStartedCount: 0, sessionCount: 0 }
    }

    const row = rows[0]!
    return {
      pageViewCount: Number(row.page_view_count),
      addToCartCount: Number(row.add_to_cart_count),
      checkoutStartedCount: Number(row.checkout_started_count),
      sessionCount: Number(row.session_count),
    }
  } catch {
    // ClickHouse unavailable — return zero stats rather than failing the whole profile fetch
    return { pageViewCount: 0, addToCartCount: 0, checkoutStartedCount: 0, sessionCount: 0 }
  }
}

// ---------------------------------------------------------------------------
// getCustomerProfile
// ---------------------------------------------------------------------------

export async function getCustomerProfile(
  merchantId: string,
  customerId: string,
): Promise<EnrichedCustomerProfile> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, merchantId },
    include: {
      segmentMemberships: {
        where: { exitedAt: null },
        include: {
          segment: { select: { name: true } },
        },
      },
      journeyEnrollments: {
        where: { status: 'ACTIVE' },
        include: {
          journey: { select: { name: true } },
        },
      },
      orders: {
        orderBy: { placedAt: 'desc' },
        take: 10,
      },
      abandonedCheckouts: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  })

  if (!customer) {
    const err = new Error('CUSTOMER_NOT_FOUND')
    ;(err as Error & { code: string }).code = 'CUSTOMER_NOT_FOUND'
    throw err
  }

  const mergedFromCustomers = await prisma.customer.findMany({
    where: { mergedIntoId: customerId, merchantId },
    select: { id: true },
  })
  const mergedFromIds = mergedFromCustomers.map((c) => c.id)

  const eventStats = await fetchEventStats(merchantId, customerId, customer.anonIds, mergedFromIds)

  const profile: EnrichedCustomerProfile = {
    // Core identity
    id: customer.id,
    merchantId: customer.merchantId,
    shopifyCustomerId: customer.shopifyCustomerId,
    email: customer.email,
    phone: customer.phone,
    firstName: customer.firstName,
    lastName: customer.lastName,
    city: customer.city,
    province: customer.province,
    country: customer.country,
    languagePreference: customer.languagePreference,
    tags: customer.tags,

    // Shopify aggregates
    totalOrders: customer.totalOrders,
    totalSpent: customer.totalSpent.toString(),
    avgOrderValue: customer.avgOrderValue.toString(),
    firstOrderAt: customer.firstOrderAt?.toISOString() ?? null,
    lastOrderAt: customer.lastOrderAt?.toISOString() ?? null,

    // Behavioral
    lastSeenAt: customer.lastSeenAt?.toISOString() ?? null,
    sessionCount: customer.sessionCount,
    eventStats,

    // RFM
    rfmSegment: customer.rfmSegment,
    rfmRecencyScore: customer.rfmRecencyScore,
    rfmFrequencyScore: customer.rfmFrequencyScore,
    rfmMonetaryScore: customer.rfmMonetaryScore,
    rfmScoredAt: customer.rfmScoredAt?.toISOString() ?? null,

    // AI scores
    churnScore: customer.churnScore,
    churnRiskLabel: customer.churnRiskLabel,
    churnScoredAt: customer.churnScoredAt?.toISOString() ?? null,
    ltv90d: customer.ltv90d?.toString() ?? null,
    ltv180d: customer.ltv180d?.toString() ?? null,
    ltv365d: customer.ltv365d?.toString() ?? null,
    ltvScoredAt: customer.ltvScoredAt?.toISOString() ?? null,

    // COD profile
    codOrderCount: customer.codOrderCount,
    codAcceptanceRate: customer.codAcceptanceRate,
    codRejectionRate: customer.codRejectionRate,
    fakeOrderScore: customer.fakeOrderScore,
    isBlocked: customer.isBlocked,

    // Channel opt-ins
    isSubscribedEmail: customer.isSubscribedEmail,
    isSubscribedSms: customer.isSubscribedSms,
    isSubscribedWhatsapp: customer.isSubscribedWhatsapp,

    // Multi-store / identity resolution
    groupCustomerId: customer.groupCustomerId,
    mergedIntoId: customer.mergedIntoId,
    mergedAt: customer.mergedAt?.toISOString() ?? null,
    anonIds: customer.anonIds,

    // Related data
    segmentMemberships: customer.segmentMemberships.map((sm) => ({
      segmentId: sm.segmentId,
      segmentName: sm.segment.name,
      enteredAt: sm.enteredAt.toISOString(),
    })),
    journeyEnrollments: customer.journeyEnrollments.map((je) => ({
      journeyId: je.journeyId,
      journeyName: je.journey.name,
      status: je.status,
      enrolledAt: je.enrolledAt.toISOString(),
      currentStepId: je.currentStepId,
    })),
    recentOrders: customer.orders.map((o) => ({
      id: o.id,
      shopifyOrderId: o.shopifyOrderId,
      orderNumber: o.orderNumber,
      totalPrice: o.totalPrice.toString(),
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      isCod: o.isCod,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      placedAt: o.placedAt.toISOString(),
    })),
    recentAbandonedCheckouts: customer.abandonedCheckouts.map((ac) => ({
      id: ac.id,
      totalPrice: ac.totalPrice.toString(),
      lineItems: ac.lineItems,
      abandonedAt: ac.abandonedAt?.toISOString() ?? null,
      recoveredAt: ac.recoveredAt?.toISOString() ?? null,
    })),

    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  }

  return profile
}

// ---------------------------------------------------------------------------
// listCustomers
// ---------------------------------------------------------------------------

export async function listCustomers(
  merchantId: string,
  opts: { page: number; pageSize: number; search?: string },
): Promise<ListCustomersResult> {
  const { page, pageSize, search } = opts
  const skip = (page - 1) * pageSize

  const where = {
    merchantId,
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [customers, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        totalOrders: true,
        totalSpent: true,
        rfmSegment: true,
        churnRiskLabel: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ])

  return {
    customers: customers.map((c) => ({
      id: c.id,
      email: c.email,
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      totalOrders: c.totalOrders,
      totalSpent: c.totalSpent.toString(),
      rfmSegment: c.rfmSegment,
      churnRiskLabel: c.churnRiskLabel,
      lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
  }
}
