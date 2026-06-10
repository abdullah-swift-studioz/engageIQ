import type { Job } from 'bullmq'
import type { ShopifyWebhookJob, BackfillJobData, SegmentEvaluateJobPayload, JourneyExecutorJob } from '@engageiq/shared'
import { createWebhookWorker } from './workers/webhook.worker.js'
import { createBackfillWorker } from './workers/backfill.worker.js'
import { createSegmentEvaluateWorker } from './workers/segment-evaluate.worker.js'
import { createJourneyExecutorWorker } from './workers/journey-executor.worker.js'

const webhookWorker = createWebhookWorker()
const backfillWorker = createBackfillWorker()
const segmentEvaluateWorker = createSegmentEvaluateWorker()
const journeyExecutorWorker = createJourneyExecutorWorker()

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

const shutdown = async (): Promise<void> => {
  console.info('[workers] shutting down...')
  await Promise.all([
    webhookWorker.close(),
    backfillWorker.close(),
    segmentEvaluateWorker.close(),
    journeyExecutorWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.info('[workers] started — webhook-ingestion + backfill + segment-evaluate + journey-executor queues')
