import type { FastifyRequest, FastifyReply } from 'fastify'
import { ACTING_MERCHANT_HEADER, isAgencyRole } from '@engageiq/shared'
import { resolveActingMerchant, AgencyAccessError, type AgencyUser } from './access.service.js'

/**
 * Global acting-merchant preHandler (roadmap 8.3 / guide §9.4 — account switching).
 *
 * Registered once in index.ts as an app-level `preHandler`. Because ALL onRequest
 * hooks (including each route group's `authenticate`) complete before any
 * preHandler runs, `request.user` is already populated here for authenticated
 * routes — so we can transparently re-scope the effective tenant WITHOUT touching
 * the core authenticate plugin.
 *
 * Behaviour (fully gated, additive):
 *   - no authenticated user (SDK / auth / webhook routes) → no-op.
 *   - a non-agency user → home only; a stray header is ignored (cannot switch).
 *   - an agency user sending `x-acting-merchant-id` → verify access, then swap
 *     `request.user.merchantId` to the child so every downstream tenant-scoped
 *     query runs against the selected client. `homeMerchantId` is preserved.
 *   - access denied → 403 AGENCY_ACCESS_DENIED.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** The agency user's own (home) merchant, before any account switch. */
    homeMerchantId?: string
    /** The effective merchant this request is scoped to (== user.merchantId). */
    actingMerchantId?: string
  }
}

function headerValue(request: FastifyRequest): string | undefined {
  const raw = request.headers[ACTING_MERCHANT_HEADER]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

export async function actingMerchantPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user as AgencyUser | undefined
  if (!user || !user.role) return

  // Record the baseline so handlers/components can always read both.
  request.homeMerchantId = user.merchantId
  request.actingMerchantId = user.merchantId

  // Only agency roles can act on another merchant. Ignore the header otherwise.
  const requested = headerValue(request)
  if (!requested || !isAgencyRole(user.role) || requested === user.merchantId) return

  try {
    const effective = await resolveActingMerchant(user, requested)
    request.user.merchantId = effective
    request.actingMerchantId = effective
  } catch (err) {
    if (err instanceof AgencyAccessError) {
      await reply.status(err.statusCode).send({
        success: false,
        error: { code: err.code, message: err.message },
      })
      return
    }
    throw err
  }
}
