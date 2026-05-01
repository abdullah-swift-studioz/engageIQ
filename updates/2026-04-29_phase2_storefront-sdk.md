# Phase 2 — Milestone 2.4: Storefront Event Tracking SDK

**Date:** 2026-04-29
**Status:** Complete

## What Was Built

### New Package: `packages/sdk/`

- `src/index.ts` — TypeScript SDK source (IIFE, browser-compatible)
- `build.mjs` — esbuild build script; outputs `dist/engageiq.min.js`
- Built output: **5.13 KB unminified → 2.2 KB gzipped** (target: <5KB gzipped ✓)

**Tracked events (all 13 from spec):**

| Event | How detected |
|---|---|
| `page_view` | On init |
| `product_view` | `ShopifyAnalytics.meta.product` presence |
| `collection_view` | `ShopifyAnalytics.meta.page.pageType === 'collection'` |
| `search_query` | URL path `/search` + query param `q` |
| `add_to_cart` | `form[action*="/cart/add"]` submit + AJAX button click listeners |
| `remove_from_cart` | Cart form input change to 0 |
| `cart_view` | URL path `/cart` |
| `checkout_started` | Checkout button click |
| `checkout_step` | `page:load` event on `/checkout` |
| `product_image_zoom` | Click on `.product__media` / product media containers |
| `scroll_depth` | Scroll events at 25/50/75/100% thresholds |
| `time_on_page` | `pagehide` event, seconds elapsed |
| `exit_intent` | `mouseleave` with `clientY <= 0` (desktop only) |

**Identity stitching:**
- Anonymous visitors get `_eiq_anon` first-party cookie (UUID, 365-day expiry)
- Session ID in `sessionStorage` (`_eiq_sess`)
- `window.Shopify.customer.id` auto-detected → `identify()` called on init for logged-in customers
- Public `window.EngageIQ.identify({ email?, phone?, shopify_customer_id? })` for manual linking
- `data-merchant-id` + `data-api-base` on `<script>` tag for auto-init (captures `currentScript` synchronously before DOMContentLoaded)

### New API Routes

- `GET /sdk.js` — Serves pre-built SDK file from `packages/sdk/dist/engageiq.min.js`; `Cache-Control: public, max-age=3600`; CORS `*`
- `POST /v1/sdk/events` — Batch event ingestion (up to 50 events per call); unauthenticated; rate-limited 300 req/min per IP; writes to ClickHouse; updates `customer.lastSeenAt` for known customers (non-blocking)
- `POST /v1/sdk/identify` — Links `anon_id` to a customer; calls `stitchIdentity()`; rate-limited 200 req/min per IP
- `OPTIONS /v1/sdk/events` + `OPTIONS /v1/sdk/identify` — CORS preflight handlers (called cross-origin from storefront)

### New Service: `apps/api/src/services/identity.service.ts`

`stitchIdentity(payload)`:
1. Looks up customer in order: `shopify_customer_id` → `email` → normalized phone
2. If found: appends `anon_id` to `customer.anonIds[]` (Postgres array) if not already present; updates `lastSeenAt`
3. If NOT found + email/phone provided: creates a **stub customer** so SDK events can be attributed before the Shopify webhook arrives
4. Phone normalisation for Pakistani numbers: `03001234567` → `+923001234567`; also handles `923...` and `+923...` forms

### Database Migration

`20260429100000_add_anon_ids_to_customers`:
- `ALTER TABLE customers ADD COLUMN anon_ids TEXT[] NOT NULL DEFAULT '{}'`
- `CREATE INDEX customers_anon_ids_idx USING GIN` for fast `@>` containment queries

### App Embed Block Extension Stub

`extensions/app-embed-block/`:
- `blocks/engageiq-sdk.liquid` — Liquid template that injects `<script src=".../sdk.js" data-merchant-id="..." data-api-base="..." async defer>` into `<head>` of all storefront pages
- `shopify.extension.toml` — Extension manifest (type: theme, target: head)
- Merchant enables via Shopify Theme Editor → Customize → App Embeds (no theme file editing)

### Modified Files

- `packages/db/prisma/schema.prisma` — Added `anonIds String[] @default([])` to `Customer` model
- `packages/shared/src/types.ts` — Added `SdkEventPayload`, `SdkEventBatch`, `SdkIdentifyPayload`
- `packages/shared/src/index.ts` — Exported new SDK types
- `apps/api/src/index.ts` — Registered `sdkRoutes`; updated CORS config to allow cross-origin for SDK endpoints
- `turbo.json` — Added `@engageiq/sdk#build` task; `@engageiq/api#build` depends on it

## Decisions Made

| Decision | Rationale |
|---|---|
| IIFE format (not ESM) | Must work as a browser `<script>` tag without a bundler; IIFE is universally compatible |
| esbuild (not Rollup/Webpack) | Minimal config, fastest build, consistent with monorepo tooling philosophy |
| `sendBeacon` for `time_on_page` / `pagehide` | Page unload event is unreliable with `fetch`; `sendBeacon` guarantees delivery on navigation |
| Batch events (up to 10, 3s debounce) | Reduces HTTP requests from ~13 per page to 1–2; `keepalive: true` on fetch handles tab close |
| `stitchIdentity` creates stub customers | Ensures SDK events from email-captured visitors (popup, newsletter) are attributed before the Shopify webhook arrives; stub merges cleanly when webhook arrives |
| GIN index on `anon_ids` | Array containment (`@>`) queries require GIN; needed for "find customer by anon_id" reverse lookup in Phase 3 identity resolution |
| `currentScript` captured synchronously | `document.currentScript` is null after script execution ends; must capture it at IIFE start before DOMContentLoaded fires |
| CORS `*` on SDK endpoints | SDK is called cross-origin from any `*.myshopify.com` or custom domain; can't enumerate all domains; endpoints are rate-limited and data doesn't require auth |

## Known Issues / Deviations

- `checkout_step` tracking uses Shopify's `page:load` custom event — this fires on standard Online Store 2.0 themes but may not fire on headless Shopify implementations
- `add_to_cart` AJAX listener covers common Shopify theme patterns (`[name="add"]`, `[data-action="add-to-cart"]`) but theme-specific custom button classes may require merchant configuration
- The SDK file is served directly by the API at `/sdk.js`. In production, this should be fronted by a CDN (CloudFront) with longer cache TTLs; the API route is a correct fallback for simple deployments
- `wishlist_add` from the spec is not auto-tracked — Shopify doesn't have a native wishlist; this requires a specific wishlist app integration (deferred to Phase 6 on-site personalization)
- Identity stitching stub customer `email` uniqueness: if two anonymous visitors provide the same email for the same merchant before the webhook arrives, the second create will fail on the `@@unique([merchantId, email])` constraint. The catch in `stitchIdentity` would silently return `null`. This is a known edge case deferred to Phase 3 full identity resolution.

## Next Milestone

3.1 — Profile Aggregation & Real-Time Updates (Phase 3)
