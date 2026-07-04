import { PrismaClient, Role, Plan, Channel, CampaignStatus, RfmSegment } from '@prisma/client'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
// lane:flows START — pre-built flow library seeder (system FlowTemplate rows, guide §7.6)
import { seedFlowTemplates } from './flow-templates.seed.js'
// lane:flows END

const prisma = new PrismaClient()

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

function generateApiKey(): { raw: string; prefix: string } {
  const raw = `eiq_${randomBytes(32).toString('hex')}`
  const prefix = raw.slice(0, 12)
  return { raw, prefix }
}

async function main() {
  console.log('🌱 Seeding database...')

  const passwordHash = await hashPassword('Test1234!')

  // ── Test Merchant ──────────────────────────────────────────────────────────
  const merchant = await prisma.merchant.upsert({
    where: { shopifyDomain: 'test-store.myshopify.com' },
    update: {},
    create: {
      name: 'Test Store (Swift Studioz)',
      shopifyDomain: 'test-store.myshopify.com',
      shopifyShopId: 'test-shop-123',
      plan: Plan.GROWTH,
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    },
  })
  console.log(`✓ Merchant: ${merchant.name} (${merchant.id})`)

  // ── Owner User ─────────────────────────────────────────────────────────────
  const owner = await prisma.user.upsert({
    where: { merchantId_email: { merchantId: merchant.id, email: 'owner@test-store.com' } },
    update: {},
    create: {
      merchantId: merchant.id,
      email: 'owner@test-store.com',
      passwordHash,
      firstName: 'Ali',
      lastName: 'Khan',
      role: Role.OWNER,
    },
  })
  console.log(`✓ User (owner): ${owner.email}`)

  const analyst = await prisma.user.upsert({
    where: { merchantId_email: { merchantId: merchant.id, email: 'analyst@test-store.com' } },
    update: {},
    create: {
      merchantId: merchant.id,
      email: 'analyst@test-store.com',
      passwordHash,
      firstName: 'Sara',
      lastName: 'Ahmed',
      role: Role.ANALYST,
    },
  })
  console.log(`✓ User (analyst): ${analyst.email}`)

  // ── API Key ────────────────────────────────────────────────────────────────
  const existingKey = await prisma.apiKey.findFirst({ where: { merchantId: merchant.id } })
  if (!existingKey) {
    const { raw, prefix } = generateApiKey()
    const keyHash = await bcrypt.hash(raw, 12)
    await prisma.apiKey.create({
      data: {
        merchantId: merchant.id,
        name: 'Default API Key',
        keyHash,
        keyPrefix: prefix,
      },
    })
    console.log(`✓ API Key created (save this — shown once): ${raw}`)
  } else {
    console.log(`✓ API Key already exists (prefix: ${existingKey.keyPrefix})`)
  }

  // ── Test Customers ─────────────────────────────────────────────────────────
  const customerData = [
    {
      shopifyCustomerId: 'shopify-cust-001',
      email: 'fatima.malik@gmail.com',
      phone: '+923001234567',
      firstName: 'Fatima',
      lastName: 'Malik',
      city: 'Lahore',
      province: 'Punjab',
      totalOrders: 12,
      totalSpent: 47800,
      avgOrderValue: 3983,
      rfmSegment: RfmSegment.CHAMPION,
      rfmRecencyScore: 5,
      rfmFrequencyScore: 5,
      rfmMonetaryScore: 4,
      churnScore: 0.05,
      codOrderCount: 2,
      codAcceptanceRate: 1.0,
      isSubscribedWhatsapp: true,
    },
    {
      shopifyCustomerId: 'shopify-cust-002',
      email: 'usman.baig@hotmail.com',
      phone: '+923321234567',
      firstName: 'Usman',
      lastName: 'Baig',
      city: 'Karachi',
      province: 'Sindh',
      totalOrders: 3,
      totalSpent: 8900,
      avgOrderValue: 2967,
      rfmSegment: RfmSegment.PROMISING,
      rfmRecencyScore: 4,
      rfmFrequencyScore: 2,
      rfmMonetaryScore: 2,
      churnScore: 0.22,
      codOrderCount: 3,
      codAcceptanceRate: 0.67,
      isSubscribedWhatsapp: true,
    },
    {
      shopifyCustomerId: 'shopify-cust-003',
      email: 'hina.shahid@yahoo.com',
      phone: '+923451234567',
      firstName: 'Hina',
      lastName: 'Shahid',
      city: 'Islamabad',
      province: 'ICT',
      totalOrders: 1,
      totalSpent: 2500,
      avgOrderValue: 2500,
      rfmSegment: RfmSegment.NEW_CUSTOMER,
      rfmRecencyScore: 5,
      rfmFrequencyScore: 1,
      rfmMonetaryScore: 1,
      churnScore: 0.45,
      codOrderCount: 1,
      codAcceptanceRate: 1.0,
      isSubscribedWhatsapp: false,
    },
    {
      shopifyCustomerId: 'shopify-cust-004',
      email: 'tariq.hussain@gmail.com',
      phone: '+923011234567',
      firstName: 'Tariq',
      lastName: 'Hussain',
      city: 'Faisalabad',
      province: 'Punjab',
      totalOrders: 8,
      totalSpent: 19600,
      avgOrderValue: 2450,
      rfmSegment: RfmSegment.AT_RISK,
      rfmRecencyScore: 1,
      rfmFrequencyScore: 4,
      rfmMonetaryScore: 3,
      churnScore: 0.78,
      codOrderCount: 7,
      codAcceptanceRate: 0.57,
      isSubscribedWhatsapp: true,
    },
    {
      shopifyCustomerId: 'shopify-cust-005',
      email: 'zara.niazi@gmail.com',
      phone: '+923151234567',
      firstName: 'Zara',
      lastName: 'Niazi',
      city: 'Lahore',
      province: 'Punjab',
      totalOrders: 0,
      totalSpent: 0,
      avgOrderValue: 0,
      rfmSegment: null,
      rfmRecencyScore: null,
      rfmFrequencyScore: null,
      rfmMonetaryScore: null,
      churnScore: null,
      codOrderCount: 0,
      codAcceptanceRate: null,
      isSubscribedWhatsapp: true,
    },
  ]

  for (const c of customerData) {
    const now = new Date()
    const firstOrder = c.totalOrders > 0 ? new Date(now.getTime() - 180 * 86400_000) : null
    const lastOrder = c.totalOrders > 0 ? new Date(now.getTime() - 14 * 86400_000) : null

    await prisma.customer.upsert({
      where: { merchantId_shopifyCustomerId: { merchantId: merchant.id, shopifyCustomerId: c.shopifyCustomerId } },
      update: {},
      create: {
        merchantId: merchant.id,
        shopifyCustomerId: c.shopifyCustomerId,
        email: c.email,
        phone: c.phone,
        firstName: c.firstName,
        lastName: c.lastName,
        city: c.city,
        province: c.province,
        country: 'PK',
        languagePreference: 'en',
        totalOrders: c.totalOrders,
        totalSpent: c.totalSpent,
        avgOrderValue: c.avgOrderValue,
        firstOrderAt: firstOrder,
        lastOrderAt: lastOrder,
        rfmSegment: c.rfmSegment,
        rfmRecencyScore: c.rfmRecencyScore,
        rfmFrequencyScore: c.rfmFrequencyScore,
        rfmMonetaryScore: c.rfmMonetaryScore,
        rfmScoredAt: c.rfmSegment ? now : null,
        churnScore: c.churnScore,
        churnRiskLabel: c.churnScore == null ? null
          : c.churnScore < 0.3 ? 'LOW'
          : c.churnScore < 0.5 ? 'MEDIUM'
          : c.churnScore < 0.75 ? 'HIGH'
          : 'CRITICAL',
        codOrderCount: c.codOrderCount,
        codAcceptanceRate: c.codAcceptanceRate ?? null,
        isSubscribedEmail: true,
        isSubscribedSms: true,
        isSubscribedWhatsapp: c.isSubscribedWhatsapp,
      },
    })
    console.log(`✓ Customer: ${c.firstName} ${c.lastName} (${c.city})`)
  }

  // ── Test Segment ───────────────────────────────────────────────────────────
  const segment = await prisma.segment.upsert({
    where: { id: 'seed-segment-champions' },
    update: {},
    create: {
      id: 'seed-segment-champions',
      merchantId: merchant.id,
      name: 'Champions',
      description: 'High-value customers who buy frequently and recently.',
      conditions: {
        operator: 'AND',
        rules: [
          { field: 'rfm_segment', operator: 'equals', value: 'CHAMPION' },
        ],
      },
      isDynamic: true,
      memberCount: 1,
    },
  })
  console.log(`✓ Segment: ${segment.name}`)

  // ── Test Campaign ──────────────────────────────────────────────────────────
  await prisma.campaign.upsert({
    where: { id: 'seed-campaign-001' },
    update: {},
    create: {
      id: 'seed-campaign-001',
      merchantId: merchant.id,
      name: 'Eid Mubarak — Champions Offer',
      channel: Channel.WHATSAPP,
      status: CampaignStatus.DRAFT,
      segmentId: segment.id,
      subject: null,
      content: {
        templateName: 'eid_champions_offer',
        variables: ['{{first_name}}', '{{discount_code}}'],
      },
      utmCampaign: 'eid-2026-champions',
      utmSource: 'engageiq',
      utmMedium: 'whatsapp',
    },
  })
  console.log(`✓ Campaign: Eid Mubarak — Champions Offer`)

  // lane:flows START — system-wide pre-built flow library (not merchant-scoped)
  await seedFlowTemplates(prisma)
  // lane:flows END

  console.log('\n✅ Seed complete.')
  console.log(`\nTest credentials:`)
  console.log(`  Owner:    owner@test-store.com / Test1234!`)
  console.log(`  Analyst:  analyst@test-store.com / Test1234!`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
