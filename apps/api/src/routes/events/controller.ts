import type { FastifyRequest, FastifyReply } from 'fastify'
import { CustomEventBodySchema } from './schema.js'
import { ingestCustomEvent } from './service.js'

export async function ingestCustomEventHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = CustomEventBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid event payload',
        details: parsed.error.flatten().fieldErrors,
      },
    })
    return
  }

  const merchantId = request.apiKeyMerchantId
  if (!merchantId) {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing merchant context' },
    })
    return
  }

  try {
    const result = await ingestCustomEvent(merchantId, parsed.data)
    await reply.status(201).send({ success: true, data: result })
  } catch (err) {
    if (err instanceof Error && err.message === 'CUSTOMER_NOT_FOUND') {
      await reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      })
      return
    }
    request.log.error({ err }, 'Failed to ingest custom event')
    await reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to ingest event' },
    })
  }
}
