# Update: SMS Channel Adapter (Twilio + PK aggregator, failover)

**Date:** 2026-07-03
**Phase:** 6 | **Milestone:** 6.3 (SMS half) | **Lane:** SMS (`lane/sms`)
**Author:** Claude Code (Session)

## What Was Built

The SMS channel, previously a stub behind the frozen `ChannelAdapter` contract, is now a
real send path with provider failover, wired through the existing `message-dispatch`
pipeline, plus a Twilio-shaped delivery-status/opt-out webhook. No schema change and no
queue/worker-registry change were needed — the Wave-1 Channels lane already froze the
seam (`ChannelAdapter`, `message-dispatch` queue+worker, `registry.ts` SMS→smsAdapter
mapping, `Customer.isSubscribedSms`, `Message`/`MessageStatus`).

**Provider abstraction + failover.** `SmsAdapter.send()` resolves an ordered provider
chain and fails over across it: first success wins; on failure it tries the next
configured provider. If every provider fails and *any* failure was transient it returns
`retryable:true` (BullMQ retries the whole chain later); if all rejected permanently it
returns `retryable:false`. No providers configured → clean non-retryable
`"SMS not configured"` (mirrors the WhatsApp adapter). Primary is chosen by
`SMS_PRIMARY_PROVIDER` (default `twilio`), the other is the fallback.

- **Twilio provider** — native `fetch` + Basic auth to the 2010-04-01 Messages API;
  `To`/`Body` + `From` or `MessagingServiceSid`; optional `StatusCallback`. Maps
  429/5xx/network → retryable, 4xx → permanent. Returns the Twilio `sid`.
- **PK aggregator provider** — generic JSON POST (`{to,from,message}`, Bearer key) for a
  local PK gateway. Vendor still TBD (ORCHESTRATION §13 decision 5), so field names are
  the common shape and documented as adjust-on-vendor-pick. Ids are prefixed `pk_` so they
  never collide with Twilio sids in the `Message.providerMessageId @unique` column.

**Worker routing.** Added a `// lane:sms` branch in `message-dispatch.worker.ts` that
mirrors the WhatsApp flow: consent gate on `isSubscribedSms` → phone required →
per-merchant rate limit (re-enqueue with jitter over cap) → `adapter.send()` → persist a
`Message` (SENT + provider id | FAILED + error) → flip the originating `CampaignRecipient`
(SENT/FAILED/SKIPPED + `messageId`). SMS is free-form (`content.body`); no WhatsApp-template
FK is stamped. The branch returns before the existing stub-skip guard, which now only
catches EMAIL/PUSH.

**Delivery-status + opt-out webhook.** `POST /webhooks/sms` (Twilio-shaped), sharing the
`/webhooks` prefix with the WhatsApp webhook (distinct path, no collision). Verifies
`X-Twilio-Signature` (HMAC-SHA1 over url + sorted params) when `TWILIO_AUTH_TOKEN` is set;
parses the urlencoded body from `rawBody` (no global parser change). A status callback
advances `Message.status` **monotonically** (never regresses; FAILED terminal;
`undelivered`→FAILED), stamping the matching timestamp and capturing Twilio error
code/message. An inbound message with a STOP keyword (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/
QUIT) logs an INBOUND `Message` and flips `isSubscribedSms=false`. Always returns 200
(empty TwiML) so Twilio does not back off.

## Files Created / Modified

Owned (new):
- `apps/api/src/lib/channels/sms-providers/types.ts` — `SmsProvider` / `SmsProviderResult` contract
- `apps/api/src/lib/channels/sms-providers/twilio.ts` — Twilio provider
- `apps/api/src/lib/channels/sms-providers/pk-aggregator.ts` — generic PK aggregator provider
- `apps/api/src/lib/channels/sms-providers/index.ts` — ordered chain factory (`resolveProviderChain`)
- `apps/api/src/lib/channels/sms-providers/twilio.test.ts` — Twilio provider tests
- `apps/api/src/lib/channels/sms.adapter.test.ts` — adapter failover / not-configured tests
- `apps/api/src/routes/webhooks/sms.ts` — Twilio status + STOP webhook
- `apps/api/src/routes/webhooks/sms.test.ts` — signature / monotonic-status / STOP helper tests

