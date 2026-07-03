import type { Job } from 'bullmq'
import type { ShopifyWebhookJob, BackfillJobData, SegmentEvaluateJobPayload, JourneyExecutorJob, MessageDispatchJob } from '@engageiq/shared'
import { createWebhookWorker } from './workers/webhook.worker.js'
import { createBackfillWorker } from './workers/backfill.worker.js'
import { createSegmentEvaluateWorker } from './workers/segment-evaluate.worker.js'
import { createJourneyExecutorWorker } from './workers/journey-executor.worker.js'
// lane:channels START
import { createMessageDispatchWorker } from './workers/message-dispatch.worker.js'
// lane:channels END
// lane:analytics START
import type { AnalyticsJob } from '@engageiq/shared'
import { createAnalyticsWorker } from './workers/analytics.worker.js'
// lane:analytics END
// lane:ml START
import type { ScoringJob } from '@engageiq/shared'
import { env } from '@engageiq/shared'
import { createScoringWorker, registerScoringSchedulers } from './workers/scoring.worker.js'
// lane:ml END
// lane:campaigns START
import type { CampaignSendJob } from '@engageiq/shared'
import { createCampaignSendWorker } from './workers/campaign-send.worker.js'
// lane:campaigns END
// lane:courier START
import type { CourierJob } from '@engageiq/shared'
import { env as courierEnv } from '@engageiq/shared'
import { createCourierPollWorker, registerCourierPollScheduler } from './workers/courier-poll.worker.js'
// lane:courier END

const webhookWorker = createWebhookWorker()
const backfillWorker = createBackfillWorker()
const segmentEvaluateWorker = createSegmentEvaluateWorker()
const journeyExecutorWorker = createJourneyExecutorWorker()
// lane:channels START
const messageDispatchWorker = createMessageDispatchWorker()
// lane:channels END
// lane:analytics START
const analyticsWorker = createAnalyticsWorker()
// lane:analytics END
// lane:campaigns START
const campaignSendWorker = createCampaignSendWorker()
// lane:campaigns END
// lane:courier START
const courierPollWorker = createCourierPollWorker()
// lane:courier END

webhookWorker.on('completed', (job: Job<ShopifyWebhookJob>) => {
  console.info(`[webhook-worker] completed  job=${job.id} topic=${job.name}`)
})

webhookWorker.on('failed', (job: Job<ShopifyWebhookJob> | undefined, err: Error) => {
  console.error(`[webhook-worker] failed     job=${job?.id} topic=${job?.name} error=${err.message}`)
})

webhookWorker.on('error', (err: Error) => {
  console.error('[webhook-worker] worker error:', err)
})

backfillWorker.on('completed', (job: Job<BackfillJobData>) => {
  console.info(`[backfill-worker] completed  job=${job.id} merchantId=${job.data.merchantId}`)
})

backfillWorker.on('failed', (job: Job<BackfillJobData> | undefined, err: Error) => {
  console.error(`[backfill-worker] failed    job=${job?.id} merchantId=${job?.data.merchantId} error=${err.message}`)
})

backfillWorker.on('error', (err: Error) => {
  console.error('[backfill-worker] worker error:', err)
})

backfillWorker.on('progress', (job: Job<BackfillJobData>, progress: unknown) => {
  console.info(`[backfill-worker] progress  job=${job.id} merchantId=${job.data.merchantId} ${progress}%`)
})

segmentEvaluateWorker.on('completed', (job: Job<SegmentEvaluateJobPayload>) => {
  console.info(`[segment-evaluate-worker] completed  job=${job.id} segmentId=${job.data.segmentId}`)
})

segmentEvaluateWorker.on('failed', (job: Job<SegmentEvaluateJobPayload> | undefined, err: Error) => {
  console.error(`[segment-evaluate-worker] failed    job=${job?.id} segmentId=${job?.data.segmentId} error=${err.message}`)
})

segmentEvaluateWorker.on('error', (err: Error) => {
  console.error('[segment-evaluate-worker] worker error:', err)
})

journeyExecutorWorker.on('completed', (job: Job<JourneyExecutorJob>) => {
  console.info(`[journey-executor-worker] completed  job=${job.id} type=${job.data.type}`)
})

journeyExecutorWorker.on('failed', (job: Job<JourneyExecutorJob> | undefined, err: Error) => {
  console.error(`[journey-executor-worker] failed    job=${job?.id} type=${job?.data.type} error=${err.message}`)
})

