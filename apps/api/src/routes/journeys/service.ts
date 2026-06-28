import { prisma } from '@engageiq/db'
import { EnrollmentStatus, JourneyStepType } from '@prisma/client'
import type { CreateJourneyBody, UpdateJourneyBody, GraphNode } from './schema.js'

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

// ─── Visual Journey Builder graph save (lane:journey) ─────────────────────────

/** Structural problem with the posted graph → maps to HTTP 400. */
export class GraphValidationError extends Error {
  override name = 'GraphValidationError'
}

/** Graph edits are only allowed on DRAFT journeys → maps to HTTP 409. */
export class JourneyNotDraftError extends Error {
  override name = 'JourneyNotDraftError'
}

/**
 * Pure validation of the canvas graph against the executor's structural contract. DB-free so it
 * can be unit-tested in isolation. An empty graph is allowed (clearing a draft). A non-empty graph
 * must be a single tree rooted at exactly one TRIGGER: every other node has exactly one existing
 * parent, no node parents itself, and there are no cycles. Branch-label correctness (CONDITION
 * true/false) is guaranteed by the builder writing the edge handle into each child's label, so it
 * is intentionally NOT enforced here — drafts may be partially wired.
 */
export function validateGraph(nodes: GraphNode[]): void {
  if (nodes.length === 0) return

  const ids = new Set<string>()
  for (const n of nodes) {
    if (ids.has(n.tempId)) throw new GraphValidationError(`Duplicate node id: ${n.tempId}`)
    ids.add(n.tempId)
  }

  const triggers = nodes.filter((n) => n.stepType === 'TRIGGER')
  if (triggers.length === 0) {
    throw new GraphValidationError('Journey must have exactly one TRIGGER node')
  }
  if (triggers.length > 1) {
    throw new GraphValidationError('Journey must have only one TRIGGER node')
  }
  const trigger = triggers[0]!
  if (trigger.parentTempId !== null) {
    throw new GraphValidationError('The TRIGGER node must be the root (no incoming connection)')
  }

  for (const n of nodes) {
    if (n.tempId === trigger.tempId) continue
    if (n.parentTempId === null) {
      throw new GraphValidationError(
        `Node "${n.label ?? n.stepType}" is not connected to the journey`,
      )
    }
    if (n.parentTempId === n.tempId) {
      throw new GraphValidationError('A node cannot connect to itself')
    }
    if (!ids.has(n.parentTempId)) {
      throw new GraphValidationError(`Node references a missing parent: ${n.parentTempId}`)
    }
  }

  // Acyclic: walking parent pointers from any node must terminate at the trigger root.
  const byId = new Map(nodes.map((n) => [n.tempId, n]))
  for (const start of nodes) {
    const seen = new Set<string>()
    let cur: GraphNode | undefined = start
    while (cur && cur.parentTempId !== null) {
      if (seen.has(cur.tempId)) throw new GraphValidationError('The journey graph contains a cycle')
      seen.add(cur.tempId)
      cur = byId.get(cur.parentTempId)
    }
  }
}

/**
 * Replace a DRAFT journey's entire step graph in one transaction. Temp ids are resolved to real
 * cuids in a two-pass create (create all parentless, then wire parentStepId), so sibling references
 * resolve regardless of input order. DRAFT-only because ACTIVE/PAUSED journeys may have enrollments
 * whose currentStepId references steps we would delete.
 */
export async function saveJourneyGraph(
  merchantId: string,
  journeyId: string,
  nodes: GraphNode[],
) {
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true, status: true },
  })
  if (!existing) return null
  if (existing.status !== 'DRAFT') {
    throw new JourneyNotDraftError('Only DRAFT journeys can be edited in the builder')
  }

  validateGraph(nodes)

  await prisma.$transaction(async (tx) => {
    await tx.journeyStep.deleteMany({ where: { journeyId } })

    const idMap = new Map<string, string>()
    for (const n of nodes) {
      const created = await tx.journeyStep.create({
        data: {
          journeyId,
          parentStepId: null,
          stepType: n.stepType as JourneyStepType,
          label: n.label,
          config: (n.config ?? {}) as object,
          positionX: n.positionX,
          positionY: n.positionY,
        },
        select: { id: true },
      })
      idMap.set(n.tempId, created.id)
    }

    for (const n of nodes) {
      if (n.parentTempId === null) continue
      await tx.journeyStep.update({
        where: { id: idMap.get(n.tempId)! },
        data: { parentStepId: idMap.get(n.parentTempId)! },
      })
    }
  })

  return getJourney(merchantId, journeyId)
}

export async function archiveJourney(merchantId: string, journeyId: string) {
  const existing = await prisma.journey.findFirst({
    where: { id: journeyId, merchantId },
    select: { id: true },
  })
  if (!existing) return null
  return prisma.journey.update({
    where: { id: journeyId },
    data: { status: 'ARCHIVED' },
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
