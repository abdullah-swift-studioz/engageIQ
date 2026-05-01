# Phase 2 — Milestone 2.2: Webhook Processing Pipeline

**Date:** 2026-04-28
**Status:** Complete

## What Was Built

### Files Created

- `packages/db/prisma/migrations/20260428100000_add_orders_checkouts/migration.sql` — adds `orders` and `abandoned_checkouts` tables
- `apps/api/src/processors/utils.ts` — shared helpers: `normalizePhone` (E.164), `parseTags`, `detectCod`
- `apps/api/src/processors/customer.processor.ts` — handles `customers/create` and `customers/update`: upserts customer, normalizes phone, extracts city/province from default_address
- `apps/api/src/processors/order.processor.ts` — handles `orders/create`, `orders/updated`, `orders/paid`: upserts Order record, upserts CodOrder for COD orders, recalculates customer aggregates from DB
- `apps/api/src/processors/checkout.processor.ts` — handles `checkouts/create` and `checkouts/update`: upserts AbandonedCheckout, resolves customer by Shopify ID → email fallback
- `apps/api/src/processors/product.processor.ts` — handles `products/update` and `inventory_levels/update`: caches in Redis (24h TTL, keys `product:{merchantId}:{id}` and `inventory:{merchantId}:{itemId}:{locationId}`)
- `apps/api/src/processors/refund.processor.ts` — handles `refunds/create`: accumulates refundedAmount on the Order record, updates financialStatus to `refunded` or `partially_refunded`, recalculates customer aggregates
- `apps/api/src/workers/webhook.worker.ts` — BullMQ Worker on `webhook-ingestion` queue; dispatches by topic; marks `TypeError`/`SyntaxError` as `UnrecoverableError` (no retry for malformed payloads); concurrency = 10
- `apps/api/src/worker.ts` — standalone worker process entry point; graceful SIGTERM/SIGINT shutdown

### Files Modified

- `packages/db/prisma/schema.prisma` — added `Order` and `AbandonedCheckout` models; added `orders` and `abandonedCheckouts` relations to `Merchant` and `Customer`
- `packages/shared/src/types.ts` — added Shopify payload types: `ShopifyCustomerPayload`, `ShopifyOrderPayload`, `ShopifyCheckoutPayload`, `ShopifyRefundPayload`, `ShopifyProductPayload`, `ShopifyInventoryPayload`, `ShopifyLineItem`, `ShopifyProductVariant`, `ShopifyAddress`
- `packages/shared/src/index.ts` — exported all new Shopify payload types
- `apps/api/package.json` — added `worker`, `worker:dev`, `start:worker` scripts; added `bullmq` and `@prisma/client` as direct dependencies

### Packages Added

- `bullmq@^5.7.0` to `@engageiq/api` — BullMQ Worker class
- `@prisma/client@^5.22.0` to `@engageiq/api` — needed for `Prisma.DbNull` / `Prisma.InputJsonValue` on nullable JSON fields

## Decisions Made

| Decision | Rationale |
|---|---|
| Add `Order` + `AbandonedCheckout` tables (schema deviation from Phase 1.2) | Phase 1.2 roadmap omitted an orders table but "upsert order + update customer aggregates" in 2.2 requires it; customer aggregates can't be derived from `cod_orders` alone |
| Customer aggregates recalculated from DB on every order event (not incremented) | Avoids counter drift on updates/cancellations/refunds; aggregate query is fast with the `customer_id` index |
| Product/inventory cached in Redis, not PostgreSQL | No downstream Phase 2–3 feature queries product catalog from Postgres; Redis serves the SDK and campaign personalization (Phase 6) with lower latency |
| `detectCod` also covers `gateway === 'manual' && financial_status === 'pending'` | Some Pakistani merchants configure manual payment type for COD; pure gateway check would miss these |
| `UnrecoverableError` for TypeError/SyntaxError in worker | Malformed Shopify payloads won't self-heal on retry; saves queue depth and processing budget |
| Worker runs as a separate process (`apps/api/src/worker.ts`) | Clean separation between HTTP server and queue consumer; can be scaled independently; separate Docker image in production |
| `Prisma.DbNull` for null `shippingAddress` | Prisma 5 removed `null` from `InputJsonValue` for nullable JSON fields; `DbNull` = SQL NULL (correct semantics — no address) vs `JsonNull` = JSON `"null"` value |

## Known Issues / Deviations

- No `Order` model was in the Phase 1.2 schema; this migration adds it. The migration is safe to run on a fresh DB (Phase 1 already has the tables it depends on).
- `AbandonedCheckout.recoveredAt` is set by the checkout processor when a checkout is updated and a `recovered_order_id` is present — Shopify sends this in `checkouts/update` after the checkout converts. The field will remain NULL until Phase 6 (Journey execution) sets it, or until the webhook payload provides it.
- Product catalog cache is Redis-only. A full `products` PostgreSQL table for SKU-level retention analytics is deferred to Phase 4.5 (Product-Level Retention Analytics).
- Customer language preference is not yet set by the webhook processor (requires Shopify metafield access, not in standard webhook payloads). Deferred to Phase 3.

## Next Milestone

2.3 — Historical Backfill
