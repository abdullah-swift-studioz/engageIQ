# Update: Campaign Engine — One-Time Blasts

**Date:** 2026-06-28
**Phase:** 6 | **Milestone:** 6.1 (campaign side — one-time blasts to a segment) | **Lane:** B Campaigns (`lane/campaigns`)
**Author:** Claude Code (Session — "EngageIQ Instance 5")

## What Was Built

The campaign engine for one-time blasts to a segment: campaign CRUD + scheduling
routes, the `campaign-send` worker (the queue existed with no consumer until now),
and the campaign dashboard UI. Sends are dispatched through the Phase-0 frozen
`MessageDispatchJob` / `MESSAGE_DISPATCH` contract — this lane is a *producer* of
that queue; Lane A (Channels) owns the consumer that performs the real
ChannelAdapter send. Built and unit-tested against that interface with a mocked
dispatch; integrates after Channels lands.

**Send flow (campaign-send worker, `processCampaignSendJob`):**
1. Load the campaign (merchant-scoped). No-op if status ∉ {SCHEDULED, SENDING}
   (so a cancelled/sent/duplicate job never re-sends).
2. Materialize recipients: customers who are **active members** of the target
   segment (`segmentMemberships.some({ segmentId, exitedAt: null })`), not merged
   (`mergedIntoId: null`), not blocked, and **opted in to the channel** with the
   contact field that channel needs (WhatsApp/SMS → `isSubscribedWhatsapp/Sms` +
   `phone`; Email → `isSubscribedEmail` + `email`; Push → no gate).
3. Create `CampaignRecipient` rows idempotently (`createMany` + `skipDuplicates`,
   relying on `@@unique([campaignId, customerId])`).
4. Fan out one `MessageDispatchJob` per still-`PENDING` recipient, tagged with
   `campaignId` + `campaignRecipientId` for attribution, with dispatch `jobId =
   cr_<recipientId>` so the message-dispatch queue dedupes a re-run.
5. Mark the campaign `SENT` with `sentAt` and `recipientCount`.

**Scheduling:** `POST /:id/send` with no `sendAt` sends immediately; a future
`sendAt` enqueues a BullMQ **delayed** job (`jobId = campaignId`). Re-scheduling
removes the prior delayed job first. `POST /:id/cancel` removes the job and sets
`CANCELLED`. State machine enforced in the service: only DRAFT/SCHEDULED are
editable/sendable; SENDING can't be deleted; only SCHEDULED/PAUSED can be cancelled.

**Idempotency:** campaign-send `jobId = campaignId`; per-recipient dispatch
`jobId = cr_<recipientId>`; recipient rows unique on (campaignId, customerId);
worker re-dispatches only `PENDING` recipients (Lane A flips PENDING → SENT).

**Tests:** 26 new Vitest tests (116 total api tests passing) — worker happy path,
per-channel suppression/eligibility, idempotency (PENDING-only, CANCELLED/SENT
no-op), invalid-campaign guards; service state-transition guards.

## Files Created / Modified

**Owned (created):**
- `apps/api/src/workers/campaign-send.worker.ts` — `processCampaignSendJob` (pure,
  testable), `createCampaignSendWorker()`, injectable `DispatchMessageFn` seam +
  default producer bound to the frozen `MESSAGE_DISPATCH` queue name.
- `apps/api/src/workers/campaign-send.worker.test.ts` — 11 worker tests.
- `apps/api/src/routes/campaigns/{schema,service,controller,index}.ts` — CRUD +
  `/:id/send` + `/:id/cancel`, merchant-scoped, standard response envelope.
- `apps/api/src/routes/campaigns/service.test.ts` — 15 service-guard tests.
- `apps/web/app/routes/campaigns._index.tsx` — campaign list.
- `apps/web/app/routes/campaigns.new.tsx` — create form (channel + segment picker).
- `apps/web/app/routes/campaigns.$id.tsx` — detail + send/schedule/cancel/delete.

**Shared (append-only `// lane:campaigns` blocks):**
- `packages/shared/src/types.ts` — `CAMPAIGN_SEND` const + `CampaignSendJob` type.
- `packages/shared/src/index.ts` — barrel re-exports for the above.
- `apps/api/src/worker.ts` — wired the campaign-send worker + handlers + shutdown.
- `apps/api/src/index.ts` — registered campaign routes at `/api/v1/campaigns`.

**Not committed:** `.env` (gitignored) — set to lane B values (PORT 4011, WEB_PORT
4010, API_URL http://localhost:4011, REDIS_URL …/2, DATABASE_URL …/engageiq_campaigns).

## Decisions Made This Session

- **A↔B seam = `MessageDispatchJob` on the frozen `MESSAGE_DISPATCH` queue**, not the
  current 4-arg `dispatchChannel` stub (which carries no campaign attribution). The
  worker takes an **injectable** dispatch fn (default = a thin producer that lazily
  constructs `new Queue(MESSAGE_DISPATCH, { connection: redisConnection })`). I did
  **not** touch `lib/channels/dispatcher.ts` or add `messageDispatchQueue` to
  `queues.ts` (Lane A owns both). A second `Queue` instance bound to the same name is
  the standard BullMQ producer pattern and coexists safely; the integrator may swap
  the default for Lane A's exported handle with no behaviour change.
- **Targeting via active segment memberships** (not re-evaluating the condition tree
  at send time) — the `segment-evaluate` worker keeps memberships fresh; this keeps
  the send path simple and fast and respects soft-deleted (`exitedAt`) exits.
- **Channel suppression at fan-out** — only eligible/opted-in customers get a
  `CampaignRecipient`; `recipientCount` reflects the eligible set.
- **Campaign content** stored as `content.body` (JSON) + top-level `subject` column;
  the dispatch job carries `{ body, subject? }` (Lane A resolves toPhone/toEmail from
  `customerId`).

## Deviations from Roadmap

- None. Scope is exactly 6.1's campaign side (one-time blasts). Journey-side 6.x is a
  separate lane.

## Known Issues Left Open

- **Integrates after Channels (Lane A).** Until Lane A's `message-dispatch` consumer
  exists, dispatched jobs accumulate on the queue unconsumed and recipients stay
  `PENDING`. End-to-end send is only exercisable post-integration. (Worker is fully
  unit-tested against the mocked contract now.)
- **Recipient status transition (PENDING → SENT/FAILED) is owned by Lane A.** Campaign
  delivery counters (`deliveredCount`, etc.) likewise update from Lane A's status
  webhooks; this lane only sets `recipientCount` + `SENT`.
- **No per-merchant send rate limiting yet** (designed, not built — shared gap).
- **Prisma CLI doesn't auto-load the root `.env`** in this worktree (no
  `packages/db/.env`); migrate/seed/generate were run with `DATABASE_URL` exported
  inline. `scripts/preflight.sh`'s `prisma migrate status` step likewise needs
  `DATABASE_URL` in the environment. Not lane-specific; flagging for the integrator.

## What to Do Next

Lane B is ready. **Integrator:** merge **after Lane A (Channels)**. At integration,
optionally repoint `defaultDispatch` in `campaign-send.worker.ts` at Lane A's
exported `messageDispatchQueue` handle (behaviour-neutral), and confirm Lane A's
message-dispatch worker reads `campaignId`/`campaignRecipientId` and flips
`CampaignRecipient` PENDING → SENT/FAILED + stamps `messageId`. Then mark roadmap 6.1
(campaign side) complete in `context.md`.
