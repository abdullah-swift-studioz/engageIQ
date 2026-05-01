/**
 * verify-clickhouse.ts
 *
 * Milestone 1.3 — ClickHouse round-trip verification script.
 * Run via: pnpm --filter @engageiq/db run ch:setup
 */

import { randomUUID } from 'crypto'
import {
  pingClickHouse,
  createEventsTable,
  createMaterializedViews,
  insertEvent,
  queryEvents,
  getEventCountsByType,
  getActiveVisitorCount,
  getRevenueByDay,
} from '../src/clickhouse.js'

const MERCHANT_ID = 'verify-merchant-001'

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  console.log('=== EngageIQ ClickHouse Verification (Milestone 1.3) ===\n')

  // ── 1. Ping ──────────────────────────────────────────────────────────────
  console.log('[1/7] Pinging ClickHouse...')
  const alive = await pingClickHouse()
  if (!alive) {
    throw new Error('ClickHouse is not reachable — is Docker running?')
  }
  console.log('      OK — ClickHouse is up\n')

  // ── 2. Create table ───────────────────────────────────────────────────────
  console.log('[2/7] Creating engageiq.events table (IF NOT EXISTS)...')
  await createEventsTable()
  console.log('      OK — table ready\n')

  // ── 3. Create materialized views ──────────────────────────────────────────
  console.log('[3/7] Creating materialized views (IF NOT EXISTS)...')
  await createMaterializedViews()
  console.log('      OK — MVs ready\n')

  // ── 4. Insert test events ─────────────────────────────────────────────────
  console.log('[4/7] Inserting 3 test events...')

  const now = new Date()

  // Use waitForInsert: true so events are visible immediately for the read-back check.
  await insertEvent(
    {
      event_id: randomUUID(),
      merchant_id: MERCHANT_ID,
      customer_id: null,
      anon_id: 'anon_abc123',
      event_type: 'page_view',
      properties: { path: '/collections/all', referrer: 'google.com' },
      session_id: 'sess_001',
      page_url: 'https://store.example.com/collections/all',
      ip: '203.0.113.1',
      user_agent: 'Mozilla/5.0',
      timestamp: new Date(now.getTime() - 5_000),
    },
    { waitForInsert: true },
  )

  await insertEvent(
    {
      event_id: randomUUID(),
      merchant_id: MERCHANT_ID,
      customer_id: 'cust_xyz789',
      anon_id: null,
      event_type: 'product_view',
      properties: { product_id: 'prod_123', product_name: 'Lawn Suit', price: 2500 },
      session_id: 'sess_002',
      page_url: 'https://store.example.com/products/lawn-suit',
      ip: '203.0.113.2',
      user_agent: 'Mozilla/5.0',
      timestamp: new Date(now.getTime() - 3_000),
    },
    { waitForInsert: true },
  )

  await insertEvent(
    {
      event_id: randomUUID(),
      merchant_id: MERCHANT_ID,
      customer_id: 'cust_xyz789',
      anon_id: null,
      event_type: 'purchase',
      properties: { revenue: 1500, currency: 'PKR', product_id: 'prod_123' },
      session_id: 'sess_002',
      page_url: 'https://store.example.com/checkout/thank-you',
      ip: '203.0.113.2',
      user_agent: 'Mozilla/5.0',
      timestamp: new Date(now.getTime() - 1_000),
    },
    { waitForInsert: true },
  )

  console.log('      OK — 3 events inserted\n')

  // ── 5. Wait for async inserts ─────────────────────────────────────────────
  // async_insert flushes when the buffer is full or after ~200ms; wait longer
  // to be safe on a fresh server with a small buffer.
  console.log('[5/7] Waiting 5 s for async inserts to flush...')
  await wait(5_000)
  console.log('      OK\n')

  // ── 6. Query events ───────────────────────────────────────────────────────
  console.log('[6/7] Querying events...')

  const events = await queryEvents(MERCHANT_ID, { limit: 50 })
  // Filter to only this run's events (inserted in the last 30 s)
  const recent = events.filter(
    (e) => e.timestamp.getTime() > now.getTime() - 30_000,
  )
  console.log(`      queryEvents()       → ${recent.length} events found`)
  if (recent.length < 3) {
    console.warn(`      WARNING: expected 3 recent events, got ${recent.length}`)
    console.warn('      (async_insert may still be flushing — re-run in a moment)')
  }

  const counts = await getEventCountsByType(
    MERCHANT_ID,
    new Date(now.getTime() - 60_000),
    new Date(now.getTime() + 60_000),
  )
  console.log('      getEventCountsByType() →', counts)

  const visitors = await getActiveVisitorCount(MERCHANT_ID, 30)
  console.log(`      getActiveVisitorCount() → ${visitors} distinct visitor(s)`)

  const revenue = await getRevenueByDay(
    MERCHANT_ID,
    new Date(now.getTime() - 86_400_000),
    new Date(now.getTime() + 86_400_000),
  )
  console.log('      getRevenueByDay()       →', revenue)

  console.log()

  // ── 7. Assertions ─────────────────────────────────────────────────────────
  console.log('[7/7] Running assertions...')

  if (recent.length < 3) {
    throw new Error(
      `Round-trip FAILED: expected ≥3 recent events, got ${recent.length}. ` +
      'ClickHouse async_insert may not have flushed yet — retry in a few seconds.',
    )
  }

  const hasPageView = recent.some((e) => e.event_type === 'page_view')
  const hasPurchase = recent.some((e) => e.event_type === 'purchase')

  if (!hasPageView) throw new Error('Assertion FAILED: no page_view event found')
  if (!hasPurchase) throw new Error('Assertion FAILED: no purchase event found')

  const purchaseRevenue = revenue.reduce((sum, r) => sum + r.revenue, 0)
  if (purchaseRevenue < 1500) {
    throw new Error(
      `Assertion FAILED: expected revenue ≥ 1500 PKR, got ${purchaseRevenue}`,
    )
  }

  console.log('      All assertions passed\n')
  console.log('=== Milestone 1.3 ClickHouse verification PASSED ===')
}

main().catch((err: unknown) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
