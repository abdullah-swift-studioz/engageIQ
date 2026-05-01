# Phase 2 — Milestone 2.1: Shopify App Setup & OAuth

**Date:** 2026-04-28
**Status:** Complete

## What Was Built

### Files Created
- `apps/api/src/services/shopify.service.ts` — Pure functions: `buildInstallUrl`, `exchangeCodeForToken`, `registerWebhooks`, `validateHmac`, `validateWebhookHmac`
- `apps/api/src/routes/shopify.ts` — Fastify plugin with 4 routes: `/install`, `/callback`, `/webhooks/:topic`, `/app-embed`
- `packages/db/prisma/migrations/20260428000000_add_shopify_fields/migration.sql` — ALTER TABLE to add `shopify_scope`, `shopify_installed_at`, `shopify_uninstalled_at`

### Files Modified
- `packages/shared/src/env.ts` — Promoted `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES` from optional to required (`z.string().min(1)`); added `SHOPIFY_APP_URL` (`z.string().url()`)
- `packages/shared/src/types.ts` — Added `ShopifyWebhookJob` interface
- `packages/shared/src/index.ts` — Exported `ShopifyWebhookJob`
- `packages/db/prisma/schema.prisma` — Added `shopifyScope`, `shopifyInstalledAt`, `shopifyUninstalledAt` to `Merchant` model
- `apps/api/src/index.ts` — Registered `fastify-raw-body` (global: false, encoding: false) and `shopifyRoutes`
- `.env.example` — Added `SHOPIFY_APP_URL` placeholder and improved Shopify section comments

### Packages Added
- `fastify-raw-body@^4.2.1` to `@engageiq/api` — raw body access for webhook HMAC validation
- `zod` to `@engageiq/api` — explicit dep for route-level input validation

## Decisions Made

| Decision | Rationale |
|---|---|
| No Shopify SDK — use Node.js `crypto` + native `fetch` | Zero extra deps; Node 18+ has global fetch; keeps the service layer thin and easy to test |
| `fastify-raw-body` with `encoding: false` + `global: false` | Buffer needed for HMAC; `global: false` saves memory — only the webhook endpoint opts in via `config: { rawBody: true }` |
| OAuth state stored in Redis with 10min TTL | Standard CSRF protection for OAuth; Redis already in the stack; one-time use (deleted after lookup) |
| `registerWebhooks` uses `Promise.allSettled` and throws on any failure | All 10 topics must be registered — partial success is not acceptable; errors are aggregated into a single throw |
| Merchant upsert keyed on `shopifyDomain` | The domain is the stable identity before we have a Shopify shop ID; consistent with existing schema unique constraint |
| Webhook route returns 200 immediately, enqueues to BullMQ | Shopify requires a fast HTTP response; actual processing happens in the worker (Milestone 2.2) |
| Webhook job `jobId` set to `shopifyWebhookId` | BullMQ deduplicates by `jobId` — prevents duplicate processing when Shopify retries a webhook |

## Known Issues / Deviations

- `SHOPIFY_APP_URL` and `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` are now **required** env vars — the app will exit at startup if they are not set. Add stub values to `.env` for local dev without a live Shopify store.
- Creating the actual Shopify Partner Dashboard app is a manual step — code is ready for credentials to be plugged in.
- `registerWebhooks` uses Shopify Admin REST API `2024-01` version pin — upgrade to a newer API version when needed.
- The `/dashboard` redirect target from the OAuth callback is a stub — no dashboard route exists yet.
- App Embed Block (`/app-embed`) is a stub returning `{ status: 'ok', version: '1.0.0', sdk: 'pending' }` — full implementation is Milestone 2.4.

## Next Milestone

2.2 — Webhook Processing Pipeline
