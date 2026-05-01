import { prisma } from '@engageiq/db'
import { Prisma } from '@prisma/client'
import type { SdkIdentifyPayload } from '@engageiq/shared'

export interface StitchResult {
  customerId: string | null
  isNewCustomer: boolean
}

/**
 * Links an anonymous SDK visitor to a known customer.
 *
 * Lookup order: shopify_customer_id → email → phone
 * If a match is found, the anon_id is appended to customer.anonIds (deduped).
 * If email or phone is provided but no customer exists yet, a stub customer
 * is created so future webhook-delivered data can merge into it.
 */
export async function stitchIdentity(payload: SdkIdentifyPayload): Promise<StitchResult> {
  const { merchant_id, anon_id, shopify_customer_id, email, phone } = payload

  // ── 1. Try existing customer lookups ───────────────────────────────────────
  let customer = await findCustomer(merchant_id, { shopify_customer_id, email, phone })

  if (customer) {
    // Only update if this anon_id is genuinely new — avoids unnecessary writes
    if (!customer.anonIds.includes(anon_id)) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          anonIds: { push: anon_id },
          lastSeenAt: new Date(),
        },
      })
    } else {
      // Still refresh lastSeenAt
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastSeenAt: new Date() },
      })
    }
    return { customerId: customer.id, isNewCustomer: false }
  }

  // ── 2. Create a stub customer for email/phone (no shopify_customer_id) ──────
  // When the Shopify webhook arrives later, the webhook processor will upsert
  // this record by shopifyCustomerId, merging into the existing row.
  if (!shopify_customer_id && (email || phone)) {
    const normalizedPhone = phone ? normalizePhone(phone) : null

    // Double-check with normalised phone (avoid race on near-simultaneous calls)
    if (normalizedPhone) {
      customer = await prisma.customer.findFirst({
        where: { merchantId: merchant_id, phone: normalizedPhone },
      })
    }

    if (!customer) {
      try {
        customer = await prisma.customer.create({
          data: {
            merchantId: merchant_id,
            email: email ?? null,
            phone: normalizedPhone,
            anonIds: [anon_id],
            lastSeenAt: new Date(),
          },
        })
        return { customerId: customer.id, isNewCustomer: true }
      } catch (err) {
        // P2002: unique constraint violation — a concurrent request created the same stub
        // (same merchantId+email). Fall through to find and update the winning row.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
          throw err
        }
        customer = await prisma.customer.findFirst({
          where: {
            merchantId: merchant_id,
            ...(email ? { email } : { phone: normalizedPhone }),
          },
        })
      }
    }

    // Found via normalised phone in the race-check, or recovered after a P2002 race
    if (!customer) return { customerId: null, isNewCustomer: false }
    if (!customer.anonIds.includes(anon_id)) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { anonIds: { push: anon_id }, lastSeenAt: new Date() },
      })
    }
    return { customerId: customer.id, isNewCustomer: false }
  }

  // No match and no identifiers sufficient to create a stub
  return { customerId: null, isNewCustomer: false }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findCustomer(
  merchantId: string,
  ids: { shopify_customer_id?: string; email?: string; phone?: string },
) {
  const { shopify_customer_id, email, phone } = ids

  if (shopify_customer_id) {
    const c = await prisma.customer.findFirst({
      where: { merchantId, shopifyCustomerId: shopify_customer_id },
    })
    if (c) return c
  }

  if (email) {
    const c = await prisma.customer.findFirst({
      where: { merchantId, email },
    })
    if (c) return c
  }

  if (phone) {
    const normalized = normalizePhone(phone)
    if (normalized) {
      const c = await prisma.customer.findFirst({
        where: { merchantId, phone: normalized },
      })
      if (c) return c
    }
  }

  return null
}

/**
 * Best-effort E.164 normalisation for Pakistani mobile numbers.
 * Accepts: 03001234567, +923001234567, 923001234567
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  // Already in E.164-ish form (92...)
  if (digits.startsWith('92') && digits.length === 12) return '+' + digits

  // Local form (03...) → +923...
  if (digits.startsWith('0') && digits.length === 11) return '+92' + digits.slice(1)

  // International form already has country code
  if (digits.length >= 10) return '+' + digits

  return null
}
