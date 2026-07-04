import type { FastifyRequest, FastifyReply } from 'fastify'
import { getLatestClusters, promoteCluster, PromoteError } from './service.js'
import { PromoteClusterParamsSchema, PromoteClusterBodySchema } from './schema.js'

export async function listClustersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const data = await getLatestClusters(request.user.merchantId)
  await reply.send({ success: true, data })
}

export async function promoteClusterHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const paramsParsed = PromoteClusterParamsSchema.safeParse(request.params)
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
  const bodyParsed = PromoteClusterBodySchema.safeParse(request.body)
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
  const { runId } = paramsParsed.data
  const { clusterIndex, name, description } = bodyParsed.data

  try {
    const result = await promoteCluster(merchantId, runId, clusterIndex, { name, description })
    await reply.status(201).send({ success: true, data: result })
  } catch (err) {
    if (err instanceof PromoteError) {
      const status = err.code === 'RUN_NOT_FOUND' || err.code === 'CLUSTER_NOT_FOUND' ? 404 : 422
      await reply.status(status).send({
        success: false,
        error: { code: err.code, message: err.message },
      })
      return
    }
    throw err
  }
}
