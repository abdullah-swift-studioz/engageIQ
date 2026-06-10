import { Worker, UnrecoverableError } from 'bullmq'
import { prisma } from '@engageiq/db'
import { journeyExecutorQueue, redisConnection } from '@engageiq/queue'
import type { JourneyExecutorJob, ConditionStepConfig, DelayStepConfig, ActionStepConfig } from '@engageiq/shared'
import { JOURNEY_EXECUTOR } from '@engageiq/shared'
import type { SegmentGroup } from '@engageiq/shared'
import { evaluateProfile, buildProfileFromCustomer } from '../services/segment-evaluator.js'
import { dispatchChannel } from '../lib/channels/dispatcher.js'

function delayToMs(duration: number, unit: DelayStepConfig['unit']): number {
  const multipliers = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }
  return duration * multipliers[unit]
}

export async function processJourneyJob(data: JourneyExecutorJob): Promise<void> {
  switch (data.type) {
    case 'enroll_customer': {
      const journey = await prisma.journey.findFirst({
        where: { id: data.journeyId, merchantId: data.merchantId },
        select: { id: true, status: true, enrollmentCount: true },
      })
      if (!journey || journey.status !== 'ACTIVE') return

      const enrollment = await prisma.journeyEnrollment.create({
        data: {
          journeyId: data.journeyId,
          customerId: data.customerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      })

      await prisma.journey.update({
        where: { id: data.journeyId },
        data: { enrollmentCount: { increment: 1 } },
      })

      const triggerStep = await prisma.journeyStep.findFirst({
        where: { journeyId: data.journeyId, parentStepId: null, stepType: 'TRIGGER' },
        select: { id: true },
      })
      if (!triggerStep) throw new UnrecoverableError(`Journey ${data.journeyId} has no TRIGGER step`)

      await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
        type: 'execute_step',
        enrollmentId: enrollment.id,
        stepId: triggerStep.id,
        merchantId: data.merchantId,
      } satisfies JourneyExecutorJob)
      break
    }

    case 'execute_step': {
      const enrollment = await prisma.journeyEnrollment.findFirst({
        where: { id: data.enrollmentId },
        select: { id: true, status: true, customerId: true, journeyId: true },
      })
      if (!enrollment || enrollment.status !== 'ACTIVE') return

      const step = await prisma.journeyStep.findFirst({
        where: { id: data.stepId },
        select: { id: true, stepType: true, config: true, journeyId: true },
      })
      if (!step) throw new UnrecoverableError(`Step ${data.stepId} not found`)

      await prisma.journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { currentStepId: step.id, lastStepAt: new Date() },
      })

      let nextStepId: string | null = null

      switch (step.stepType) {
        case 'TRIGGER': {
          const child = await prisma.journeyStep.findFirst({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true },
          })
          nextStepId = child?.id ?? null
          break
        }

        case 'ACTION': {
          const config = step.config as unknown as ActionStepConfig
          await dispatchChannel(config.channel, enrollment.customerId, config.content, data.merchantId)
          const child = await prisma.journeyStep.findFirst({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true },
          })
          nextStepId = child?.id ?? null
          break
        }

        case 'DELAY': {
          const config = step.config as unknown as DelayStepConfig
          const delayMs = delayToMs(config.duration, config.unit)
          const child = await prisma.journeyStep.findFirst({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true },
          })
          if (child) {
            await journeyExecutorQueue.add(
              JOURNEY_EXECUTOR,
              {
                type: 'execute_step',
                enrollmentId: enrollment.id,
                stepId: child.id,
                merchantId: data.merchantId,
              } satisfies JourneyExecutorJob,
              { delay: delayMs },
            )
          } else {
            await prisma.journeyEnrollment.update({
              where: { id: enrollment.id },
              data: { status: 'COMPLETED', completedAt: new Date() },
            })
            await prisma.journey.update({
              where: { id: enrollment.journeyId },
              data: { completionCount: { increment: 1 } },
            })
          }
          return
        }

        case 'CONDITION': {
          const config = step.config as unknown as ConditionStepConfig
          const customer = await prisma.customer.findFirst({
            where: { id: enrollment.customerId, merchantId: data.merchantId },
          })
          if (!customer) throw new UnrecoverableError(`Customer ${enrollment.customerId} not found`)

          const profile = buildProfileFromCustomer(customer as unknown as Record<string, unknown>)
          const group: SegmentGroup = {
            match: 'all',
            rules: [{ field: config.field, operator: config.operator, value: config.value }],
          }
          const conditionResult = evaluateProfile(group, profile)

          const children = await prisma.journeyStep.findMany({
            where: { journeyId: step.journeyId, parentStepId: step.id },
            select: { id: true, label: true },
          })
          const targetLabel = conditionResult ? 'true' : 'false'
          const branch = children.find((c) => c.label === targetLabel) ?? children[0] ?? null
          nextStepId = branch?.id ?? null
          break
        }
      }

      if (nextStepId) {
        await journeyExecutorQueue.add(JOURNEY_EXECUTOR, {
          type: 'execute_step',
          enrollmentId: enrollment.id,
          stepId: nextStepId,
          merchantId: data.merchantId,
        } satisfies JourneyExecutorJob)
      } else {
        await prisma.journeyEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        })
        await prisma.journey.update({
          where: { id: enrollment.journeyId },
          data: { completionCount: { increment: 1 } },
        })
      }
      break
    }

    case 'scheduled_fire': {
      const journey = await prisma.journey.findFirst({
        where: { id: data.journeyId, merchantId: data.merchantId, status: 'ACTIVE' },
        select: { id: true, reEntryRule: true, triggerConfig: true },
      })
      if (!journey) return

      const config = journey.triggerConfig as Record<string, unknown>
      const segmentId = config['segmentId'] as string | undefined
      if (!segmentId) return

      const members = await prisma.segmentMembership.findMany({
        where: { segmentId, exitedAt: null },
        select: { customerId: true },
      })

      for (const { customerId } of members) {
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
          merchantId: data.merchantId,
        } satisfies JourneyExecutorJob)
      }
      break
    }
  }
}

export function createJourneyExecutorWorker() {
  return new Worker<JourneyExecutorJob>(
    'journey-executor',
    async (job) => {
      await processJourneyJob(job.data)
    },
    { connection: redisConnection, concurrency: 10 },
  )
}
