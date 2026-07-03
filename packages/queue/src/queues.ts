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
// lane:courier START
// Courier status polling: a repeatable sweep enqueues one poll job per active shipment.
// Polls hit external courier APIs; keep the default retry/backoff for transient failures.
export const courierPollQueue = new Queue('courier-poll', {
  connection: redisConnection,
  defaultJobOptions,
})
// lane:courier END

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
  // lane:courier START
  | 'courier-poll'
// lane:courier END
