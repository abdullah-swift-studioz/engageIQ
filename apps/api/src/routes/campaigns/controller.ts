import type { FastifyRequest, FastifyReply } from 'fastify'
import { campaignSendQueue } from '@engageiq/queue'
import { CAMPAIGN_SEND } from '@engageiq/shared'
import type { CampaignSendJob } from '@engageiq/shared'
import {
  CreateCampaignBodySchema,
  UpdateCampaignBodySchema,
  SendCampaignBodySchema,
  CampaignParamsSchema,
  ListCampaignsQuerySchema,
} from './schema.js'
import {
  createCampaign,
  listCampaigns,
  getCampaignDetail,
  updateCampaign,
  deleteCampaign,
  prepareSend,
  cancelCampaign,
  type ServiceResult,
} from './service.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Campaign not found' },
  })
}

// Map a failed ServiceResult onto the standard error envelope.
async function sendServiceError(reply: FastifyReply, result: Extract<ServiceResult<unknown>, { ok: false }>) {
  await reply.status(result.status).send({
    success: false,
    error: { code: result.code, message: result.message },
  })
}

export async function createCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CreateCampaignBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const campaign = await createCampaign(merchantId, parsed.data)
  await reply.status(201).send({ success: true, data: campaign })
}

export async function listCampaignsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ListCampaignsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const result = await listCampaigns(
    merchantId,
    parsed.data.page,
    parsed.data.pageSize,
    parsed.data.status,
  )
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function getCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = CampaignParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid campaign ID')
    return
  }
  const merchantId = request.user.merchantId
  const campaign = await getCampaignDetail(merchantId, paramsParsed.data.id)
  if (!campaign) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: campaign })
}

export async function updateCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = CampaignParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid campaign ID')
    return
  }
  const parsed = UpdateCampaignBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const result = await updateCampaign(merchantId, paramsParsed.data.id, parsed.data)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await reply.send({ success: true, data: result.data })
}

export async function deleteCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = CampaignParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid campaign ID')
    return
  }
  const merchantId = request.user.merchantId
  const result = await deleteCampaign(merchantId, paramsParsed.data.id)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  // Best-effort: drop any pending scheduled job for this campaign.
  await campaignSendQueue.remove(paramsParsed.data.id).catch(() => undefined)
  await reply.status(204).send()
}

// POST /:id/send — send now (sendAt omitted) or schedule (future sendAt).
export async function sendCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = CampaignParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid campaign ID')
    return
  }
  const parsed = SendCampaignBodySchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const merchantId = request.user.merchantId
  const result = await prepareSend(merchantId, paramsParsed.data.id, parsed.data.sendAt)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }

  const { campaign, delayMs } = result.data
  // jobId = campaignId makes the enqueue idempotent. Re-scheduling: remove any prior
  // delayed job first, then re-add with the new delay.
  await campaignSendQueue.remove(campaign.id).catch(() => undefined)
  await campaignSendQueue.add(
    CAMPAIGN_SEND,
    { type: 'send_campaign', campaignId: campaign.id, merchantId } satisfies CampaignSendJob,
    { jobId: campaign.id, delay: delayMs },
  )

  await reply.status(202).send({
    success: true,
    data: {
      id: campaign.id,
      status: campaign.status,
      sendAt: campaign.sendAt,
      scheduled: delayMs > 0,
    },
  })
}

// POST /:id/cancel — cancel a scheduled (or paused) campaign and drop its queued job.
export async function cancelCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = CampaignParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await validationError(reply, 'Invalid campaign ID')
    return
  }
  const merchantId = request.user.merchantId
  const result = await cancelCampaign(merchantId, paramsParsed.data.id)
  if (!result.ok) {
    await sendServiceError(reply, result)
    return
  }
  await campaignSendQueue.remove(paramsParsed.data.id).catch(() => undefined)
  await reply.send({ success: true, data: result.data })
}
