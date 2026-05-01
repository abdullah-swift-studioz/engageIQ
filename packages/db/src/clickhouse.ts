import { createClient } from '@clickhouse/client'
import { env } from '@engageiq/shared'

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const _client = createClient({
  url: env.CLICKHOUSE_URL,
  database: env.CLICKHOUSE_DATABASE,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 0,
  },
})

/** Raw client — for migration scripts and escape hatches only. */
export function getClickHouseClient() {
  return _client
}

/** Backwards-compatible named export used by existing code. */
export const clickhouse = _client

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngageIQEvent {
  event_id: string
  merchant_id: string
  customer_id: string | null
  anon_id: string | null
  event_type: string
  properties: Record<string, unknown>
  session_id: string | null
  page_url: string | null
  ip: string | null
  user_agent: string | null
  timestamp: Date
}

// Fully-qualified table name used in all queries.
const TABLE = 'engageiq.events'

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Returns true if ClickHouse is reachable. */
export async function pingClickHouse(): Promise<boolean> {
  try {
    // Use a default-database client to avoid "database does not exist" errors
    // before createEventsTable() has run.
    const pingClient = createClient({
      url: env.CLICKHOUSE_URL,
      database: 'default',
      username: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
    })
    const result = await pingClient.query({ query: 'SELECT 1', format: 'JSONEachRow' })
    await result.json()
    await pingClient.close()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Table / Schema management
// ---------------------------------------------------------------------------

export async function createEventsTable(): Promise<void> {
  // CREATE DATABASE must run against the 'default' database context because the
  // configured database ('engageiq') may not yet exist, which causes the HTTP
  // interface to reject the request before executing the query.
  const bootstrapClient = createClient({
    url: env.CLICKHOUSE_URL,
    database: 'default',
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
  })
  await bootstrapClient.exec({ query: `CREATE DATABASE IF NOT EXISTS engageiq` })
  await bootstrapClient.close()

  await _client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS engageiq.events (
        event_id     UUID,
        merchant_id  String,
        customer_id  Nullable(String),
        anon_id      Nullable(String),
        event_type   LowCardinality(String),
        properties   String,
        session_id   Nullable(String),
        page_url     Nullable(String),
        ip           Nullable(String),
        user_agent   Nullable(String),
        timestamp    DateTime64(3, 'UTC')
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (merchant_id, coalesce(customer_id, ''), timestamp)
      TTL toDateTime(timestamp) + INTERVAL 2 YEAR
      SETTINGS index_granularity = 8192
    `,
  })
}

export async function createMaterializedViews(): Promise<void> {
  // 1. Daily event counts by merchant + type
  // Backing AggregatingMergeTree table
  await _client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS engageiq.events_by_type_daily_agg (
        merchant_id  String,
        event_type   LowCardinality(String),
        date         Date,
        count        AggregateFunction(count)
      )
      ENGINE = AggregatingMergeTree()
      PARTITION BY toYYYYMM(date)
      ORDER BY (merchant_id, event_type, date)
    `,
  })

  await _client.exec({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS engageiq.events_by_type_daily
      TO engageiq.events_by_type_daily_agg
      AS
        SELECT
          merchant_id,
          event_type,
          toDate(timestamp)   AS date,
          countState()        AS count
        FROM engageiq.events
        GROUP BY merchant_id, event_type, date
    `,
  })

  // 2. Active visitors — daily distinct visitor counts per merchant
  // (simple daily MV; real-time window queries use getActiveVisitorCount() directly)
  await _client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS engageiq.active_visitors_daily_agg (
        merchant_id  String,
        date         Date,
        visitor_count UInt64
      )
      ENGINE = ReplacingMergeTree()
      PARTITION BY toYYYYMM(date)
      ORDER BY (merchant_id, date)
    `,
  })

  await _client.exec({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS engageiq.active_visitors_mv
      TO engageiq.active_visitors_daily_agg
      AS
        SELECT
          merchant_id,
          toDate(timestamp)                                          AS date,
          uniqExact(coalesce(customer_id, anon_id))                 AS visitor_count
        FROM engageiq.events
        GROUP BY merchant_id, date
    `,
  })
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** Insert a single event. */
export async function insertEvent(
  event: EngageIQEvent,
  options: { waitForInsert?: boolean } = {},
): Promise<void> {
  await _client.insert({
    table: TABLE,
    values: [serializeEvent(event)],
    format: 'JSONEachRow',
    clickhouse_settings: options.waitForInsert
      ? { async_insert: 1, wait_for_async_insert: 1 }
      : undefined,
  })
}

/** Batch-insert multiple events (more efficient for bulk loads). */
export async function insertEvents(
  events: EngageIQEvent[],
  options: { waitForInsert?: boolean } = {},
): Promise<void> {
  if (events.length === 0) return
  await _client.insert({
    table: TABLE,
    values: events.map(serializeEvent),
    format: 'JSONEachRow',
    clickhouse_settings: options.waitForInsert
      ? { async_insert: 1, wait_for_async_insert: 1 }
      : undefined,
  })
}

function serializeEvent(event: EngageIQEvent) {
  return {
    ...event,
    properties: JSON.stringify(event.properties),
    // ClickHouse DateTime64(3,'UTC') expects 'YYYY-MM-DD HH:MM:SS.mmm' (no Z suffix)
    timestamp: toClickHouseDateTime(event.timestamp),
  }
}

/**
 * Converts a JS Date to the ClickHouse DateTime64 string format:
 * 'YYYY-MM-DD HH:MM:SS.mmm'  (UTC, no trailing Z)
 */
function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

export async function queryEvents(
  merchantId: string,
  options: {
    customerId?: string
    eventType?: string
    from?: Date
    to?: Date
    limit?: number
  } = {},
): Promise<EngageIQEvent[]> {
  const { customerId, eventType, from, to, limit = 100 } = options

  const conditions: string[] = [`merchant_id = {merchantId:String}`]
  const params: Record<string, string | number> = { merchantId }

  if (customerId) {
    conditions.push(`customer_id = {customerId:String}`)
    params.customerId = customerId
  }
  if (eventType) {
    conditions.push(`event_type = {eventType:String}`)
    params.eventType = eventType
  }
  if (from) {
    conditions.push(`timestamp >= {from:DateTime64(3)}`)
    params.from = toClickHouseDateTime(from)
  }
  if (to) {
    conditions.push(`timestamp <= {to:DateTime64(3)}`)
    params.to = toClickHouseDateTime(to)
  }

  const result = await _client.query({
    query: `
      SELECT *
      FROM ${TABLE}
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { ...params, limit },
    format: 'JSONEachRow',
  })

  const rows = await result.json<{
    event_id: string
    merchant_id: string
    customer_id: string | null
    anon_id: string | null
    event_type: string
    properties: string
    session_id: string | null
    page_url: string | null
    ip: string | null
    user_agent: string | null
    timestamp: string
  }>()

  return rows.map((row) => ({
    ...row,
    properties: JSON.parse(row.properties) as Record<string, unknown>,
    // ClickHouse returns DateTime64 as 'YYYY-MM-DD HH:MM:SS.mmm' (no timezone suffix).
    // Append 'Z' to force UTC parsing, matching the stored UTC values.
    timestamp: new Date(row.timestamp.replace(' ', 'T') + 'Z'),
  }))
}

/** Returns event counts by type for a merchant in a date range, ordered by count desc. */
export async function getEventCountsByType(
  merchantId: string,
  from: Date,
  to: Date,
): Promise<{ event_type: string; count: number }[]> {
  const result = await _client.query({
    query: `
      SELECT
        event_type,
        count() AS count
      FROM ${TABLE}
      WHERE
        merchant_id = {merchantId:String}
        AND timestamp >= {from:DateTime64(3)}
        AND timestamp <= {to:DateTime64(3)}
      GROUP BY event_type
      ORDER BY count DESC
    `,
    query_params: {
      merchantId,
      from: toClickHouseDateTime(from),
      to: toClickHouseDateTime(to),
    },
    format: 'JSONEachRow',
  })

  const rows = await result.json<{ event_type: string; count: string }>()
  return rows.map((r) => ({ event_type: r.event_type, count: Number(r.count) }))
}

/** Counts distinct visitors (anon_id OR customer_id) in the last N minutes (default 30). */
export async function getActiveVisitorCount(
  merchantId: string,
  windowMinutes = 30,
): Promise<number> {
  const result = await _client.query({
    query: `
      SELECT uniqExact(coalesce(customer_id, anon_id)) AS visitor_count
      FROM ${TABLE}
      WHERE
        merchant_id  = {merchantId:String}
        AND timestamp >= now() - INTERVAL {windowMinutes:UInt32} MINUTE
    `,
    query_params: { merchantId, windowMinutes },
    format: 'JSONEachRow',
  })

  const rows = await result.json<{ visitor_count: string }>()
  return rows.length > 0 ? Number(rows[0]!.visitor_count) : 0
}

/**
 * Queries purchase events and extracts `properties.revenue`, grouped by day.
 * Returns rows ordered by date asc.
 */
export async function getRevenueByDay(
  merchantId: string,
  from: Date,
  to: Date,
): Promise<{ date: string; revenue: number }[]> {
  const result = await _client.query({
    query: `
      SELECT
        formatDateTime(toDate(timestamp), '%Y-%m-%d') AS date,
        sum(toFloat64OrZero(JSONExtractString(properties, 'revenue'))) AS revenue
      FROM ${TABLE}
      WHERE
        merchant_id = {merchantId:String}
        AND event_type = 'purchase'
        AND timestamp >= {from:DateTime64(3)}
        AND timestamp <= {to:DateTime64(3)}
      GROUP BY date
      ORDER BY date ASC
    `,
    query_params: {
      merchantId,
      from: toClickHouseDateTime(from),
      to: toClickHouseDateTime(to),
    },
    format: 'JSONEachRow',
  })

  const rows = await result.json<{ date: string; revenue: string }>()
  return rows.map((r) => ({ date: r.date, revenue: Number(r.revenue) }))
}
