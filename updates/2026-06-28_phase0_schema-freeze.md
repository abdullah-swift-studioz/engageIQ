# Update: Phase 0 — Schema Freeze, Channel Contract & Parallel-Work Tooling

**Date:** 2026-06-28
**Phase:** 0 (enabling work — NOT a roadmap milestone) | **Lane:** none (sole instance / schema owner)
**Author:** Claude Code (Session — "EngageIQ Instance 0")

## What Was Built

The one-time schema freeze that unblocks all Wave-1 lanes, plus the Wave-0 shared channel
contract and the parallel-work tooling. Everything is on `main` (commit `08d46a8`); no lanes were
running, so committing to main was safe. One migration was generated and verified to apply cleanly
from scratch.

**Schema (one migration `20260628172239_phase0_schema_freeze`): 7 new models + 6 new enums.**
- Models: `WhatsAppTemplate`, `Message`, `CampaignRecipient`, `Product`, `Recommendation`,
  `ModelRun`, `SavedView`. (Total now 18 models, 18 enums.)
- Enums: `MessageDirection`, `MessageStatus`, `TemplateStatus`, `TemplateCategory`,
  `CampaignRecipientStatus`, `RecommendationType`.
- `Customer`: added `@@index([merchantId, phone])` (WhatsApp inbound webhook hot path); corrected
  the `churn_score` comment from `0-1` to `0-100`. The `isSubscribedSms/Email/Whatsapp` flags
  already existed (no new opt-in columns were needed).
- `Order`: added `returns_data Json?` so Lane C can compute `Product.returnRate`.
- Back-relations added on `Merchant` / `Customer` / `Campaign` / `JourneyEnrollment`.

**Channel contract (`packages/shared`)** — the Wave-0 seam Lane A implements and Lane B consumes:
`ChannelAdapter`, `ChannelSendPayload` (channel-tagged union), `ChannelSendResult`,
`MessageDispatchJob` (with optional `campaignRecipientId`), `MESSAGE_DISPATCH`, `ChannelName`,
`TemplateCategory`, and a `CHURN_SCORE` constant (scale + bands). String-literal unions only, so
`@engageiq/shared` stays a dependency-free leaf (no `@prisma/client` import).

**Tooling:** `db:migrate:deploy` script in `packages/db/package.json`; `scripts/preflight.sh`
(executable) — the section-10 gate. Preflight is green end-to-end (build + typecheck + 90 api tests
+ clean migrate status).

## Files Created / Modified
- `packages/db/prisma/schema.prisma` — 7 models, 6 enums, 2 existing-table additions, back-relations
- `packages/db/prisma/migrations/20260628172239_phase0_schema_freeze/migration.sql` — the freeze migration
- `packages/shared/src/types.ts` — channel contract + `CHURN_SCORE`
- `packages/shared/src/index.ts` — barrel re-exports for the above
- `packages/db/package.json` — `db:migrate:deploy`
- `scripts/preflight.sh` — new, executable
- `apps/web/vite.config.ts` — added `~ -> ./app` resolve alias (pre-existing build fix, see below)

## Decisions Made This Session
- **`Product` table added** (per Abdullah) — unblocks 4.5 product analytics, 7.2 recommendations,
  and email dynamic blocks at once. Variants stored as `Json` (not a normalized table); no
  `Order -> Product` FK (analytics join via `lineItems.product_id` = `shopify_product_id`).
- **`CampaignRecipient` added** with `@@unique([campaignId, customerId])` for idempotent blasts;
  `messageId` FK only (no `providerMessageId` on the recipient — wamid lives on `Message`).
- **`SavedView`** (one generic `type/name/config` table) covers funnel + cohort persistence so
  Lane C never needs a mid-wave migration. Separate Funnel/Cohort tables and `CampaignAttribution`
  were intentionally NOT added (attribution computes on the fly from Message/Order/UTM).
- **`ModelRun` + `Recommendation`** added for Lane D auditability and the rec cache.
- **WhatsApp single-number env-based for Wave 1** — no per-merchant WhatsApp credential schema;
  deferred to a 2nd freeze before Wave 2. Lane F (courier/webhook) tables also deferred.
- **Adversarial review (5 lenses, 15 agents) fold-ins:** `campaignRecipientId` on
  `MessageDispatchJob`; `Order.returns_data`; churn scale pinned 0-100 + `CHURN_SCORE` const;
  dropped redundant `Message @@index([providerMessageId])`; `Customer @@index([merchantId, phone])`;
  `CampaignRecipient.customer onDelete: Cascade`.

## Deviations from Roadmap
- None to the roadmap itself. This is enabling work, not a roadmap milestone, so no milestone row
  was marked complete in `context.md`.

## Known Issues Left Open
- **Refund line-item data is not yet persisted.** `Order.returns_data` exists but
  `refund.processor.ts` still writes only `refundedAmount`. Until the processor populates
  `returns_data` (`[{product_id, line_item_id, quantity, subtotal}]`), `Product.returnRate` cannot
  be computed. App-code follow-up (not a schema change); pick up at the start of Lane C's wave.
- **GIN-index gotcha persists.** The `customers_anon_ids_idx` GIN index lives only in raw migration
  SQL (not expressible in the Prisma 5 model), so EVERY future `prisma migrate dev` will re-emit a
  `DROP INDEX customers_anon_ids_idx`. Reviewer/integrator must delete that line from any new
  migration (as done here and in commit 7552054). A permanent fix (Prisma `postgresqlExtensions` /
  raw index preview, or a guarded re-create) is worth doing in the 2nd freeze.
- **Deferred to 2nd freeze (pre-Wave-2):** `Message` email columns (`toEmail`/`subject`) for Email
  6.4; `ActionStepConfig.templateId` for journey-triggered template sends (needs Lane A<->E
  template-variable design — lanes can extend the leaf type by append meanwhile).

## What to Do Next
Phase 0 is complete and on `main`. **Next: create the Wave-1 lane worktrees** per ORCHESTRATION
section 6.2 (Lane A Channels, Lane C Analytics, Lane D ML, Lane E Journey Builder; Lane B Campaigns
builds against the now-frozen `ChannelAdapter`/`MessageDispatchJob` contract). Each lane: branch
from this `main`, `cp .env`, set its per-lane PORT/REDIS_URL/DATABASE_URL, `createdb`, then
`db:migrate:deploy` (apply only — never `migrate dev`) + `db:seed`.
