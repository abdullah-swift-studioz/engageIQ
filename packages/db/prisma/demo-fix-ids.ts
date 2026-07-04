/**
 * demo-fix-ids.ts — the seed creates the "Champions" segment and "Eid" campaign with
 * hardcoded NON-cuid ids ('seed-segment-champions', 'seed-campaign-001'); demo-enrich
 * created the journey with 'demo-journey-abandoned-cart'. The API detail routes validate
 * the id param as z.string().cuid(), so those rows 400 ("Invalid X ID") when opened in
 * the dashboard. This recreates all three (+ children) with real cuids so every list row
 * is clickable. Idempotent: skips if a cuid-keyed copy already exists.
 */
import {
  PrismaClient,
  Channel,
  CampaignStatus,
  JourneyStatus,
  JourneyStepType,
  EnrollmentStatus,
  CampaignRecipientStatus,
} from '@prisma/client'

const prisma = new PrismaClient()
const looksLikeCuid = (id: string) => /^c[a-z0-9]{20,}$/.test(id)

async function main() {
  const merchant = await prisma.merchant.findFirstOrThrow({ where: { shopifyDomain: 'test-store.myshopify.com' } })
  const mId = merchant.id
  const customers = await prisma.customer.findMany({ where: { merchantId: mId } })
  const byEmail = (e: string) => customers.find((c) => c.email === e)!
  const fatima = byEmail('fatima.malik@gmail.com')
  const usman = byEmail('usman.baig@hotmail.com')
  const hina = byEmail('hina.shahid@yahoo.com')

  // ── Segment + Campaign (recreate with cuids) ─────────────────────────────────
  const existingChampions = await prisma.segment.findFirst({ where: { merchantId: mId, name: 'Champions' } })
  if (existingChampions && !looksLikeCuid(existingChampions.id)) {
    // delete campaigns referencing it first (FK), then the segment (memberships cascade)
    await prisma.campaign.deleteMany({ where: { merchantId: mId, segmentId: existingChampions.id } })
    await prisma.segment.delete({ where: { id: existingChampions.id } })
    console.log(`✗ removed non-cuid segment ${existingChampions.id} (+ its campaign)`)
  }
  let champions = await prisma.segment.findFirst({ where: { merchantId: mId, name: 'Champions' } })
  if (!champions) {
    champions = await prisma.segment.create({
      data: {
        merchantId: mId,
        name: 'Champions',
        description: 'High-value customers who buy frequently and recently.',
        conditions: { operator: 'AND', rules: [{ field: 'rfm_segment', operator: 'equals', value: 'CHAMPION' }] },
        isDynamic: true,
        memberCount: 1,
        lastEvaluatedAt: new Date(),
      },
    })
    await prisma.segmentMembership.create({ data: { segmentId: champions.id, customerId: fatima.id } })
    console.log(`✓ Champions segment ${champions.id} (+ membership)`)
  }

  let campaign = await prisma.campaign.findFirst({ where: { merchantId: mId, name: { startsWith: 'Eid' } } })
  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        merchantId: mId,
        name: 'Eid Mubarak — Champions Offer',
        channel: Channel.WHATSAPP,
        status: CampaignStatus.DRAFT,
        segmentId: champions.id,
        content: { templateName: 'eid_champions_offer', variables: ['{{first_name}}', '{{discount_code}}'] },
        utmCampaign: 'eid-2026-champions',
        utmSource: 'engageiq',
        utmMedium: 'whatsapp',
        recipientCount: 2,
      },
    })
    for (const c of [fatima, usman]) {
      await prisma.campaignRecipient.create({
        data: { merchantId: mId, campaignId: campaign.id, customerId: c.id, status: CampaignRecipientStatus.PENDING },
      })
    }
    console.log(`✓ Campaign ${campaign.id} (+ 2 recipients)`)
  }

  // ── Journey (recreate with cuid + cuid steps) ────────────────────────────────
  const oldJourney = await prisma.journey.findFirst({ where: { merchantId: mId, name: { startsWith: 'Abandoned Cart' } } })
  if (oldJourney && !looksLikeCuid(oldJourney.id)) {
    await prisma.journey.delete({ where: { id: oldJourney.id } }) // steps + enrollments cascade
    console.log(`✗ removed non-cuid journey ${oldJourney.id}`)
  }
  let journey = await prisma.journey.findFirst({ where: { merchantId: mId, name: { startsWith: 'Abandoned Cart' } } })
  if (!journey) {
    journey = await prisma.journey.create({
      data: {
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
    const trigger = await prisma.journeyStep.create({ data: { journeyId: journey.id, stepType: JourneyStepType.TRIGGER, config: { trigger: 'checkout_abandoned' }, positionX: 250, positionY: 0, label: 'Cart abandoned' } })
    const delay = await prisma.journeyStep.create({ data: { journeyId: journey.id, parentStepId: trigger.id, stepType: JourneyStepType.DELAY, config: { delayMinutes: 60 }, positionX: 250, positionY: 150, label: 'Wait 1 hour' } })
    const action = await prisma.journeyStep.create({ data: { journeyId: journey.id, parentStepId: delay.id, stepType: JourneyStepType.ACTION, config: { channel: 'WHATSAPP', content: { body: 'You left items in your cart! Complete your order now.' } }, positionX: 250, positionY: 300, label: 'Send WhatsApp' } })
    const cond = await prisma.journeyStep.create({ data: { journeyId: journey.id, parentStepId: action.id, stepType: JourneyStepType.CONDITION, config: { field: 'totalOrders', operator: 'greater_than', value: 0 }, positionX: 250, positionY: 450, label: 'Purchased?' } })
    await prisma.journeyEnrollment.create({ data: { journeyId: journey.id, customerId: usman.id, currentStepId: action.id, status: EnrollmentStatus.ACTIVE, lastStepAt: new Date() } })
    await prisma.journeyEnrollment.create({ data: { journeyId: journey.id, customerId: hina.id, currentStepId: cond.id, status: EnrollmentStatus.COMPLETED, completedAt: new Date(), lastStepAt: new Date() } })
    console.log(`✓ Journey ${journey.id} (+ 4 steps + 2 enrollments)`)
  }

  console.log('\n✅ demo-fix-ids complete. All list items now use cuid ids.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
