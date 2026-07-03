// apps/api/src/services/push/dispatch.ts
//
// The single core of Web Push delivery. Both entry points funnel through sendPushToCustomer:
//   • the push-send worker (frozen PushSendJob — dedicated queue), and
//   • the message-dispatch PUSH branch (journey/campaign ACTION sends).
//
// It loads the customer's active subscriptions, fans out one adapter send per subscription,
// prunes any that the push service reports Gone (404/410), and writes ONE Message row per
// logical send (SENT if ≥1 subscription received it, else FAILED). Push has no meaningful
// per-attempt retry — a partial fan-out must not re-run and re-notify delivered devices —
// so every outcome here is terminal.
import { prisma } from '@engageiq/db'
import type { Prisma } from '@prisma/client'
import type { MessageDispatchJob, PushNotification, WebPushSubscription } from '@engageiq/shared'
import { pushAdapter } from '../../lib/channels/push.adapter.js'
import { getActiveSubscriptions, pruneSubscription, touchSubscription } from './subscription.service.js'

export interface SendPushOptions {
  merchantId: string
  customerId: string
  notification: PushNotification
  // Limit the fan-out to a single subscription (PushSendJob.pushSubscriptionId). Omit → all.
  pushSubscriptionId?: string
  // Default true. The push-send worker honours Customer.isSubscribedPush; set false only for
  // an explicit operator/test send.
  respectConsent?: boolean
  // Attribution links written onto the Message row (campaign / journey / template).
  attribution?: { templateId?: string; journeyEnrollmentId?: string; campaignId?: string }
}

export interface SendPushResult {
  status: 'SENT' | 'FAILED' | 'SKIPPED'
  reason?: string
  messageId?: string
  sent: number
  failed: number
  pruned: number
}

const SKIP = (reason: string): SendPushResult => ({ status: 'SKIPPED', reason, sent: 0, failed: 0, pruned: 0 })

async function loadTargets(
  opts: SendPushOptions,
): Promise<Array<{ id: string; endpoint: string; keys: WebPushSubscription['keys'] }>> {
  if (opts.pushSubscriptionId) {
    const one = await prisma.pushSubscription.findFirst({
      where: {
        id: opts.pushSubscriptionId,
        merchantId: opts.merchantId,
        customerId: opts.customerId,
        isActive: true,
      },
      select: { id: true, endpoint: true, keys: true },
    })
    if (!one) return []
    return [{ id: one.id, endpoint: one.endpoint, keys: one.keys as unknown as WebPushSubscription['keys'] }]
  }
  return getActiveSubscriptions(opts.merchantId, opts.customerId)
}

export async function sendPushToCustomer(opts: SendPushOptions): Promise<SendPushResult> {
  // 1. Customer + consent (tenant-scoped).
  const customer = await prisma.customer.findFirst({
    where: { id: opts.customerId, merchantId: opts.merchantId },
    select: { id: true, isSubscribedPush: true },
  })
  if (!customer) return SKIP('customer_not_found')
  if (opts.respectConsent !== false && !customer.isSubscribedPush) return SKIP('unsubscribed')

  // 2. Fan-out targets.
  const targets = await loadTargets(opts)
  if (targets.length === 0) return SKIP('no_active_subscription')

  // 3. Send to every subscription; prune the dead ones.
  let sent = 0
  let failed = 0
  let pruned = 0
  for (const sub of targets) {
    const result = await pushAdapter.send({
      channel: 'PUSH',
      subscription: { endpoint: sub.endpoint, keys: sub.keys },
      notification: opts.notification,
    })
    if (result.ok) {
      sent += 1
      await touchSubscription(sub.id)
    } else {
      failed += 1
      if (result.errorCode === 'GONE') {
        pruned += 1
        await pruneSubscription(sub.id)
      }
    }
  }

  // 4. One Message row summarising the logical send (audit trail for the message log).
  const status: 'SENT' | 'FAILED' = sent > 0 ? 'SENT' : 'FAILED'
  const now = new Date()
  const metadata: Prisma.InputJsonValue = {
    title: opts.notification.title,
    ...(opts.notification.url ? { url: opts.notification.url } : {}),
    ...(opts.notification.icon ? { icon: opts.notification.icon } : {}),
    sent,
    failed,
    pruned,
  }
  const message = await prisma.message.create({
    data: {
      merchantId: opts.merchantId,
      customerId: opts.customerId,
      channel: 'PUSH',
      direction: 'OUTBOUND',
      status,
      body: opts.notification.body,
      toPhone: '', // push uses the '' sentinel (schema)
      subject: opts.notification.title,
      metadata,
      ...(opts.attribution?.templateId ? { templateId: opts.attribution.templateId } : {}),
      ...(opts.attribution?.journeyEnrollmentId
        ? { journeyEnrollmentId: opts.attribution.journeyEnrollmentId }
        : {}),
      ...(opts.attribution?.campaignId ? { campaignId: opts.attribution.campaignId } : {}),
      ...(status === 'SENT' ? { sentAt: now } : { failedAt: now, errorTitle: 'All push subscriptions failed' }),
    },
    select: { id: true },
  })

  return { status, messageId: message.id, sent, failed, pruned }
}

// Bridge used by the message-dispatch PUSH branch. Maps the generic MessageDispatchJob
// content shape ({ body, subject? }) onto a push notification and carries campaign/journey
// attribution through, so the message log and CampaignRecipient linkage stay intact.
export async function dispatchPushForMessageJob(
  data: MessageDispatchJob,
): Promise<{ recipientStatus: 'SENT' | 'FAILED' | 'SKIPPED'; messageId?: string }> {
  const result = await sendPushToCustomer({
    merchantId: data.merchantId,
    customerId: data.customerId,
    notification: {
      title: data.content.subject?.trim() || 'New notification',
      body: data.content.body,
    },
    respectConsent: true,
    attribution: {
      ...(data.templateId ? { templateId: data.templateId } : {}),
      ...(data.journeyEnrollmentId ? { journeyEnrollmentId: data.journeyEnrollmentId } : {}),
      ...(data.campaignId ? { campaignId: data.campaignId } : {}),
    },
  })
  return { recipientStatus: result.status, ...(result.messageId ? { messageId: result.messageId } : {}) }
}
