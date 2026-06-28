// Analytics-specific ClickHouse queries.
//
// All access goes through the `clickhouse` client exported by @engageiq/db (the project's
// CH abstraction) — we never import `@clickhouse/client` directly (CLAUDE.md hard rule).
// Every query is tenant-scoped by merchant_id. The events table is engageiq.events with
// columns: merchant_id, customer_id, anon_id, event_type, properties (JSON string),
// session_id, timestamp (DateTime64 UTC).

import { clickhouse } from '@engageiq/db'
import { toClickHouseDateTime } from './dates.js'

const TABLE = 'engageiq.events'

/** Generic JSONEachRow query helper. Always pass merchant_id inside `params`. */
export async function chQuery<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
  const result = await clickhouse.query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  })
  return result.json<T>()
}

/** Sum of `properties.revenue` over `purchase` events in [from, to). */
export async function getRevenueBetween(merchantId: string, from: Date, to: Date): Promise<number> {
  const rows = await chQuery<{ revenue: string }>(
    `
      SELECT sum(toFloat64OrZero(JSONExtractString(properties, 'revenue'))) AS revenue
      FROM ${TABLE}
      WHERE merchant_id = {merchantId:String}
        AND event_type = 'purchase'
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp <  {to:DateTime64(3, 'UTC')}
    `,
    { merchantId, from: toClickHouseDateTime(from), to: toClickHouseDateTime(to) },
  )
  return rows.length ? Number(rows[0]!.revenue) : 0
}

/** Count of events of a given type in [from, to). */
export async function countEventsBetween(
  merchantId: string,
  eventType: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await chQuery<{ c: string }>(
    `
      SELECT count() AS c
      FROM ${TABLE}
      WHERE merchant_id = {merchantId:String}
        AND event_type = {eventType:String}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp <  {to:DateTime64(3, 'UTC')}
    `,
    { merchantId, eventType, from: toClickHouseDateTime(from), to: toClickHouseDateTime(to) },
  )
  return rows.length ? Number(rows[0]!.c) : 0
}

/** Distinct visitors (coalesce(customer_id, anon_id)) in [from, to). */
export async function countDistinctVisitorsBetween(
  merchantId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await chQuery<{ v: string }>(
    `
      SELECT uniqExact(coalesce(customer_id, anon_id)) AS v
      FROM ${TABLE}
      WHERE merchant_id = {merchantId:String}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp <  {to:DateTime64(3, 'UTC')}
    `,
    { merchantId, from: toClickHouseDateTime(from), to: toClickHouseDateTime(to) },
  )
  return rows.length ? Number(rows[0]!.v) : 0
}

/**
 * Sequential funnel using ClickHouse windowFunnel. Returns, for each step index i
 * (0-based), the number of visitors who completed steps 0..i in order within the window.
 *
 * `steps` is an ordered list of event_type names. `windowSeconds` is the max time from the
 * first step to the last for a visitor to count (default = the whole period, 90 days).
 * Counts are monotonically non-increasing across steps (funnel invariant).
 */
export async function computeFunnel(
  merchantId: string,
  steps: string[],
  from: Date,
  to: Date,
  windowSeconds = 90 * 86_400,
): Promise<number[]> {
  if (steps.length === 0) return []

  // Build windowFunnel conditions + a per-step param for each event name.
  const params: Record<string, unknown> = {
    merchantId,
    from: toClickHouseDateTime(from),
    to: toClickHouseDateTime(to),
    window: windowSeconds,
  }
  const conditions = steps
    .map((_, i) => {
      params[`step${i}`] = steps[i]
      return `event_type = {step${i}:String}`
    })
    .join(', ')

  // Per visitor: the furthest funnel level reached (0..steps.length).
  // Then histogram those levels and turn the histogram into cumulative "reached step i" counts.
  const rows = await chQuery<{ level: number; visitors: string }>(
    `
      SELECT level, count() AS visitors
      FROM (
        SELECT
          coalesce(customer_id, anon_id) AS visitor,
          windowFunnel({window:UInt32})(toDateTime(timestamp), ${conditions}) AS level
        FROM ${TABLE}
        WHERE merchant_id = {merchantId:String}
          AND timestamp >= {from:DateTime64(3, 'UTC')}
          AND timestamp <  {to:DateTime64(3, 'UTC')}
          AND visitor != ''
        GROUP BY visitor
      )
      GROUP BY level
    `,
    params,
  )

  // levelHistogram[k] = visitors whose deepest completed level == k
  const maxLevel = steps.length
  const histogram = new Array<number>(maxLevel + 1).fill(0)
  for (const r of rows) {
    const lvl = Number(r.level)
    if (lvl >= 0 && lvl <= maxLevel) histogram[lvl] = Number(r.visitors)
  }
  // reached[i] = visitors with deepest level >= (i+1) = sum(histogram[i+1..maxLevel])
  const reached = new Array<number>(maxLevel).fill(0)
  for (let i = 0; i < maxLevel; i++) {
    let sum = 0
    for (let k = i + 1; k <= maxLevel; k++) sum += histogram[k]!
    reached[i] = sum
  }
  return reached
}