journeyExecutorWorker.on('error', (err: Error) => {
  console.error('[journey-executor-worker] worker error:', err)
})

// lane:channels START
messageDispatchWorker.on('completed', (job: Job<MessageDispatchJob>) => {
  console.info(`[message-dispatch-worker] completed  job=${job.id} channel=${job.data.channel}`)
})

messageDispatchWorker.on('failed', (job: Job<MessageDispatchJob> | undefined, err: Error) => {
  console.error(`[message-dispatch-worker] failed    job=${job?.id} channel=${job?.data.channel} error=${err.message}`)
})

messageDispatchWorker.on('error', (err: Error) => {
  console.error('[message-dispatch-worker] worker error:', err)
})
// lane:channels END
// lane:analytics START
analyticsWorker.on('completed', (job: Job<AnalyticsJob>) => {
  console.info(`[analytics-worker] completed  job=${job.id} type=${job.data.type}`)
})

analyticsWorker.on('failed', (job: Job<AnalyticsJob> | undefined, err: Error) => {
  console.error(`[analytics-worker] failed    job=${job?.id} type=${job?.data.type} error=${err.message}`)
})

analyticsWorker.on('error', (err: Error) => {
  console.error('[analytics-worker] worker error:', err)
})
// lane:analytics END
// lane:campaigns START
campaignSendWorker.on('completed', (job: Job<CampaignSendJob>) => {
  console.info(`[campaign-send-worker] completed  job=${job.id} campaignId=${job.data.campaignId}`)
})

campaignSendWorker.on('failed', (job: Job<CampaignSendJob> | undefined, err: Error) => {
  console.error(`[campaign-send-worker] failed    job=${job?.id} campaignId=${job?.data.campaignId} error=${err.message}`)
})

campaignSendWorker.on('error', (err: Error) => {
  console.error('[campaign-send-worker] worker error:', err)
})
// lane:campaigns END
// lane:courier START
courierPollWorker.on('completed', (job: Job<CourierJob>) => {
  console.info(`[courier-poll-worker] completed  job=${job.id} type=${job.data.type}`)
})

courierPollWorker.on('failed', (job: Job<CourierJob> | undefined, err: Error) => {
  console.error(`[courier-poll-worker] failed    job=${job?.id} type=${job?.data.type} error=${err.message}`)
})

courierPollWorker.on('error', (err: Error) => {
  console.error('[courier-poll-worker] worker error:', err)
})

if (courierEnv.COURIER_POLL_ENABLED) {
  registerCourierPollScheduler()
    .then(() => console.info('[courier-poll-worker] scheduler registered (repeatable sweep)'))
    .catch((err: Error) => console.error('[courier-poll-worker] scheduler registration failed:', err.message))
}
// lane:courier END

const shutdown = async (): Promise<void> => {
  console.info('[workers] shutting down...')
  await Promise.all([
    webhookWorker.close(),
    backfillWorker.close(),
    segmentEvaluateWorker.close(),
    journeyExecutorWorker.close(),
    // lane:channels START
    messageDispatchWorker.close(),
    // lane:channels END
    // lane:analytics START
    analyticsWorker.close(),
    // lane:analytics END
    // lane:ml START
    scoringWorker.close(),
    // lane:ml END
    // lane:campaigns START
    campaignSendWorker.close(),
    // lane:campaigns END
    // lane:courier START
    courierPollWorker.close(),
    // lane:courier END
  ])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.info('[workers] started — webhook-ingestion + backfill + segment-evaluate + journey-executor + message-dispatch + analytics + scoring queues')

// lane:ml START
const scoringWorker = createScoringWorker()

scoringWorker.on('completed', (job: Job<ScoringJob>) => {
  console.info(`[scoring-worker] completed  job=${job.id} task=${job.data.task} merchant=${job.data.merchantId ?? 'ALL'}`)
})

scoringWorker.on('failed', (job: Job<ScoringJob> | undefined, err: Error) => {
  console.error(`[scoring-worker] failed     job=${job?.id} task=${job?.data.task} error=${err.message}`)
})

scoringWorker.on('error', (err: Error) => {
  console.error('[scoring-worker] worker error:', err)
})

if (env.ML_SCHEDULER_ENABLED) {
  registerScoringSchedulers()
    .then(() => console.info('[scoring-worker] schedulers registered (daily full + weekly segment-discovery)'))
    .catch((err: Error) => console.error('[scoring-worker] scheduler registration failed:', err.message))
}
// lane:ml END
