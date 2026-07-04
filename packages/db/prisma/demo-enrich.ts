/**
 * demo-enrich.ts — populates the canonical `engageiq` DB with realistic sample data
 * so the whole product can be reviewed end-to-end in a browser.
 *
 * Idempotent: upserts by deterministic ids; ClickHouse events are only inserted if the
 * merchant currently has none (CH MergeTree does not dedupe).
 *
 * Run:  DOTENV_CONFIG_PATH=<repo>/.env pnpm --filter @engageiq/db exec tsx prisma/demo-enrich.ts
 */
import {
  PrismaClient,
  Channel,
  CampaignStatus,
  JourneyStatus,
  JourneyStepType,
  EnrollmentStatus,
  CodOrderStatus,
  CodVerificationStatus,
  TemplateStatus,
  TemplateCategory,
  MessageDirection,
  MessageStatus,
  CampaignRecipientStatus,
  RecommendationType,
} from '@prisma/client'
import { insertEvents, getEventCountsByType, type EngageIQEvent } from '@engageiq/db'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY)
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000)

async function main() {
  const merchant = await prisma.merchant.findFirstOrThrow({
    where: { shopifyDomain: 'test-store.myshopify.com' },
  })
  const mId = merchant.id
  console.log(`Enriching merchant ${merchant.name} (${mId})`)

  const customers = await prisma.customer.findMany({ where: { merchantId: mId } })
  const byEmail = (e: string) => customers.find((c) => c.email === e)!
  const fatima = byEmail('fatima.malik@gmail.com')
  const usman = byEmail('usman.baig@hotmail.com')
  const hina = byEmail('hina.shahid@yahoo.com')
  const tariq = byEmail('tariq.hussain@gmail.com')

  // ── Products ───────────────────────────────────────────────────────────────
  const products = [
    { sid: 'prod-1001', title: 'Lawn Kurta — Embroidered', type: 'Apparel', price: 4500 },
    { sid: 'prod-1002', title: 'Leather Khussa', type: 'Footwear', price: 3200 },
    { sid: 'prod-1003', title: 'Silk Dupatta', type: 'Accessories', price: 2100 },
    { sid: 'prod-1004', title: 'Unstitched 3pc Suit', type: 'Apparel', price: 6800 },
  ]
  for (const p of products) {
    await prisma.product.upsert({
      where: { merchantId_shopifyProductId: { merchantId: mId, shopifyProductId: p.sid } },
      update: {},
      create: {
        merchantId: mId,
        shopifyProductId: p.sid,
        title: p.title,
        handle: p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        productType: p.type,
        status: 'active',
        priceMin: p.price,
        priceMax: p.price,
        repurchaseRate90d: 0.18,
        crossSellRate: 0.12,
        avgBuyerLtv: p.price * 2.4,
        analyticsComputedAt: new Date(),
      },
    })
  }
  console.log(`✓ Products: ${products.length}`)

  // ── Orders + COD orders ──────────────────────────────────────────────────────
  // [customer, shopifyOrderId, number, total, isCod, placedDaysAgo, gateway, codStatus?]
  type O = {
    cust: typeof fatima
    sid: string
    num: string
    total: number
    isCod: boolean
    days: number
    codStatus?: CodOrderStatus
    fakeScore?: number
  }
  const orders: O[] = [
    { cust: fatima, sid: 'demo-ord-001', num: '1001', total: 4500, isCod: false, days: 170 },
    { cust: fatima, sid: 'demo-ord-002', num: '1002', total: 6800, isCod: true, days: 90, codStatus: CodOrderStatus.DELIVERED, fakeScore: 8 },
    { cust: fatima, sid: 'demo-ord-003', num: '1003', total: 5300, isCod: true, days: 12, codStatus: CodOrderStatus.DELIVERED, fakeScore: 11 },
    { cust: fatima, sid: 'demo-ord-004', num: '1004', total: 3200, isCod: false, days: 0 },
    { cust: usman, sid: 'demo-ord-010', num: '1010', total: 2967, isCod: true, days: 60, codStatus: CodOrderStatus.DELIVERED, fakeScore: 22 },
    { cust: usman, sid: 'demo-ord-011', num: '1011', total: 2100, isCod: true, days: 30, codStatus: CodOrderStatus.RETURNED, fakeScore: 64 },
    { cust: usman, sid: 'demo-ord-012', num: '1012', total: 3833, isCod: true, days: 0, codStatus: CodOrderStatus.PENDING, fakeScore: 41 },
    { cust: hina, sid: 'demo-ord-020', num: '1020', total: 2500, isCod: true, days: 5, codStatus: CodOrderStatus.CONFIRMED, fakeScore: 33 },
    { cust: tariq, sid: 'demo-ord-030', num: '1030', total: 2450, isCod: true, days: 150, codStatus: CodOrderStatus.DELIVERED, fakeScore: 18 },
    { cust: tariq, sid: 'demo-ord-031', num: '1031', total: 2450, isCod: true, days: 120, codStatus: CodOrderStatus.RETURNED, fakeScore: 71 },
    { cust: tariq, sid: 'demo-ord-032', num: '1032', total: 2450, isCod: true, days: 95, codStatus: CodOrderStatus.RETURNED, fakeScore: 77 },
    { cust: tariq, sid: 'demo-ord-033', num: '1033', total: 4900, isCod: false, days: 40 },
  ]
  for (const o of orders) {
    const placedAt = daysAgo(o.days)
    const lineItems = [
      { product_id: products[0].sid, title: products[0].title, quantity: 1, price: Math.round(o.total * 0.6), sku: 'SKU-1001' },
      { product_id: products[2].sid, title: products[2].title, quantity: 1, price: Math.round(o.total * 0.4), sku: 'SKU-1003' },
    ]
    await prisma.order.upsert({
      where: { merchantId_shopifyOrderId: { merchantId: mId, shopifyOrderId: o.sid } },
      update: {},
      create: {
        merchantId: mId,
        customerId: o.cust.id,
        shopifyOrderId: o.sid,
        orderNumber: o.num,
        totalPrice: o.total,
        subtotalPrice: o.total,
        currency: 'PKR',
        financialStatus: o.isCod ? 'pending' : 'paid',
        fulfillmentStatus: o.codStatus === CodOrderStatus.DELIVERED ? 'fulfilled' : null,
        paymentGateway: o.isCod ? 'Cash on Delivery' : 'Card',
        isCod: o.isCod,
        lineItems,
        placedAt,
      },
    })
    if (o.isCod) {
      await prisma.codOrder.upsert({
        where: { merchantId_shopifyOrderId: { merchantId: mId, shopifyOrderId: o.sid } },
        update: {},
        create: {
          merchantId: mId,
          customerId: o.cust.id,
          shopifyOrderId: o.sid,
          orderNumber: o.num,
          amount: o.total,
          city: o.cust.city,
          province: o.cust.province,
          courier: ['PostEx', 'Leopards', 'TCS'][o.num.charCodeAt(3) % 3],
          paymentGateway: 'Cash on Delivery',
          status: o.codStatus ?? CodOrderStatus.PENDING,
          verificationStatus:
            (o.fakeScore ?? 0) > 60 ? CodVerificationStatus.PENDING_VERIFICATION : CodVerificationStatus.VERIFIED,
          fakeScore: o.fakeScore ?? null,
          fakeScoreDetails: { reasons: (o.fakeScore ?? 0) > 60 ? ['high_return_history', 'address_mismatch'] : ['ok'] },
          placedAt,
          deliveredAt: o.codStatus === CodOrderStatus.DELIVERED ? daysAgo(o.days - 3) : null,
          returnedAt: o.codStatus === CodOrderStatus.RETURNED ? daysAgo(o.days - 5) : null,
        },
      })
    }
  }
  console.log(`✓ Orders: ${orders.length} (COD: ${orders.filter((o) => o.isCod).length})`)

  // Backfill fake_order_score on customers from their COD history
  await prisma.customer.update({ where: { id: usman.id }, data: { fakeOrderScore: 42, codRejectionRate: 0.33 } })
  await prisma.customer.update({ where: { id: tariq.id }, data: { fakeOrderScore: 68, codRejectionRate: 0.43 } })
  await prisma.customer.update({ where: { id: fatima.id }, data: { fakeOrderScore: 6, ltv90d: 12000, ltv180d: 21000, ltv365d: 38000, ltvScoredAt: new Date() } })

  // ── WhatsApp templates ───────────────────────────────────────────────────────
  const tplUtility = await prisma.whatsAppTemplate.upsert({
    where: { merchantId_name_language: { merchantId: mId, name: 'order_confirmation', language: 'en' } },
    update: {},
    create: {
      merchantId: mId,
      name: 'order_confirmation',
      language: 'en',
      category: TemplateCategory.UTILITY,
      bodyText: 'Hi {{1}}, your order {{2}} has been confirmed. We will deliver it soon. Thank you for shopping with us!',
      variableMap: [
        { index: 1, field: 'first_name' },
        { index: 2, field: 'order_number' },
      ],
      status: TemplateStatus.APPROVED,
      metaTemplateId: 'meta-tpl-demo-001',
    },
  })
  await prisma.whatsAppTemplate.upsert({
    where: { merchantId_name_language: { merchantId: mId, name: 'eid_champions_offer', language: 'ur' } },
    update: {},
    create: {
      merchantId: mId,
      name: 'eid_champions_offer',
      language: 'ur',
      category: TemplateCategory.MARKETING,
      bodyText: 'عید مبارک {{1}}! ہمارے بہترین گاہک کے لیے خصوصی {{2}} رعایت۔ ابھی خریداری کریں۔',
      variableMap: [
        { index: 1, field: 'first_name' },
        { index: 2, field: 'discount_code' },
      ],
      status: TemplateStatus.APPROVED,
      metaTemplateId: 'meta-tpl-demo-002',
    },
  })
  console.log('✓ WhatsApp templates: 2')

  // ── Messages (message log) ────────────────────────────────────────────────────
  const msgs = [
    { id: 'demo-msg-001', cust: fatima, dir: MessageDirection.OUTBOUND, status: MessageStatus.READ, body: 'Hi Fatima, your order 1003 has been confirmed.', daysAgo: 12 },
    { id: 'demo-msg-002', cust: usman, dir: MessageDirection.OUTBOUND, status: MessageStatus.DELIVERED, body: 'Hi Usman, your order 1012 is on the way.', daysAgo: 0 },
    { id: 'demo-msg-003', cust: tariq, dir: MessageDirection.OUTBOUND, status: MessageStatus.SENT, body: 'Hi Tariq, please confirm your COD order 1033.', daysAgo: 1 },
    { id: 'demo-msg-004', cust: hina, dir: MessageDirection.OUTBOUND, status: MessageStatus.FAILED, body: 'Hi Hina, your order has shipped.', daysAgo: 4, err: '131049', errTitle: 'Re-engagement message' },
    { id: 'demo-msg-005', cust: fatima, dir: MessageDirection.INBOUND, status: MessageStatus.RECEIVED, body: 'Thank you! When will it arrive?', daysAgo: 11 },
  ]
  for (const m of msgs) {
    await prisma.message.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        merchantId: mId,
        customerId: m.cust.id,
        channel: Channel.WHATSAPP,
        direction: m.dir,
        templateId: m.dir === MessageDirection.OUTBOUND ? tplUtility.id : null,
        status: m.status,
        body: m.body,
        toPhone: m.cust.phone ?? '+923000000000',
        fromPhone: m.dir === MessageDirection.INBOUND ? m.cust.phone : null,
        errorCode: m.err ?? null,
        errorTitle: m.errTitle ?? null,
        sentAt: m.dir === MessageDirection.OUTBOUND ? daysAgo(m.daysAgo) : null,
        deliveredAt: [MessageStatus.DELIVERED, MessageStatus.READ].includes(m.status) ? daysAgo(m.daysAgo) : null,
        readAt: m.status === MessageStatus.READ ? daysAgo(m.daysAgo) : null,
        failedAt: m.status === MessageStatus.FAILED ? daysAgo(m.daysAgo) : null,
        createdAt: daysAgo(m.daysAgo),
      },
    })
  }
  console.log(`✓ Messages: ${msgs.length}`)

  // ── Segment membership (Champions → Fatima) ──────────────────────────────────
  const champions = await prisma.segment.findFirst({ where: { merchantId: mId, name: 'Champions' } })
  if (champions) {
    const existing = await prisma.segmentMembership.findFirst({ where: { segmentId: champions.id, customerId: fatima.id, exitedAt: null } })
    if (!existing) {
      await prisma.segmentMembership.create({ data: { segmentId: champions.id, customerId: fatima.id } })
    }
    await prisma.segment.update({ where: { id: champions.id }, data: { memberCount: 1, lastEvaluatedAt: new Date() } })
  }
  console.log('✓ Segment membership wired')

  // ── Campaign recipients for the seed campaign ────────────────────────────────
  const campaign = await prisma.campaign.findFirst({ where: { merchantId: mId } })
  if (campaign) {
    for (const c of [fatima, usman]) {
      await prisma.campaignRecipient.upsert({
        where: { campaignId_customerId: { campaignId: campaign.id, customerId: c.id } },
        update: {},
        create: { merchantId: mId, campaignId: campaign.id, customerId: c.id, status: CampaignRecipientStatus.PENDING },
      })
    }
    await prisma.campaign.update({ where: { id: campaign.id }, data: { recipientCount: 2 } })
  }
  console.log('✓ Campaign recipients: 2')

  // ── Journey (Abandoned Cart WhatsApp) + steps + enrollment ───────────────────
  const journeyId = 'demo-journey-abandoned-cart'
  await prisma.journey.upsert({
    where: { id: journeyId },
    update: {},
    create: {
      id: journeyId,
      merchantId: mId,
      name: 'Abandoned Cart — WhatsApp Recovery',
      description: 'When a checkout is abandoned, wait 1h then send a WhatsApp nudge; exit on purchase.',
      triggerType: 'checkout_abandoned',
      triggerConfig: { event: 'checkout_abandoned' },
      status: JourneyStatus.ACTIVE,
      exitTrigger: 'order_placed',
      enrollmentCount: 2,
      completionCount: 1,
    },
  })
  const steps = [
    { id: 'demo-step-trigger', type: JourneyStepType.TRIGGER, parent: null, x: 0, y: 0, label: 'Cart abandoned', config: { trigger: 'checkout_abandoned' } },
    { id: 'demo-step-delay', type: JourneyStepType.DELAY, parent: 'demo-step-trigger', x: 0, y: 150, label: 'Wait 1 hour', config: { delayMinutes: 60 } },
    { id: 'demo-step-action', type: JourneyStepType.ACTION, parent: 'demo-step-delay', x: 0, y: 300, label: 'Send WhatsApp', config: { channel: 'WHATSAPP', content: { body: 'You left items in your cart! Complete your order now.' } } },
    { id: 'demo-step-condition', type: JourneyStepType.CONDITION, parent: 'demo-step-action', x: 0, y: 450, label: 'Purchased?', config: { field: 'totalOrders', operator: 'greater_than', value: 0 } },
  ]
  for (const s of steps) {
    await prisma.journeyStep.upsert({
      where: { id: s.id },
      update: {},
      create: { id: s.id, journeyId, parentStepId: s.parent, stepType: s.type, config: s.config, positionX: s.x, positionY: s.y, label: s.label },
    })
  }
  for (const [i, cust] of [usman, hina].entries()) {
    const enrId = `demo-enr-${i}`
    const existing = await prisma.journeyEnrollment.findUnique({ where: { id: enrId } })
    if (!existing) {
      await prisma.journeyEnrollment.create({
        data: {
          id: enrId,
          journeyId,
          customerId: cust.id,
          currentStepId: i === 0 ? 'demo-step-action' : 'demo-step-condition',
          status: i === 0 ? EnrollmentStatus.ACTIVE : EnrollmentStatus.COMPLETED,
          completedAt: i === 0 ? null : daysAgo(2),
          lastStepAt: daysAgo(i + 1),
        },
      })
    }
  }
  console.log('✓ Journey + 4 steps + 2 enrollments')

  // ── Recommendations + ModelRun audit rows ────────────────────────────────────
  for (const [cust, type, pids] of [
    [fatima, RecommendationType.ALSO_BOUGHT, ['prod-1002', 'prod-1003']],
    [usman, RecommendationType.MIGHT_LIKE, ['prod-1004', 'prod-1001']],
    [tariq, RecommendationType.RESTOCK, ['prod-1001']],
  ] as const) {
    await prisma.recommendation.upsert({
      where: { merchantId_customerId_type: { merchantId: mId, customerId: cust.id, type } },
      update: {},
      create: { merchantId: mId, customerId: cust.id, type, productIds: [...pids], score: 0.82 },
    })
  }
  for (const [name, ver, rows] of [
    ['rfm', 'v1', 5],
    ['churn', 'v1', 4],
    ['ltv', 'v1', 1],
    ['fake-order', 'v1', 6],
  ] as const) {
    await prisma.modelRun.create({
      data: { merchantId: mId, modelName: name, modelVersion: ver, status: 'success', rowCount: rows, durationMs: 1200 + rows * 30, metadata: { trigger: 'demo-enrich' } },
    })
  }
  console.log('✓ Recommendations: 3 · ModelRuns: 4')

  // ── ClickHouse events (only if merchant has none) ─────────────────────────────
  const existingCounts = await getEventCountsByType(mId, daysAgo(365), new Date())
  const existingTotal = existingCounts.reduce((s, r) => s + r.count, 0)
  if (existingTotal > 0) {
    console.log(`✓ ClickHouse: merchant already has ${existingTotal} events — skipping CH seed`)
  } else {
    const events: EngageIQEvent[] = []
    const visitors = [
      { id: fatima.id, anon: null },
      { id: usman.id, anon: null },
      { id: hina.id, anon: null },
      { id: tariq.id, anon: null },
      { id: null, anon: 'anon-aaa' },
      { id: null, anon: 'anon-bbb' },
      { id: null, anon: 'anon-ccc' },
      { id: null, anon: 'anon-ddd' },
    ]
    const mk = (v: (typeof visitors)[number], type: string, ts: Date, props: Record<string, unknown> = {}): EngageIQEvent => ({
      event_id: randomUUID(),
      merchant_id: mId,
      customer_id: v.id,
      anon_id: v.anon,
      event_type: type,
      properties: props,
      session_id: `sess-${(v.id ?? v.anon)!.slice(-4)}-${Math.floor(ts.getTime() / DAY)}`,
      page_url: 'https://test-store.myshopify.com/',
      ip: '203.0.113.10',
      user_agent: 'Mozilla/5.0 (demo)',
      timestamp: ts,
    })
    // Historical funnel over the last 30 days: everyone page_views + product_views, most add_to_cart, some checkout, fewer purchase
    for (let d = 30; d >= 1; d--) {
      for (const v of visitors) {
        const base = daysAgo(d)
        events.push(mk(v, 'page_view', new Date(base.getTime() + 1000)))
        events.push(mk(v, 'product_view', new Date(base.getTime() + 60_000), { product_id: 'prod-1001' }))
        // ~75% add to cart
        if ((d + (v.anon ? 1 : 0)) % 4 !== 0) events.push(mk(v, 'add_to_cart', new Date(base.getTime() + 120_000), { product_id: 'prod-1001' }))
        // ~50% checkout
        if (d % 2 === 0) events.push(mk(v, 'checkout_started', new Date(base.getTime() + 180_000)))
        // ~30% purchase with revenue
        if (d % 3 === 0) events.push(mk(v, 'purchase', new Date(base.getTime() + 240_000), { revenue: 3500 + (d % 5) * 800, order_id: `ev-ord-${d}` }))
      }
    }
    // Recent activity (last 30 min) → drives "active visitors" KPI
    for (const v of visitors.slice(0, 5)) {
      events.push(mk(v, 'page_view', minsAgo(5 + (v.anon ? 3 : 1))))
      events.push(mk(v, 'product_view', minsAgo(3), { product_id: 'prod-1004' }))
    }
    await insertEvents(events, { waitForInsert: true })
    console.log(`✓ ClickHouse events inserted: ${events.length}`)
  }

  console.log('\n✅ demo-enrich complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
