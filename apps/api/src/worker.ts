import type { Job } from 'bullmq'
import type { ShopifyWebhookJob, BackfillJobData } from '@engageiq/shared'
import { createWebhookWorker } from './workers/webhook.worker.js'
import { createBackfillWorker } from './workers/backfill.worker.js'

const webhookWorker = createWebhookWorker()
const backfillWorker = createBackfillWorker()

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

const shutdown = async (): Promise<void> => {
  console.info('[workers] shutting down...')
  await Promise.all([webhookWorker.close(), backfillWorker.close()])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.info('[workers] started — webhook-ingestion + backfill queues')
