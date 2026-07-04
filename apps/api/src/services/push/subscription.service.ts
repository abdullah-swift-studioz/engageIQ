// apps/api/src/services/push/subscription.service.ts
//
// Manages browser Web Push subscriptions (the PushSubscription table). A subscription must
// attach to a Customer (the FK is non-null), so registration resolves the subscriber to a
// customer — by explicit customerId, else by anon_id (SDK cookie), else it creates a stub
// customer keyed by anon_id (mirroring the storefront identity-stitch stub pattern). The
// stub merges cleanly later when the visitor identifies (mergeCustomers unions anonIds).
//
// Every query is tenant-scoped by merchantId (CLAUDE.md hard rule).
import { prisma } from '@engageiq/db'
import type { Prisma } from '@prisma/client'
import type { WebPushSubscription } from '@engageiq/shared'

// Resolve the subscriber to a customer id, creating an anon stub if none exists.
// Returns null only when there is no way to attach (no anon_id and no valid customer).
export async function resolveSubscriberCustomerId(
  merchantId: string,
  opts: { anonId?: string; customerId?: string },
): Promise<string | null> {
  // 1. Explicit customerId — validate it belongs to this merchant and is not a merge tombstone.
  if (opts.customerId) {
    const c = await prisma.customer.findFirst({
      where: { id: opts.customerId, merchantId, mergedIntoId: null },
      select: { id: true },
    })
    if (c) return c.id
  }

  if (!opts.anonId) return null

  // 2. Existing customer that already owns this anon_id.
  const byAnon = await prisma.customer.findFirst({
    where: { merchantId, anonIds: { has: opts.anonId }, mergedIntoId: null },
    select: { id: true },
  })
  if (byAnon) return byAnon.id

  // 3. No known customer — create an anon stub so the subscription can attach.
  try {
    const stub = await prisma.customer.create({
      data: { merchantId, anonIds: [opts.anonId] },
      select: { id: true },
    })
    return stub.id
  } catch (err) {
    // A concurrent request may have created the stub first — re-resolve by anon_id.
    if ((err as { code?: string }).code === 'P2002') {
      const raced = await prisma.customer.findFirst({
        where: { merchantId, anonIds: { has: opts.anonId }, mergedIntoId: null },
        select: { id: true },
      })
      if (raced) return raced.id
    }
    throw err
  }
}

// Upsert a subscription by its unique (merchantId, endpoint). Re-registering the same
// browser reactivates the row and refreshes its keys / owning customer — never duplicates.
export async function registerSubscription(input: {
  merchantId: string
  customerId: string
  subscription: WebPushSubscription
  userAgent?: string | null
}): Promise<{ id: string }> {
  const keys = input.subscription.keys as unknown as Prisma.InputJsonValue
  const row = await prisma.pushSubscription.upsert({
    where: { merchantId_endpoint: { merchantId: input.merchantId, endpoint: input.subscription.endpoint } },
    create: {
      merchantId: input.merchantId,
      customerId: input.customerId,
      endpoint: input.subscription.endpoint,
      keys,
      userAgent: input.userAgent ?? null,
      isActive: true,
      lastUsedAt: new Date(),
    },
    update: {
      customerId: input.customerId,
      keys,
      userAgent: input.userAgent ?? null,
      isActive: true,
      lastUsedAt: new Date(),
    },
    select: { id: true },
  })
  return row
}

// Deactivate a subscription by endpoint (browser-side unsubscribe). Merchant-scoped.
export async function deactivateByEndpoint(merchantId: string, endpoint: string): Promise<number> {
  const res = await prisma.pushSubscription.updateMany({
    where: { merchantId, endpoint },
    data: { isActive: false, expiredAt: new Date() },
  })
  return res.count
}

// All active subscriptions for a customer (fan-out targets), tenant-scoped.
export async function getActiveSubscriptions(
  merchantId: string,
  customerId: string,
): Promise<Array<{ id: string; endpoint: string; keys: WebPushSubscription['keys'] }>> {
  const rows = await prisma.pushSubscription.findMany({
    where: { merchantId, customerId, isActive: true },
    select: { id: true, endpoint: true, keys: true },
  })
  return rows.map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    keys: r.keys as unknown as WebPushSubscription['keys'],
  }))
}

// Prune a dead subscription (push service returned 404/410 Gone). Idempotent.
export async function pruneSubscription(id: string): Promise<void> {
  await prisma.pushSubscription.updateMany({
    where: { id },
    data: { isActive: false, expiredAt: new Date() },
  })
}

// Mark a subscription as freshly used (successful delivery). Best-effort.
export async function touchSubscription(id: string): Promise<void> {
  await prisma.pushSubscription
    .updateMany({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch(() => {/* best-effort */})
}
