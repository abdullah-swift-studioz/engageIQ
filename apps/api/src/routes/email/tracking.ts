// apps/api/src/routes/email/tracking.ts
//
// Public (unauthenticated) email endpoints embedded in sent emails:
//   GET /email/open/:file   → 1×1 tracking pixel; stamps Message.openedAt.
//   GET /email/unsubscribe  → HMAC-verified one-click unsubscribe → EmailSuppression +
//                             clears Customer.isSubscribedEmail.
// No auth hook here (recipients aren't logged in); safety comes from the opaque message
// id (open) and the HMAC token (unsubscribe).
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@engageiq/db'
import { verifyUnsubscribeToken } from '../../services/email/tracking-tokens.js'

// 43-byte transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:64px auto;padding:0 20px;color:#111;text-align:center;"><h1 style="font-size:20px;">${title}</h1><p style="color:#555;line-height:1.6;">${message}</p></body></html>`
}

async function openHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { file } = request.params as { file: string }
  const messageId = file.replace(/\.gif$/i, '')
  // Best-effort: stamp the first open only. Never fail the pixel response.
  try {
    await prisma.message.updateMany({
      where: { id: messageId, channel: 'EMAIL', openedAt: null },
      data: { openedAt: new Date(), status: 'READ' },
    })
  } catch {
    // ignore — always return the pixel
  }
  await reply
    .header('Content-Type', 'image/gif')
    .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    .header('Pragma', 'no-cache')
    .send(PIXEL)
}

async function unsubscribeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { m: merchantId, c: customerId, t: token } = request.query as {
    m?: string
    c?: string
    t?: string
  }
  if (!merchantId || !customerId || !token) {
    await reply.status(400).type('text/html').send(htmlPage('Invalid link', 'This unsubscribe link is malformed.'))
    return
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, merchantId },
    select: { id: true, email: true },
  })
  if (!customer || !customer.email || !verifyUnsubscribeToken(merchantId, customerId, customer.email, token)) {
    await reply.status(400).type('text/html').send(htmlPage('Invalid link', 'This unsubscribe link is invalid or expired.'))
    return
  }

  // Idempotent: clear the opt-in flag and record the suppression.
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customer.id }, data: { isSubscribedEmail: false } }),
    prisma.emailSuppression.upsert({
      where: { merchantId_email: { merchantId, email: customer.email } },
      update: {},
      create: { merchantId, email: customer.email, reason: 'manual' },
    }),
  ])

  await reply.type('text/html').send(
    htmlPage('You are unsubscribed', `We won't email ${customer.email} again. You can re-subscribe anytime from a future message.`),
  )
}

const emailTrackingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/open/:file', openHandler)
  fastify.get('/unsubscribe', unsubscribeHandler)
}

export default emailTrackingRoutes
