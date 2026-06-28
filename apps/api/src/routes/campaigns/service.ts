import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { CreateCampaignBody, UpdateCampaignBody } from './schema.js'

// Service-layer result for state-transition operations that can fail for several
// distinct reasons. CRUD getters return the entity or null; transitions return this.
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string }

const EDITABLE_STATES = ['DRAFT', 'SCHEDULED'] as const
const SENDABLE_STATES = ['DRAFT', 'SCHEDULED'] as const
const CANCELLABLE_STATES = ['SCHEDULED', 'PAUSED'] as const

export async function createCampaign(merchantId: string, body: CreateCampaignBody) {
  return prisma.campaign.create({
    data: {
      merchantId,
      name: body.name,
      channel: body.channel,
      segmentId: body.segmentId ?? null,
      subject: body.subject ?? null,
      content: { body: body.body },
      utmCampaign: body.utmCampaign ?? null,
      utmSource: body.utmSource ?? null,
      utmMedium: body.utmMedium ?? null,
    },
  })
}

export async function listCampaigns(
  merchantId: string,
  page: number,
  pageSize: number,
  status?: string,
) {
  const where: Prisma.CampaignWhereInput = {
    merchantId,
    ...(status ? { status: status as Prisma.EnumCampaignStatusFilter } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        segmentId: true,
        sendAt: true,
        sentAt: true,
        recipientCount: true,
        deliveredCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaign.count({ where }),
  ])
  return { items, total, page, pageSize }
}

export async function getCampaign(merchantId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId, merchantId },
  })
}

// Detail view: campaign + target segment name + per-status recipient breakdown.
export async function getCampaignDetail(merchantId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, merchantId },
    include: { segment: { select: { id: true, name: true, memberCount: true } } },
  })
  if (!campaign) return null

  const grouped = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId, merchantId },
    _count: { _all: true },
  })
  const recipientBreakdown: Record<string, number> = {}
  for (const row of grouped) {
    recipientBreakdown[row.status] = row._count._all
  }

  return { ...campaign, recipientBreakdown }
}

export async function updateCampaign(
  merchantId: string,
  campaignId: string,
  body: UpdateCampaignBody,
): Promise<ServiceResult<Awaited<ReturnType<typeof getCampaign>>>> {
  const existing = await getCampaign(merchantId, campaignId)
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Campaign not found' }
  }
  if (!(EDITABLE_STATES as readonly string[]).includes(existing.status)) {
    return {
      ok: false,
      status: 409,
      code: 'INVALID_STATE',
      message: `Cannot edit a campaign in ${existing.status} state`,
    }
  }

  // content (body) is stored inside the JSON column; merge with the existing body.
  const existingContent = (existing.content as { body?: string } | null) ?? {}
  const nextContent =
    body.body !== undefined ? { ...existingContent, body: body.body } : existing.content

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.channel !== undefined && { channel: body.channel }),
      ...(body.segmentId !== undefined && { segmentId: body.segmentId }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.body !== undefined && { content: nextContent as object }),
      ...(body.utmCampaign !== undefined && { utmCampaign: body.utmCampaign }),
      ...(body.utmSource !== undefined && { utmSource: body.utmSource }),
      ...(body.utmMedium !== undefined && { utmMedium: body.utmMedium }),
    },
  })
  return { ok: true, data: updated }
}

export async function deleteCampaign(
  merchantId: string,
  campaignId: string,
): Promise<ServiceResult<{ id: string }>> {
  const existing = await getCampaign(merchantId, campaignId)
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Campaign not found' }
  }
  if (existing.status === 'SENDING') {
    return {
      ok: false,
      status: 409,
      code: 'INVALID_STATE',
      message: 'Cannot delete a campaign while it is sending',
    }
  }
  // CampaignRecipient rows cascade-delete via the FK.
  await prisma.campaign.delete({ where: { id: campaignId } })
  return { ok: true, data: { id: campaignId } }
}

// Validate a campaign is ready to send and transition it to SCHEDULED with a concrete
// sendAt. Returns the delay (ms) the caller uses for the BullMQ delayed job. sendAt
// null/past => send immediately (delayMs 0).
export async function prepareSend(
  merchantId: string,
  campaignId: string,
  sendAt: string | null | undefined,
  now: number = Date.now(),
): Promise<ServiceResult<{ campaign: NonNullable<Awaited<ReturnType<typeof getCampaign>>>; delayMs: number }>> {
  const existing = await getCampaign(merchantId, campaignId)
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Campaign not found' }
  }
  if (!(SENDABLE_STATES as readonly string[]).includes(existing.status)) {
    return {
      ok: false,
      status: 409,
      code: 'INVALID_STATE',
      message: `Cannot send a campaign in ${existing.status} state`,
    }
  }
  if (!existing.segmentId) {
    return {
      ok: false,
      status: 400,
      code: 'NO_SEGMENT',
      message: 'Campaign has no target segment',
    }
  }
  const content = existing.content as { body?: string } | null
  if (!content?.body) {
    return { ok: false, status: 400, code: 'NO_CONTENT', message: 'Campaign has no message body' }
  }
  // Confirm the target segment is owned by this merchant (defense-in-depth).
  const segment = await prisma.segment.findFirst({
    where: { id: existing.segmentId, merchantId },
    select: { id: true },
  })
  if (!segment) {
    return { ok: false, status: 400, code: 'SEGMENT_NOT_FOUND', message: 'Target segment not found' }
  }

  const when = sendAt ? new Date(sendAt) : new Date(now)
  const delayMs = Math.max(0, when.getTime() - now)
  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'SCHEDULED', sendAt: when },
  })
  return { ok: true, data: { campaign, delayMs } }
}

export async function cancelCampaign(
  merchantId: string,
  campaignId: string,
): Promise<ServiceResult<NonNullable<Awaited<ReturnType<typeof getCampaign>>>>> {
  const existing = await getCampaign(merchantId, campaignId)
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Campaign not found' }
  }
  if (!(CANCELLABLE_STATES as readonly string[]).includes(existing.status)) {
    return {
      ok: false,
      status: 409,
      code: 'INVALID_STATE',
      message: `Cannot cancel a campaign in ${existing.status} state`,
    }
  }
  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'CANCELLED' },
  })
  return { ok: true, data: campaign }
}
