// apps/api/src/services/cod-verification/queue.ts
//
// The single place this lane talks to the cod-verification BullMQ queue. Isolating the enqueue
// calls here keeps the orchestration service (verification.service.ts) pure/DB-only and unit-testable
// without Redis, and gives the worker + routes one shared, idempotent enqueue surface.
//
// Idempotency: every scheduled job carries a deterministic jobId, so a duplicate enqueue (retry, a
// racing scan, a manual re-trigger) is de-duplicated by BullMQ rather than double-firing an attempt.
import { codVerificationQueue } from '@engageiq/queue'
import { COD_VERIFICATION } from '@engageiq/shared'
import type { VerificationJob, VerificationChannelName } from '@engageiq/shared'

// The next escalation tick the service asks the worker to schedule after an attempt is sent.
export interface NextTick {
  job: VerificationJob
  delayMs: number
  jobId: string
}

const REPEATABLE_SCAN_KEY = 'cod-verification-scan'

/** Enqueue the initial `start` job for an order (optionally delayed to the first-attempt offset). */
export async function enqueueStart(
  merchantId: string,
  codOrderId: string,
  channel: VerificationChannelName,
  delayMs = 0,
): Promise<void> {
  await codVerificationQueue.add(
    COD_VERIFICATION,
    { type: 'start', merchantId, codOrderId, channel },
    { jobId: `codverify:${codOrderId}:start`, delay: Math.max(0, delayMs) },
  )
}

/** Enqueue the next tick (a reminder or the finalize timeout) returned by runAttempt. */
export async function enqueueNext(next: NextTick): Promise<void> {
  await codVerificationQueue.add(COD_VERIFICATION, next.job, {
    jobId: next.jobId,
    delay: Math.max(0, next.delayMs),
  })
}

/**
 * Register the repeatable scan sweep. Runs every `everyMs` (default 60s) to pick up COD orders the
 * fake-order gate flagged PENDING_VERIFICATION and enroll them. Repeatable jobs are de-duplicated by
 * their repeat key, so calling this on every worker boot is safe.
 */
export async function registerScanScheduler(everyMs = 60_000): Promise<void> {
  await codVerificationQueue.add(
    COD_VERIFICATION,
    { type: 'scan' },
    {
      jobId: REPEATABLE_SCAN_KEY,
      repeat: { every: everyMs },
      removeOnComplete: true,
      removeOnFail: true,
    },
  )
}
