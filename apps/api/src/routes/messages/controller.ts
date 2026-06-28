import type { FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { listMessages, getMessageStats } from './service.js'

const ListMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  direction: z.enum(['OUTBOUND', 'INBOUND']).optional(),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED']).optional(),
})

export async function listMessagesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = ListMessagesQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await reply.status(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join(', ') },
    })
    return
  }
  const result = await listMessages(
    request.user.merchantId,
    { direction: parsed.data.direction, status: parsed.data.status },
    parsed.data.page,
    parsed.data.pageSize,
  )
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function messageStatsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const stats = await getMessageStats(request.user.merchantId)
  await reply.send({ success: true, data: stats })
}
