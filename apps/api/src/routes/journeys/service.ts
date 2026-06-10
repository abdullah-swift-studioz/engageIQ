import { prisma } from '@engageiq/db'
import { EnrollmentStatus } from '@prisma/client'
import type { CreateJourneyBody, UpdateJourneyBody } from './schema.js'

export async function createJourney(merchantId: string, body: CreateJourneyBody) {
  return prisma.journey.create({
    data: {
      merchantId,
      name: body.name,
      description: body.description ?? null,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig as object,
      reEntryRule: body.reEntryRule,
      exitTrigger: body.exitTrigger ?? null,
      steps: body.steps.length > 0
        ? {
            create: body.steps.map((s) => ({
              stepType: s.stepType,
              parentStepId: s.parentStepId,
              label: s.label,
              config: s.config as object,
              positionX: s.positionX,
              positionY: s.positionY,
            })),
          }
        : undefined,
    },
    include: { steps: true },
  })
}

export async function listJourneys(merchantId: string, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.journey.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        description: true,
        triggerType: true,
        status: true,
        reEntryRule: true,
        exitTrigger: true,
        enrollmentCount: true,
        completionCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.journey.count({ where: { merchantId } }),
  ])
  return { items, total, page, pageSize }
}

export async function getJourney(merchantId: string, journeyId: string) {
  return prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    include: { steps: { orderBy: { createdAt: 'asc' } } },
  })
}

export async function updateJourney(
  merchantId: string,
  journeyId: string,
  body: UpdateJourneyBody,
) {
  // Defense-in-depth: verify ownership before mutating, scoped by merchantId per multi-tenancy rule.
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true, status: true },
  })
  if (!existing) return null

  return prisma.journey.update({
    where: { id: journeyId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.triggerType !== undefined && { triggerType: body.triggerType }),
      ...(body.triggerConfig !== undefined && { triggerConfig: body.triggerConfig as object }),
      ...(body.reEntryRule !== undefined && { reEntryRule: body.reEntryRule }),
      ...(body.exitTrigger !== undefined && { exitTrigger: body.exitTrigger }),
    },
    include: { steps: { orderBy: { createdAt: 'asc' } } },
  })
}

export async function deleteJourney(merchantId: string, journeyId: string) {
  // Defense-in-depth: verify ownership before deleting, scoped by merchantId.
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true },
  })
  if (!existing) return null
  return prisma.journey.delete({ where: { id: journeyId } })
}

export async function activateJourney(merchantId: string, journeyId: string) {
  const journey = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    include: { steps: { select: { stepType: true } } },
  })
  if (!journey) return null

  const hasTrigger = journey.steps.some((s) => s.stepType === 'TRIGGER')
  if (!hasTrigger) throw new Error('MISSING_TRIGGER_STEP')

  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: 'ACTIVE' },
  })
}

export async function pauseJourney(merchantId: string, journeyId: string) {
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true, status: true },
  })
  if (!existing) return null

  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: 'PAUSED' },
  })
}

export async function listEnrollments(
  merchantId: string,
  journeyId: string,
  page: number,
  pageSize: number,
  status?: EnrollmentStatus,
) {
  // Verify the journey belongs to this merchant before exposing enrollments.
  const journey = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true },
  })
  if (!journey) return null

  const where = {
    journeyId,
    ...(status ? { status } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.journeyEnrollment.findMany({
      where,
      select: {
        id: true,
        customerId: true,
        status: true,
        enrolledAt: true,
        completedAt: true,
        exitedAt: true,
        lastStepAt: true,
        currentStepId: true,
      },
      orderBy: { enrolledAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.journeyEnrollment.count({ where }),
  ])
  return { items, total, page, pageSize }
}
