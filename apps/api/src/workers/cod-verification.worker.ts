// apps/api/src/workers/cod-verification.worker.ts
//
// The BullMQ worker that drives the COD verification escalation (roadmap 6.4 / guide §7.4).
// It owns ALL timing for the flow (WhatsApp AND SMS/IVR need escalation; the conversation-timeout
// queue is WhatsApp-only), scheduling delayed jobs for each ladder step:
//
//   scan (repeatable)  → enqueue `start` for every PENDING_VERIFICATION order without attempts
//   start              → send attempt #1, schedule the next tick (reminder #2 or the finalize timeout)
//   reminder #N        → send attempt #N, schedule the next tick
//   timeout            → auto-cancel (or hold for review) on no-response
//
// Idempotency + races: the ORDER's verificationStatus is the single source of truth. Every job no-ops
// once it leaves PENDING_VERIFICATION, so a reply that lands the same instant a timer fires can never
// double-decide. All scheduled jobs carry deterministic jobIds (see ./queue.ts) so retries de-dupe.
import { Worker } from 'bullmq'
import { redisConnection } from '@engageiq/queue'
import { COD_VERIFICATION } from '@engageiq/shared'
import type { VerificationJob, CodVerificationScanJob } from '@engageiq/shared'
import {
  scanPendingVerifications,
  runAttempt,
  finalizeVerification,
} from '../services/cod-verification/verification.service.js'
import { enqueueStart, enqueueNext } from '../services/cod-verification/queue.js'

type CodVerificationJobData = VerificationJob | CodVerificationScanJob

export async function processCodVerificationJob(data: CodVerificationJobData): Promise<void> {
  switch (data.type) {
    case 'scan': {
      const enrollments = await scanPendingVerifications()
      for (const e of enrollments) {
        await enqueueStart(e.merchantId, e.codOrderId, e.channel, e.delayMs)
      }
      if (enrollments.length > 0) {
        console.info(`[cod-verification-worker] scan enrolled ${enrollments.length} order(s)`)
      }
      return
    }
    case 'start': {
      // start = attempt #1.
      const result = await runAttempt(data.merchantId, data.codOrderId, 1)
      if (result.next) await enqueueNext(result.next)
      return
    }
    case 'reminder': {
      const result = await runAttempt(data.merchantId, data.codOrderId, data.attemptNumber)
      if (result.next) await enqueueNext(result.next)
      return
    }
    case 'timeout': {
      await finalizeVerification(data.merchantId, data.codOrderId)
      return
    }
  }
}

export function createCodVerificationWorker(): Worker<CodVerificationJobData> {
  return new Worker<CodVerificationJobData>(
    COD_VERIFICATION,
    async (job) => {
      await processCodVerificationJob(job.data)
    },
    { connection: redisConnection },
  )
}
