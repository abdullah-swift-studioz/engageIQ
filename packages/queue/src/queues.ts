import { Queue } from 'bullmq'
import { redisConnection } from './connection.js'

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

export const webhookIngestionQueue = new Queue('webhook-ingestion', {
  connection: redisConnection,
  defaultJobOptions,
})

export const backfillQueue = new Queue('backfill', {
  connection: redisConnection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
})

export const campaignSendQueue = new Queue('campaign-send', {
  connection: redisConnection,
  defaultJobOptions,
})

export const journeyExecutorQueue = new Queue('journey-executor', {
  connection: redisConnection,
  defaultJobOptions,
})

export const analyticsQueue = new Queue('analytics', {
  connection: redisConnection,
  defaultJobOptions,
})

export const segmentEvaluateQueue = new Queue('segment-evaluate', {
  connection: redisConnection,
  defaultJobOptions,
})

// lane:channels START
export const messageDispatchQueue = new Queue('message-dispatch', {
  connection: redisConnection,
  defaultJobOptions,
})
// lane:channels END
// lane:ml START
export const scoringQueue = new Queue('scoring', {
  connection: redisConnection,
  // Scoring runs are batch + idempotent; 2 attempts is enough (the ML service may
  // briefly be unavailable). Keep generous completed/failed retention for audit.
  defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
})
// lane:ml END
// lane:push START
// Web Push delivery. Best-effort per subscription; attempts:1 because a fan-out send that
// partially succeeds must not re-run (it would re-notify already-delivered devices). The
// worker handles transient per-subscription failures internally and prunes dead subs.
export const pushSendQueue = new Queue('push-send', {
  connection: redisConnection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
})
// lane:push END
// lane:courier START
// Courier status polling: a repeatable sweep enqueues one poll job per active shipment.
// Polls hit external courier APIs; keep the default retry/backoff for transient failures.
export const courierPollQueue = new Queue('courier-poll', {
  connection: redisConnection,
  defaultJobOptions,
})
// lane:courier END
// lane:public-api START
// Outbound-webhook delivery. Merchant endpoints can be flaky, so allow more attempts
// with exponential backoff. The worker also records every attempt on the WebhookDelivery
// row, so BullMQ retries and the delivery log stay consistent.
export const webhookDeliveryQueue = new Queue('webhook-delivery', {
  connection: redisConnection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 6, backoff: { type: 'exponential', delay: 5000 } },
})
// lane:public-api END
// lane:wa-conversation START
// Awaiting-reply timeouts for the two-way WhatsApp engine. Jobs are delayed to fire at awaitingReplyUntil.
// Retries are safe here: expireConversation is deadline-guarded (only the first attempt flips the state)
// and the timeout resume uses a deterministic dedupe jobId, so a retry after a transient failure/crash
// recovers the enrollment without double-firing the branch (default 3 attempts + backoff).
export const conversationTimeoutQueue = new Queue('conversation-timeout', {
  connection: redisConnection,
  defaultJobOptions,
})
// lane:wa-conversation END

export type QueueName =
  | 'webhook-ingestion'
  | 'backfill'
  | 'campaign-send'
  | 'journey-executor'
  | 'analytics'
  | 'segment-evaluate'
  // lane:channels START
  | 'message-dispatch'
// lane:channels END
  // lane:ml START
  | 'scoring'
// lane:ml END
  // lane:push START
  | 'push-send'
// lane:push END
  // lane:ml END
  // lane:courier START
  | 'courier-poll'
// lane:courier END
  // lane:ml END
  // lane:public-api START
  | 'webhook-delivery'
// lane:public-api END
  // lane:wa-conversation START
  | 'conversation-timeout'
// lane:wa-conversation END
