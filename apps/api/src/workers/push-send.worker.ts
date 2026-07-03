// apps/api/src/workers/push-send.worker.ts
//
// Consumes the frozen `push-send` queue (PushSendJob). This is the dedicated Web Push
// delivery seam: a caller enqueues a fully-rendered notification (title/body/url/icon) for
// one customer, optionally targeting a single subscription. Delivery, fan-out, pruning and
// the Message audit row all live in the shared push dispatch core.
//
// Idempotency: attempts is pinned to 1 (queues.ts) because a partial fan-out must not re-run
// and re-notify already-delivered devices. Consent (Customer.isSubscribedPush) is enforced
// by the dispatch core.
import { Worker } from 'bullmq'
import { redisConnection } from '@engageiq/queue'
import type { PushSendJob } from '@engageiq/shared'
import { sendPushToCustomer } from '../services/push/dispatch.js'

export async function processPushSendJob(data: PushSendJob): Promise<void> {
  await sendPushToCustomer({
    merchantId: data.merchantId,
    customerId: data.customerId,
    notification: {
      title: data.title,
      body: data.body,
      ...(data.url ? { url: data.url } : {}),
      ...(data.icon ? { icon: data.icon } : {}),
    },
    ...(data.pushSubscriptionId ? { pushSubscriptionId: data.pushSubscriptionId } : {}),
    respectConsent: true,
  })
}

export function createPushSendWorker(): Worker<PushSendJob> {
  return new Worker<PushSendJob>(
    'push-send',
    async (job) => {
      await processPushSendJob(job.data)
    },
    { connection: redisConnection, concurrency: 10 },
  )
}
