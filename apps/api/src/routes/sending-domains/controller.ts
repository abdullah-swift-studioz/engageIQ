import type { FastifyRequest, FastifyReply } from 'fastify'
import { CreateDomainBodySchema, DomainParamsSchema } from './schema.js'
import {
  initiateSendingDomain,
  verifySendingDomain,
  listSendingDomains,
  getSendingDomain,
  deleteSendingDomain,
} from '../../services/email/domain-verify.js'

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message } })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Sending domain not found' } })
}

export async function createDomainHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = CreateDomainBodySchema.safeParse(request.body)
  if (!parsed.success) {
    await validationError(reply, parsed.error.issues.map((i) => i.message).join(', '))
    return
  }
  const domain = await initiateSendingDomain(request.user.merchantId, parsed.data.domain)
  await reply.status(201).send({ success: true, data: domain })
}

export async function listDomainsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const domains = await listSendingDomains(request.user.merchantId)
  await reply.send({ success: true, data: domains })
}

export async function getDomainHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = DomainParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid domain ID')
    return
  }
  const domain = await getSendingDomain(request.user.merchantId, params.data.id)
  if (!domain) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: domain })
}

export async function verifyDomainHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = DomainParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid domain ID')
    return
  }
  const result = await verifySendingDomain(request.user.merchantId, params.data.id)
  if (!result) {
    await notFound(reply)
    return
  }
  await reply.send({ success: true, data: result })
}

export async function deleteDomainHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = DomainParamsSchema.safeParse(request.params)
  if (!params.success) {
    await validationError(reply, 'Invalid domain ID')
    return
  }
  const deleted = await deleteSendingDomain(request.user.merchantId, params.data.id)
  if (!deleted) {
    await notFound(reply)
    return
  }
  await reply.status(204).send()
}
