import { Worker, UnrecoverableError } from 'bullmq'
import { redisConnection } from '@engageiq/queue'
import type { AnalyticsJob } from '@engageiq/shared'
import { computeProductAnalytics } from '../routes/analytics/lib/product-analytics.service.js'

/**
 * Consumer for the `analytics` queue (previously declared with no consumer).
 * Handles precompute jobs whose results back the on-demand analytics read routes.
 *
 * Jobs are idempotent: each recomputes from source, so duplicate/retried deliveries
 * converge to the same persisted state.
 */
export function createAnalyticsWorker(): Worker<AnalyticsJob> {
  return new Worker<AnalyticsJob>(
    'analytics',
    async (job) => {
      switch (job.data.type) {
        case 'product-analytics': {
          const { merchantId } = job.data
          if (!merchantId) throw new UnrecoverableError('product-analytics job missing merchantId')
          const summary = await computeProductAnalytics(merchantId)
          return summary
        }
        default: {
          // Exhaustiveness guard — unknown job types are non-retryable.
          throw new UnrecoverableError(
            `Unknown analytics job type: ${(job.data as { type?: string }).type ?? 'undefined'}`,
          )
        }
      }
    },
    { connection: redisConnection },
  )
}
