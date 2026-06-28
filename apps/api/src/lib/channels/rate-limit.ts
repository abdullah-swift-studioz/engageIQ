// apps/api/src/lib/channels/rate-limit.ts
//
// Per-merchant send rate limiting (spec §4.5 step 3). A Redis fixed-window counter
// keyed by merchant: INCR the window key, set EXPIRE on the first hit, allow while
// the count is within the cap. When over cap the worker re-enqueues the same job
// with a jittered delay so retries don't all fire at the window boundary together.
import { redisConnection } from '@engageiq/queue'

export const RATE_WINDOW_SECONDS = 1
// Conservative default; Meta's actual per-number throughput is higher. Tunable.
export const DEFAULT_RATE_CAP = 80
export const RATE_REENQUEUE_BASE_MS = 1000
export const RATE_REENQUEUE_JITTER_MS = 500

export async function checkRateLimit(
  merchantId: string,
  cap: number = DEFAULT_RATE_CAP,
): Promise<boolean> {
  const key = `ratelimit:wa:${merchantId}`
  const count = await redisConnection.incr(key)
  if (count === 1) {
    await redisConnection.expire(key, RATE_WINDOW_SECONDS)
  }
  return count <= cap
}

// Deterministic per-job jitter (derived from the job id, no Math.random) so the
// same job's re-enqueue is stable but different jobs spread across the window tail.
export function jitteredReEnqueueDelay(jobId: string | undefined): number {
  let hash = 0
  for (const ch of jobId ?? 'unknown') {
    hash = (hash * 31 + ch.charCodeAt(0)) % 100003
  }
  const jitter = hash % (RATE_REENQUEUE_JITTER_MS + 1)
  return RATE_REENQUEUE_BASE_MS + jitter
}
