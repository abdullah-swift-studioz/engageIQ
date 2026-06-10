import { prisma } from '@engageiq/db'
import { journeyExecutorQueue } from '@engageiq/queue'
import type { JourneyExecutorJob } from '@engageiq/shared'
import { JOURNEY_EXECUTOR } from '@engageiq/shared'

export async function checkJourneyEntry(
  customerId: string,
  merchantId: string,
  triggerType: string,
  triggerData: Record<string, unknown> = {},
): Promise<void> {
  const journeys = await prisma.journey.findMany({
    where: { merchantId, status: 'ACTIVE', triggerType },
    select: { id: true, reEntryRule: true, triggerConfig: true },
  })

  for (const journey of journeys) {
    const config = journey.triggerConfig as Record<string, unknown>

    if (triggerType === 'segment_entered' && config['segmentId'] !== triggerData['segmentId']) continue
    if (triggerType === 'custom_event' && config['eventName'] !== triggerData['eventName']) continue

    const existingEnrollments = await prisma.journeyEnrollment.findMany({
      where: { journeyId: journey.id, customerId },
      select: { id: true, status: true },
    })

    const hasActive = existingEnrollments.some((e) => e.status === 'ACTIVE')
    if (hasActive) continue

    if (journey.reEntryRule === 'DISALLOW' && existingEnrollments.length > 0) continue

    if (journey.reEntryRule === 'RE_ENROLL_AFTER_EXIT') {
      const hasExited = existingEnrollments.some(
        (e) => e.status === 'EXITED' || e.status === 'COMPLETED',
      )
      if (!hasExited) continue
    }

    await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
      type: 'enroll_customer',
      journeyId: journey.id,
      customerId,
      merchantId,
    } satisfies JourneyExecutorJob)
  }
}
