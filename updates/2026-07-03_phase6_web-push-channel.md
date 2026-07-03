# Update: Web Push Channel

**Date:** 2026-07-03
**Phase:** 6 (Campaign & Automation Engine) | **Milestone:** Web Push channel (freeze-v2 push seam) | **Lane:** push (`lane/push`)
**Author:** Claude Code (Session)

## What Was Built

A self-hosted **Web Push Protocol** channel end to end, behind the frozen `ChannelAdapter`
contract and the freeze-v2 `PushSubscription` / `Customer.isSubscribedPush` / `PushSendJob`
schema (no schema changes made — the lane consumed the frozen tables).

**Delivery engine (shared core).** `services/push/dispatch.ts#sendPushToCustomer()` loads a
customer's active `PushSubscription` rows, fans out one send per subscription via the
`PushAdapter` (which wraps the `web-push` library), prunes any subscription the push service
reports Gone (HTTP 404/410), and writes ONE `Message` audit row per logical send (SENT if
≥1 device received it, else FAILED; `toPhone: ''` sentinel; push render fields in
`Message.metadata`). Consent (`isSubscribedPush`) is enforced here. Push sends are terminal
(no BullMQ retry) so a partial fan-out never re-notifies delivered devices.

**Two entry points, one core:**
- **Dedicated `push-send` queue + worker** (`workers/push-send.worker.ts`) consumes the
  frozen `PushSendJob` (title/body/url/icon + optional `pushSubscriptionId`). This is the
  richest path and is used by the authenticated test route and any future direct trigger.
- **`message-dispatch` PUSH branch** (a ~9-line `// lane:push` append in Lane A's worker):
  journey/campaign ACTION sends with `channel: PUSH` now deliver inline through the shared
  core, mapping `content.subject → title` and preserving `campaignId`/`journeyEnrollmentId`
  attribution + the existing `CampaignRecipient` flip. Previously PUSH was skipped as a stub.

**PushAdapter** (`lib/channels/push.adapter.ts`) implements `ChannelAdapter`: VAPID keys are
read from env; absent → clean non-retryable `{ ok:false, errorTitle:'Push not configured' }`
(the app boots credential-free). Maps 404/410 → `errorCode:'GONE'` (prune), 429/5xx + network
→ retryable, other 4xx → permanent.

**HTTP surface** (`routes/push/`, mounted at `/api/v1/push`):
- `GET /vapid-public-key` (public) — SDK fetches this to subscribe.
- `POST /subscribe` (public, storefront) — resolves the subscriber to a customer (explicit
  `customer_id` → by `anon_id` → else creates an anon stub customer, mirroring the SDK
  identity-stitch pattern), then upserts the `PushSubscription` by `(merchantId, endpoint)`.
- `POST /unsubscribe` (public) — deactivates by endpoint.
- `GET /eiq-sw.js` (public) — serves the built service worker (dev/same-origin only).
- `POST /test` (JWT) — enqueues a `PushSendJob` for operator testing (tenant-scoped).

**Storefront SDK** (`packages/sdk`): added `EngageIQ.subscribePush()` (registers the SW,
requests permission, fetches the VAPID key, subscribes via `PushManager`, POSTs to
`/subscribe`) and a `service-worker.ts` (renders `push` notifications, routes
`notificationclick` to the target URL). `build.mjs` now emits `dist/eiq-sw.js` alongside the
tracking SDK.

## Files Created / Modified

**Created (owned):**
- `apps/api/src/lib/channels/push.adapter.ts` — PushAdapter (web-push, ChannelAdapter)
- `apps/api/src/lib/channels/push.adapter.test.ts` — 6 tests
- `apps/api/src/services/push/vapid.ts` — VAPID config gate (`ensureVapidConfigured`, `getVapidPublicKey`)
- `apps/api/src/services/push/subscription.service.ts` — resolve/create customer, upsert/prune/deactivate subs
- `apps/api/src/services/push/dispatch.ts` — `sendPushToCustomer` core + `dispatchPushForMessageJob` bridge
- `apps/api/src/services/push/dispatch.test.ts` — 6 tests
- `apps/api/src/workers/push-send.worker.ts` — consumes the frozen `push-send` queue
- `apps/api/src/routes/push/{index.ts,schema.ts}` — the push HTTP surface
- `packages/sdk/src/service-worker.ts` — Web Push service worker

**Appended (shared, `// lane:push` tagged):**
- `packages/shared/src/types.ts` — `ChannelSendPayload` PUSH arm + `WebPushSubscription`/`PushNotification`
- `packages/shared/src/index.ts` — barrel exports for the two new types
- `packages/shared/src/env.ts` — `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
- `packages/queue/src/queues.ts` + `index.ts` — `pushSendQueue` + `'push-send'` QueueName
- `apps/api/src/worker.ts` — push-send worker instantiation + handlers + shutdown
- `apps/api/src/index.ts` — `pushRoutes` registration at `/api/v1/push`
- `apps/api/src/workers/message-dispatch.worker.ts` — PUSH routing branch
- `apps/api/package.json` — `web-push` + `@types/web-push` deps
- `.env.example` — VAPID block

## Decisions Made This Session

- **Reconciled "flow through message-dispatch" with the frozen dedicated `push-send` seam.**
  freeze-v2 froze a richer `PushSendJob`/`push-send` queue than `message-dispatch`'s
  `{body, subject?}` content can express. Rather than pick one, both funnel through a single
  `sendPushToCustomer()` core: `push-send` for direct/rich sends, and a minimal
  `message-dispatch` PUSH branch (inline, to preserve campaign/journey attribution) so
  journey/campaign PUSH actions deliver.
- **One `Message` row per logical send** (not per subscription) — avoids the `providerMessageId`
  `@unique` collision (web push has no message id; `providerMessageId` left null) and keeps the
  message log readable. Fan-out counts live in `Message.metadata`.
- **Anon push subscribers get a stub customer** (PushSubscription.customerId is non-null) — the
  stub merges cleanly later via `mergeCustomers` anonIds union.
- **Push sends are terminal (attempts:1)** — a partial fan-out must not re-run and re-notify.

## Deviations from Roadmap

- The task brief said "sends flow through message-dispatch (channel PUSH)"; the actual
  implementation ALSO uses the freeze-v2 `push-send` queue/worker as the primary engine (both
  share one core). This honors the frozen contract while still satisfying message-dispatch
  routing. Documented above.

## Known Issues Left Open

- **Service-worker origin constraint:** a SW only controls the origin it is served from, so in
  production `eiq-sw.js` must be hosted on the storefront domain (e.g. a Shopify app proxy).
  The API `/eiq-sw.js` route is for local/same-origin testing only.
- **No web dashboard page for push** (subscription counts / push message log). Push messages
  DO appear in the existing `/api/v1/messages` log (channel=PUSH). A dedicated UI is deferred.
- **`message-dispatch` PUSH title** is derived from `content.subject` (falls back to "New
  notification"); URL/icon aren't in `MessageDispatchJob` so journey/campaign pushes have no
  deep-link/icon. Direct `push-send` jobs carry the full title/body/url/icon.
- **End-to-end delivery** couldn't be verified headlessly (needs a real browser subscription +
  push service). Adapter/dispatch logic is unit-tested; boot + routes verified live.

## What to Do Next

Lane is preflight-green (frozen install, full build, typecheck, 195 api tests) and boot-verified
(`/health`=200, `/api/v1/push/vapid-public-key` returns the key, worker starts clean). Ready for
the integrator to rebase on `main` and merge (do NOT self-merge). No schema/migration changes.
