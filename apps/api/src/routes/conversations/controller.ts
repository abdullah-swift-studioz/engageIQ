import type { FastifyRequest, FastifyReply } from 'fastify'
import { ListConversationsQuerySchema, ConversationParamsSchema } from './schema.js'
import {
  listConversations,
  getConversation,
  conversationStats,
} from '../../services/conversation.service.js'

function validationError(reply: FastifyReply, error: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: error },
  })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Conversation not found' },
  })
}

export async function listConversationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ListConversationsQuerySchema.safeParse(request.query)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await listConversations(request.user.merchantId, parsed.data)
  await reply.send({
    success: true,
    data: result.items,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  })
}

export async function conversationStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const stats = await conversationStats(request.user.merchantId)
  await reply.send({ success: true, data: stats })
}

export async function getConversationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ConversationParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const result = await getConversation(request.user.merchantId, parsed.data.id)
  if (!result) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: result })
}
