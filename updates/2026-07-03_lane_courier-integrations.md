# Update: Courier Integrations (Lane 7 / Platform 8.1)

**Date:** 2026-07-03
**Phase:** Wave 2 | **Milestone:** 8.1 Courier Integrations (canonical roadmap) / Feature Guide §9.2 + §10.2 | **Lane:** courier (`lane/courier`, worktree `../engageiq-courier`)
**Author:** Claude Code (Session — "LANE 7 — Courier Integrations")

## What Was Built

A complete courier-integration slice built against the FROZEN freeze-v2 schema
(`CourierShipment`, `CourierEvent`, `Courier` enum, `ShipmentStatus` enum,
`MerchantIntegration`). No schema or migration changes — `db:migrate:deploy` only.

**Provider abstraction + four adapters.** A `CourierAdapter` contract
(`services/couriers/types.ts`) with one adapter each for **PostEx, Leopards, TCS, M&P**,
each pulling delivery status / COD collection / return data over native `fetch` and
NORMALIZING to `NormalizedTracking`. Per-courier status vocabularies map to the
`ShipmentStatus` enum via `status-map.ts` (per-courier tables + keyword heuristic +
`null` fallback). Credentials come per-merchant from `MerchantIntegration.credentials`,
**encrypted at rest** (AES-256-GCM, `credentials.ts`) — absent key or integration →
the adapter is never called and the sync layer no-ops with a clear status.

**Sync engine (`sync.service.ts`).** `pollShipment(merchantId, shipmentId)`: tenant-scoped
load → skip terminal / untracked / unconfigured → adapter fetch → append `CourierEvent`
rows (deduped by `externalId`, else status+time) and advance `CourierShipment` **atomically**.
On a **delivered/returned transition** it syncs the linked `CodOrder.status`, recomputes the
customer's **COD acceptance/return rate** (`recalculateCodProfile`), and fires the
**post-delivery / return journey trigger** (`checkJourneyEntry('order_delivered' | 'order_returned')`).
Idempotent (events dedup; transitions run at most once). `enqueueSweep()` fans active
shipments out into per-shipment poll jobs.

**Worker + queue.** `courier-poll.worker.ts` consumes the new `courier-poll` queue
(handles `poll` + `sweep` jobs); retryable failures (5xx/429/network) throw for BullMQ
backoff, everything else resolves cleanly. A repeatable global sweep scheduler is gated by
`COURIER_POLL_ENABLED`.

**Routes (`/api/v1/couriers`).** `GET/POST /shipments`, `GET /shipments/:id` (with event
timeline), `POST /shipments/:id/sync` (poll now), `POST /sync` (merchant sweep),
`GET /integrations` + `PUT /integrations/:provider` (upsert creds — **encrypted, secrets
never returned**; fails closed 503 without an encryption key). `POST /shipments` normalizes
a free-text courier string → the `Courier` enum. All tenant-scoped, standard envelope.

**Web UI (design system, strict monochrome).** `shipments._index.tsx` (StatCards +
filterable Table + Sync-all) and `shipments.$id.tsx` (overview + tracking timeline), built
entirely from `~/components/ui`. State shown via icon+shade+weight, never hue. Added a
Shipments nav entry.

## Files Created / Modified

Owned (new):
- `apps/api/src/services/couriers/` — `types.ts`, `status-map.ts`, `credentials.ts`,
  `adapter-util.ts`, `postex.adapter.ts`, `leopards.adapter.ts`, `tcs.adapter.ts`,
  `mp.adapter.ts`, `registry.ts`, `sync.service.ts`, `ingest.service.ts`
  + tests: `status-map.test.ts`, `adapters.test.ts`, `credentials.test.ts`, `sync.service.test.ts`
- `apps/api/src/routes/couriers/` — `index.ts`, `controller.ts`, `service.ts`, `schema.ts`
- `apps/api/src/workers/courier-poll.worker.ts`
- `apps/web/app/routes/shipments._index.tsx`, `apps/web/app/routes/shipments.$id.tsx`
- `apps/web/app/lib/courier-format.ts`

Shared — APPEND-ONLY, tagged `// lane:courier`:
- `packages/shared/src/env.ts` — `COURIER_CREDENTIALS_KEY`, `COURIER_POLL_CRON`, `COURIER_POLL_ENABLED`
- `packages/shared/src/types.ts` — `CourierSweepJob`, `CourierJob` union
- `packages/shared/src/index.ts` — barrel re-exports
- `packages/queue/src/queues.ts` — `courierPollQueue` + `'courier-poll'` QueueName member
- `packages/queue/src/index.ts` — queue re-export
- `apps/api/src/worker.ts` — worker instantiation + handlers + shutdown + scheduler gate
- `apps/api/src/index.ts` — `app.register(couriersRoutes, { prefix: '/api/v1/couriers' })`
- `apps/web/app/components/shell/nav.ts` — Shipments nav entry
- `.env.example` — courier vars

## Decisions Made This Session
- **`CodOrder.courier` stays `String`; app normalizes to the `Courier` enum** when creating
  shipments (`normalizeCourierString`), honoring the freeze-v2 decision (legacy rows).
- **COD rate flows through `CodOrder.status`**: a courier delivered/returned transition sets
  the linked `CodOrder.status`, then `recalculateCodProfile` derives acceptance/return rate —
  one source of truth, no parallel counter.
- **Encryption in-app (AES-256-GCM), not KMS yet.** `MerchantIntegration.credentials` stored
  as `{ enc }`. Fails closed without `COURIER_CREDENTIALS_KEY` (no plaintext ever). KMS is a
  later infra swap behind `credentials.ts`.
- **New `CourierSweepJob` on the existing `courier-poll` queue** (frozen `CourierPollJob` is
  per-shipment) — appended to shared rather than touching the freeze-v2 block.
- **Reused `Route` icon** for the Shipments nav entry (no shipping icon in the design system;
  avoided editing the design lane's `icons.tsx`).

## Deviations from Roadmap
- None. Built canonical 8.1 against the frozen schema.

## Known Issues Left Open
- **Transition side-effects are at-most-once** (recalc + journey trigger run after the status
  commit; a crash in between is not replayed since the shipment is then terminal). `checkJourneyEntry`
  is itself idempotent, so the practical risk is a missed post-delivery message on a hard crash.
- **Courier API request/response shapes are best-effort** (documented endpoints; no live creds
  to validate against). Adapters parse defensively and no-op cleanly when unconfigured; real
  merchant credentials will confirm field names. Adjusting a field is a one-line adapter change.
- **`OTHER` courier has no adapter** (by design) — such shipments are tracked manually.
- **No shipment auto-creation from order ingestion yet** — shipments are registered via
  `POST /shipments` (or `registerShipment`); wiring a Shopify fulfillment/tracking webhook to
  auto-create them is a follow-up.

## Verification
- `scripts/preflight.sh` green on a fresh `engageiq_courier` DB: full build, typecheck,
  **212 api tests pass** (183 baseline + 29 new courier tests), `prisma migrate status` clean.
- Live boot on :4007, `/health` = 200. Smoke-tested end to end: register shipment (courier
  string normalized → POSTEX), list + stats, sync (clean skip when unconfigured), integration
  upsert **fails closed 503 without a key** and **stores `{enc}` (0 plaintext rows) with the key**,
  secret never echoed, unauth → 401.

## What to Do Next
Lane is preflight-green on `lane/courier`, committed, **not merged**. Integrator: rebase on
`main`, run preflight, `git merge --no-ff lane/courier`, then update `memory/context.md`.
Next courier follow-up: auto-create shipments from Shopify fulfillment/tracking webhooks.
