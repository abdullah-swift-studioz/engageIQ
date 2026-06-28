import type { FastifyRequest, FastifyReply } from 'fastify'
import { getRecommendationsForCustomer } from './service.js'
import { GetRecommendationsParamsSchema, GetRecommendationsQuerySchema } from './schema.js'

export async function getRecommendationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = GetRecommendationsParamsSchema.safeParse(request.params)
  if (!paramsParsed.success) {
    await reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        details: paramsParsed.error.flatten(),
      },
    })
    return
  }
  const queryParsed = GetRecommendationsQuerySchema.safeParse(request.query)
  if (!queryParsed.success) {
    await reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid query parameters',
        details: queryParsed.error.flatten(),
      },
    })
    return
  }

  const merchantId = request.user.merchantId
  const { customerId } = paramsParsed.data
  const { type } = queryParsed.data

  try {
    const recommendations = await getRecommendationsForCustomer(merchantId, customerId, type)
    await reply.send({ success: true, data: recommendations })
  } catch (err) {
    if (err instanceof Error && err.message === 'CUSTOMER_NOT_FOUND') {
      await reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      })
      return
    }
    throw err
  }
}
