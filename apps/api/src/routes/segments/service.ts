import { prisma } from '@engageiq/db'
import type { CreateSegmentBody, UpdateSegmentBody } from './schema.js'

export async function createSegment(merchantId: string, body: CreateSegmentBody) {
  return prisma.segment.create({
    data: {
      merchantId,
      name: body.name,
      description: body.description ?? null,
      conditions: body.conditions as object,
      isDynamic: body.isDynamic,
    },
  })
}

export async function listSegments(
  merchantId: string,
  page: number,
  pageSize: number,
) {
  const [items, total] = await Promise.all([
    prisma.segment.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        description: true,
        memberCount: true,
        lastEvaluatedAt: true,
        isDynamic: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.segment.count({ where: { merchantId } }),
  ])
  return { items, total, page, pageSize }
}

export async function getSegment(merchantId: string, segmentId: string) {
  return prisma.segment.findFirst({
    where: { id: segmentId, merchantId },
  })
}

export async function updateSegment(
  merchantId: string,
  segmentId: string,
  body: UpdateSegmentBody,
) {
  return prisma.segment.update({
    where: { id: segmentId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.conditions !== undefined && { conditions: body.conditions as object }),
      ...(body.isDynamic !== undefined && { isDynamic: body.isDynamic }),
    },
  })
}

export async function deleteSegment(merchantId: string, segmentId: string) {
  return prisma.segment.delete({
    where: { id: segmentId },
  })
}