Owned (rewritten):
- `apps/api/src/lib/channels/sms.adapter.ts` — stub → real adapter with failover

Shared (append-only `// lane:sms` blocks):
- `apps/api/src/workers/message-dispatch.worker.ts` — SMS routing branch
- `apps/api/src/index.ts` — register `smsWebhookRoutes` at `/webhooks`
- `packages/shared/src/env.ts` — `SMS_PRIMARY_PROVIDER`, `TWILIO_MESSAGING_SERVICE_SID`,
  `TWILIO_STATUS_CALLBACK_URL`, `PK_SMS_API_URL`, `PK_SMS_SENDER_ID`, `PUBLIC_BASE_URL`
- `.env.example` — same keys documented (and `.env` created for this lane; gitignored)

Not touched: `schema.prisma`/migrations, `whatsapp.adapter.ts`, `email.adapter.ts`,
`registry.ts` (needed no change — already maps SMS→smsAdapter), `queues.ts`, `worker.ts`.

## Decisions Made This Session

- **Failover semantics:** aggregate result across the chain — success short-circuits;
  all-fail is retryable iff any attempt was transient, else permanent. Keeps a Twilio
  outage from permanently failing a message the PK gateway could deliver.
- **PK aggregator is a generic shape, not a specific vendor** (ORCHESTRATION §13.5 still
  open). Documented in-file; only the provider needs editing when the vendor is chosen.
- **SMS templating is free-form** (`content.body`). The only template table
  (`WhatsAppTemplate`) is WhatsApp-specific; no SMS-template FK is stamped.
- **Webhook reuses the `/webhooks` prefix and the global rawBody plugin**; urlencoded is
  parsed in-handler to avoid touching the shared body-parser config.
- **Rate limit is the shared per-merchant window** (`checkRateLimit`) — SMS and WhatsApp
  currently share the `ratelimit:wa:*` key/cap. Acceptable for now; a per-channel cap is a
  future refinement if SMS throughput needs to diverge.

## Deviations from Roadmap

None. This is the SMS half of roadmap 6.3, deferred from the Wave-1 Channels lane.

## Known Issues Left Open

- **PK aggregator vendor unresolved** (ORCHESTRATION §13.5). Provider works against the
  common gateway JSON shape; confirm field names + auth once a vendor is picked.
- **Shared rate-limit key** (`ratelimit:wa:*`) counts SMS and WhatsApp together. Split per
  channel if independent caps are needed.
- **Inbound attribution by phone only** (no per-merchant sender routing in the frozen
  schema) — same documented limitation as the WhatsApp webhook.
- **Channels-lane test coupling (integrator note):** the existing
  `message-dispatch.worker.test.ts` case "skips non-WhatsApp channels without sending" now
  exercises the new SMS branch and passes because the mocked customer is not SMS-subscribed
  (hits the consent skip → SKIPPED). Still green (204/204). If Lane A later flips that mock
  to `isSubscribedSms:true`, that case would attempt a real SMS send and should be updated
  to use EMAIL/PUSH for the stub-skip assertion.

## What to Do Next

Integrator: rebase `lane/sms` on `main`, run `scripts/preflight.sh`, merge. Then the SMS
channel is live end-to-end via campaigns and journeys (set channel = SMS). Natural
follow-ups: wire SMS into the COD verification flow (feature-guide §7.4 Option B), and add
an SMS/message-log surface if desired (currently the WhatsApp message log covers all
channels via the shared `Message` table).

## Verification

`scripts/preflight.sh` green in `../engageiq-sms`: full build + `pnpm type-check` clean +
`pnpm --filter @engageiq/api test` = **204/204 passed (23 files)**, including the 3 new SMS
test files + `prisma migrate status` = "Database schema is up to date!" against
`engageiq_sms` (11 migrations applied). No browser verification (per CLAUDE.md).
