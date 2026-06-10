import { prisma } from '@engageiq/db'

export async function checkJourneyExit(
  customerId: string,
  merchantId: string,
  exitTriggerType: string,
): Promise<void> {
  const activeEnrollments = await prisma.journeyEnrollment.findMany({
    where: { customerId, status: 'ACTIVE' },
    select: { id: true, journey: { select: { merchantId: true, exitTrigger: true } } },
  })

  const toExit = activeEnrollments.filter(
    (e) =>
      e.journey.merchantId === merchantId &&
      e.journey.exitTrigger === exitTriggerType,
  )

  if (toExit.length === 0) return

  await prisma.journeyEnrollment.updateMany({
    where: { id: { in: toExit.map((e) => e.id) } },
    data: { status: 'EXITED', exitedAt: new Date() },
  })
}
