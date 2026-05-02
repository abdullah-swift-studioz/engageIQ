import type { FastifyRequest, FastifyReply } from 'fastify'
import { getCustomerProfile, listCustomers } from './service.js'
import { mergeCustomers } from '../../services/merge.service.js'
import { GetCustomerParamsSchema, GetCustomersQuerySchema, MergeCustomersBodySchema } from './schema.js'
import type { MergeResult } from '@engageiq/shared'

export async function getCustomerHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = GetCustomerParamsSchema.safeParse(request.params)
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

  const merchantId = request.user.merchantId
  const { id } = paramsParsed.data

  try {
    const profile = await getCustomerProfile(merchantId, id)
    await reply.send({ success: true, data: profile })
  } catch (err) {
    if (err instanceof Error && err.message === 'CUSTOMER_NOT_FOUND') {
      await reply.status(404).send({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found',
        },
      })
      return
    }

    request.log.error({ err }, 'Failed to fetch customer profile')
    await reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch customer profile',
      },
    })
  }
}

export async function mergeCustomersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const bodyParsed = MergeCustomersBodySchema.safeParse(request.body)
  if (!bodyParsed.success) {
    await reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: bodyParsed.error.flatten(),
      },
    })
    return
  }

  const merchantId = request.user.merchantId
  const { customerId1, customerId2 } = bodyParsed.data

  try {
    const result: MergeResult = await mergeCustomers(merchantId, customerId1, customerId2)
    await reply.status(200).send({ success: true, data: result })
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'MERGE_SAME_CUSTOMER') {
        await reply.status(400).send({
          success: false,
          error: {
            code: 'MERGE_SAME_CUSTOMER',
            message: 'Cannot merge a profile with itself',
          },
        })
        return
      }

      if (err.message === 'CUSTOMER_NOT_FOUND') {
        await reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'Customer not found',
          },
        })
        return
      }

      if (err.message === 'CUSTOMER_ALREADY_MERGED') {
        await reply.status(409).send({
          success: false,
          error: {
            code: 'CUSTOMER_ALREADY_MERGED',
            message: 'One or both profiles have already been merged into another profile',
          },
        })
        return
      }
    }

    request.log.error({ err }, 'Failed to merge customers')
    await reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to merge customers',
      },
    })
  }
}

export async function listCustomersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const queryParsed = GetCustomersQuerySchema.safeParse(request.query)
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
  const { page, pageSize, search } = queryParsed.data

  try {
    const { customers, total } = await listCustomers(merchantId, { page, pageSize, search })
    await reply.send({
      success: true,
      data: customers,
      meta: {
        page,
        pageSize,
        total,
      },
    })
  } catch (err) {
    request.log.error({ err }, 'Failed to list customers')
    await reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list customers',
      },
    })
  }
}
