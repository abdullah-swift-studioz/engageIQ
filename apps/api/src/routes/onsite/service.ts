import { prisma } from '@engageiq/db'
import { Prisma, $Enums } from '@prisma/client'
import type { OnSiteVariant } from '@engageiq/shared'
import type { CreateElementBody, UpdateElementBody, CreateAbTestBody } from './schema.js'

// Mirrors the campaigns lane: CRUD getters return the entity or null; state
// transitions return this discriminated result mapped onto the error envelope.
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string }

// ─── Element CRUD ─────────────────────────────────────────────────────────────

export async function createElement(merchantId: string, body: CreateElementBody) {
  return prisma.onSiteElement.create({
    data: {
      merchantId,
      name: body.name,
      type: body.type,
      config: body.config as unknown as Prisma.InputJsonValue,
      displayRules: body.displayRules as unknown as Prisma.InputJsonValue,
      segmentId: body.segmentId ?? null,
      status: body.status ?? 'DRAFT',
      priority: body.priority ?? null,
    },
  })
}

export async function listElements(
  merchantId: string,
  page: number,
  pageSize: number,
  status?: string,
  type?: string,
) {
  const where: Prisma.OnSiteElementWhereInput = {
    merchantId,
    ...(status ? { status } : {}),
    ...(type ? { type: type as $Enums.OnSiteElementType } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.onSiteElement.findMany({
      where,
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        segmentId: true,
        priority: true,
        displayRules: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.onSiteElement.count({ where }),
  ])
  return { items, total, page, pageSize }
}

export async function getElement(merchantId: string, elementId: string) {
  return prisma.onSiteElement.findFirst({ where: { id: elementId, merchantId } })
}

/** Detail view: the element + its target segment name + its active/decided A/B test. */
export async function getElementDetail(merchantId: string, elementId: string) {
  const element = await prisma.onSiteElement.findFirst({
    where: { id: elementId, merchantId },
    include: { segment: { select: { id: true, name: true } } },
  })
  if (!element) return null
  const abTest = await getActiveAbTest(merchantId, elementId)
  return { ...element, abTest }
}

export async function updateElement(
  merchantId: string,
  elementId: string,
  body: UpdateElementBody,
): Promise<ServiceResult<Awaited<ReturnType<typeof getElement>>>> {
  const existing = await getElement(merchantId, elementId)
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'On-site element not found' }
  }
  const updated = await prisma.onSiteElement.update({
    where: { id: elementId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.config !== undefined && { config: body.config as unknown as Prisma.InputJsonValue }),
      ...(body.displayRules !== undefined && {
        displayRules: body.displayRules as unknown as Prisma.InputJsonValue,
      }),
      ...(body.segmentId !== undefined && { segmentId: body.segmentId }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.priority !== undefined && { priority: body.priority }),
    },
  })
  return { ok: true, data: updated }
}

export async function deleteElement(
  merchantId: string,
  elementId: string,
): Promise<ServiceResult<{ id: string }>> {
  const existing = await getElement(merchantId, elementId)
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'On-site element not found' }
  }
  // AbTest.entityId is a loose reference (no FK), so its rows don't cascade —
  // clean up this element's tests explicitly, both in one transaction.
  await prisma.$transaction([
    prisma.abTest.deleteMany({
      where: { merchantId, entityType: 'ONSITE_ELEMENT', entityId: elementId },
    }),
    prisma.onSiteElement.delete({ where: { id: elementId } }),
  ])
  return { ok: true, data: { id: elementId } }
}

// ─── A/B tests (entityType ONSITE_ELEMENT, entityId = element id) ──────────────

/** The RUNNING or WINNER_DECIDED test for an element, if any. */
export async function getActiveAbTest(merchantId: string, elementId: string) {
  return prisma.abTest.findFirst({
    where: {
      merchantId,
      entityType: 'ONSITE_ELEMENT',
      entityId: elementId,
      status: { in: ['RUNNING', 'WINNER_DECIDED'] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createAbTest(
  merchantId: string,
  elementId: string,
  body: CreateAbTestBody,
): Promise<ServiceResult<Prisma.AbTestGetPayload<object>>> {
  const element = await getElement(merchantId, elementId)
  if (!element) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'On-site element not found' }
  }
  const active = await getActiveAbTest(merchantId, elementId)
  if (active) {
    return {
      ok: false,
      status: 409,
      code: 'TEST_ALREADY_ACTIVE',
      message: 'This element already has an active A/B test',
    }
  }

  // Assign a stable id to each variant — the SDK echoes it back on impression /
  // conversion events, and the delivery bucketing keys off it.
  const variants: OnSiteVariant[] = body.variants.map((v) => ({
    id: crypto.randomUUID(),
    name: v.name,
    config: v.config,
    allocationPct: v.allocationPct,
  }))

  const test = await prisma.abTest.create({
    data: {
      merchantId,
      name: body.name,
      entityType: 'ONSITE_ELEMENT',
      entityId: elementId,
      variants: variants as unknown as Prisma.InputJsonValue,
      winnerMetric: body.winnerMetric,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  })
  return { ok: true, data: test }
}

async function getOwnedTest(merchantId: string, elementId: string, testId: string) {
  return prisma.abTest.findFirst({
    where: { id: testId, merchantId, entityType: 'ONSITE_ELEMENT', entityId: elementId },
  })
}

export async function stopAbTest(
  merchantId: string,
  elementId: string,
  testId: string,
): Promise<ServiceResult<Prisma.AbTestGetPayload<object>>> {
  const test = await getOwnedTest(merchantId, elementId, testId)
  if (!test) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'A/B test not found' }
  }
  if (test.status === 'COMPLETED' || test.status === 'CANCELLED') {
    return { ok: false, status: 409, code: 'INVALID_STATE', message: `Test is already ${test.status}` }
  }
  const updated = await prisma.abTest.update({
    where: { id: testId },
    data: { status: 'COMPLETED', endedAt: new Date() },
  })
  return { ok: true, data: updated }
}

export async function decideAbTest(
  merchantId: string,
  elementId: string,
  testId: string,
  winnerVariantId: string,
): Promise<ServiceResult<Prisma.AbTestGetPayload<object>>> {
  const test = await getOwnedTest(merchantId, elementId, testId)
  if (!test) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'A/B test not found' }
  }
  const variants = (test.variants as unknown as OnSiteVariant[]) ?? []
  if (!variants.some((v) => v.id === winnerVariantId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_VARIANT',
      message: 'winnerVariantId does not belong to this test',
    }
  }
  // WINNER_DECIDED rolls the winning variant out to the whole audience (the
  // delivery endpoint serves the winner's config to everyone).
  const updated = await prisma.abTest.update({
    where: { id: testId },
    data: { status: 'WINNER_DECIDED', winnerVariantId, decidedAt: new Date() },
  })
  return { ok: true, data: updated }
}
