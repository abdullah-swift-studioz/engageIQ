// apps/api/src/workers/courier-poll.worker.ts
//
// Consumes the courier-poll queue (roadmap 8.1 / guide §9.2). Two job shapes on one queue:
//   - sweep: enqueue a poll job per active shipment (scheduled global run, or a manual
//            single-merchant sync).
//   - poll:  fetch + apply one shipment's latest courier status (idempotent).
//
// A retryable poll failure (5xx / 429 / network) throws so BullMQ retries with backoff;
// anything else (bad creds, not configured, unrecognized status) resolves cleanly and is
// recorded in the completed log — it is not worth retrying.
import { Worker } from 'bullmq'
import { redisConnection, courierPollQueue } from '@engageiq/queue'
import { COURIER_POLL, env } from '@engageiq/shared'
import type { CourierJob } from '@engageiq/shared'
import { pollShipment, enqueueSweep } from '../services/couriers/sync.service.js'

export function createCourierPollWorker(): Worker<CourierJob> {
  return new Worker<CourierJob>(
    COURIER_POLL,
    async (job) => {
      const data = job.data
      if (data.type === 'sweep') {
        const enqueued = await enqueueSweep(data.merchantId)
        return { enqueued }
      }
      const outcome = await pollShipment(data.merchantId, data.shipmentId)
      if (outcome.result === 'failed' && outcome.retryable) {
        // Throw → BullMQ retry with exponential backoff (queue defaultJobOptions).
        throw new Error(`courier poll failed (retryable): ${outcome.error}`)
      }
      return outcome
    },
    { connection: redisConnection },
  )
}

// Register the repeatable global sweep (gated by COURIER_POLL_ENABLED on the worker).
export async function registerCourierPollScheduler(): Promise<void> {
  await courierPollQueue.upsertJobScheduler(
    'courier-sweep-all',
    { pattern: env.COURIER_POLL_CRON },
    { name: COURIER_POLL, data: { type: 'sweep' } satisfies CourierJob },
  )
}
