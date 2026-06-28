// Date-range helpers for the analytics engine.
//
// All persisted timestamps (ClickHouse `events.timestamp` DateTime64 UTC, Postgres
// `orders.placed_at`) are UTC. "Today / yesterday / same day last week" are business-day
// concepts that must be computed in the MERCHANT's timezone (default Asia/Karachi, UTC+5,
// no DST) and then expressed as UTC instants to query against. This module owns that
// conversion so every sub-area agrees on day boundaries.

import type { AnalyticsPeriodKey } from '@engageiq/shared'

export const DEFAULT_TZ = 'Asia/Karachi'

export interface DateRange {
  from: Date
  to: Date
}

/**
 * Offset (in minutes) of `timeZone` from UTC at the given instant.
 * Positive for zones ahead of UTC (Asia/Karachi → +300).
 */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  // `hour` can come back as "24" at midnight in some engines — normalize to 0.
  const hour = map.hour === '24' ? 0 : Number(map.hour)
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  )
  return Math.round((asUTC - date.getTime()) / 60000)
}

/** UTC instant of the most recent midnight in `timeZone` at/just-before `date`. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const offset = tzOffsetMinutes(date, timeZone)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  const wallMidnightAsUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 0, 0, 0)
  return new Date(wallMidnightAsUTC - offset * 60000)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/** [start-of-today, start-of-tomorrow) in the merchant timezone, as UTC instants. */
export function todayRange(now: Date, timeZone: string = DEFAULT_TZ): DateRange {
  const from = startOfZonedDay(now, timeZone)
  return { from, to: addDays(from, 1) }
}

export function yesterdayRange(now: Date, timeZone: string = DEFAULT_TZ): DateRange {
  const todayStart = startOfZonedDay(now, timeZone)
  return { from: addDays(todayStart, -1), to: todayStart }
}

/** The same weekday one week ago: [day-7, day-6). */
export function sameDayLastWeekRange(now: Date, timeZone: string = DEFAULT_TZ): DateRange {
  const todayStart = startOfZonedDay(now, timeZone)
  return { from: addDays(todayStart, -7), to: addDays(todayStart, -6) }
}

/**
 * Resolve a period key (or explicit custom range) to a concrete UTC [from, to).
 * `7d` / `30d` / `90d` are rolling windows ending at the start of tomorrow (so "today"
 * is fully included). `custom` requires `fromIso` and `toIso`.
 */
export function resolvePeriod(
  opts: { period?: AnalyticsPeriodKey; fromIso?: string; toIso?: string; now?: Date; timeZone?: string },
): DateRange {
  const now = opts.now ?? new Date()
  const tz = opts.timeZone ?? DEFAULT_TZ
  const period = opts.period ?? '30d'

  if (period === 'custom') {
    if (!opts.fromIso || !opts.toIso) {
      throw new Error('CUSTOM_RANGE_REQUIRES_FROM_AND_TO')
    }
    const from = new Date(opts.fromIso)
    const to = new Date(opts.toIso)
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error('INVALID_DATE_RANGE')
    if (from >= to) throw new Error('FROM_MUST_PRECEDE_TO')
    return { from, to }
  }

  const todayStart = startOfZonedDay(now, tz)
  const tomorrow = addDays(todayStart, 1)
  if (period === 'today') return { from: todayStart, to: tomorrow }

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
  return { from: addDays(tomorrow, -days), to: tomorrow }
}

/** ClickHouse DateTime64(3) param format: 'YYYY-MM-DD HH:MM:SS.mmm' (UTC, no trailing Z). */
export function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '')
}
