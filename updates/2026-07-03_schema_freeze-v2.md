# Update: Schema Freeze v2 — all remaining Wave-2 tables

**Date:** 2026-07-03
**Phase:** Enabling work (2nd schema freeze — NOT a roadmap milestone) | **Lane:** none (sole instance / schema owner, branch `schema/freeze-v2`)
**Author:** Claude Code (Session — "INSTANCE F1 — Schema Freeze v2")

## What Was Built

The one-time **second schema freeze** that adds every remaining table/enum/column for **all of Wave 2** in a single migration, so the 12+ Wave-2 feature lanes (email 6.4, on-site 6.5, flow library 6.5, COD verify 6.4/7.4, two-way WhatsApp 7.2, web push, courier 8.1, public API + outbound webhooks 8.2, agency 8.3, AI copywriter 7.4) never touch `schema.prisma` again. Tables/enums/columns/job-payload-types only — **no feature logic**.

One migration `20260703103912_freeze_v2_wave2_tables`: **17 new models + 8 new enums + additive columns on 6 existing models**. Verified to apply cleanly from scratch (fresh temp DB: all 10 migrations apply, 37 tables, both raw indexes present) and incrementally on the live `engageiq` dev DB, then re-seeded (idempotent).

**8 new enums:** `Courier` (POSTEX/LEOPARDS/TCS/MP/**OTHER**), `VerificationChannel`, `VerificationStatus`, `OnSiteElementType` (POPUP/STICKY_BAR/**EMBED**), `AbTestStatus`, `AbTestEntityType`, `ShipmentStatus`, `WhatsAppConversationState`.

**17 new models:** `EmailTemplate`, `EmailSuppression`, `SendingDomain`, `AbTest`, `OnSiteElement`, `VerificationAttempt`, `WhatsAppConversation`, `FlowTemplate` (system/global), `PushSubscription`, `CourierShipment`, `CourierEvent`, `OutboundWebhook`, `WebhookDelivery`, `AgencyAssignment` (cross-merchant), `MerchantIntegration`, `MerchantSettings`, `AiGeneration`. (Total now 37 models.)

**Existing-table additive columns:** `Customer` (+nextBestAction, +isSubscribedPush), `Message` (+toEmail/subject/bodyHtml/emailTemplateId/openedAt/clickedAt/metadata, +emailTemplateId index; `toPhone` kept required — email/push reuse the `''` sentinel), `Journey` (+sourceFlowTemplateKey), `CampaignRecipient` (+abVariantId), `ApiKey` (+scopes), `Merchant` (+billing: subscriptionStatus/shopifyChargeId/trialEndsAt/currentPeriodEnd/priceOverride). Plus ~20 back-relations wired onto Merchant/User/Customer/Order/CodOrder/Segment/JourneyEnrollment/Message.

**Requested enum change was a NO-OP:** `CampaignRecipientStatus` already contained `DELIVERED`+`READ` (added in the phase-0 freeze). No migration action.

**Tenant safety:** every new merchant table carries a direct `merchantId` + FK `onDelete: Cascade` + `@@index([merchantId])`, *including* log-children (`VerificationAttempt`, `CourierEvent`, `WebhookDelivery`) — stronger than the SegmentMembership parent-only pattern, matching Message/CampaignRecipient. Two deliberate exceptions: `FlowTemplate` (system/global reference data) and `AgencyAssignment` (cross-merchant bridge; tenant key = `agencyMerchantId`).

**Two hand-authored raw-SQL indexes in the migration** (Prisma can't express either): the preserved `customers_anon_ids_idx` GIN index (the auto-emitted `DROP INDEX` line was removed) and a new partial-unique `whatsapp_conversations_open_phone_key` = `UNIQUE (merchant_id, phone) WHERE state='OPEN'` (one open conversation per phone for deterministic inbound routing).

**Shared job payloads (`packages/shared`)** appended in a `// freeze-v2` block, pure additions, string-literal unions only (shared stays a dependency-free leaf): `VerificationJob` + `COD_VERIFICATION`, `PushSendJob` + `PUSH_SEND`, `CourierPollJob` + `COURIER_POLL`, `WebhookDeliveryJob` + `WEBHOOK_DELIVERY`.

## Files Created / Modified
- `packages/db/prisma/schema.prisma` — 8 enums, 17 models, additive columns + back-relations
- `packages/db/prisma/migrations/20260703103912_freeze_v2_wave2_tables/migration.sql` — the freeze migration (GIN `DROP INDEX` removed; partial-unique hand-added)
- `packages/shared/src/types.ts` — `// freeze-v2` job-payload block
- `packages/shared/src/index.ts` — barrel re-exports for the above
- `.env` — created for this checkout from `.env.example` (JWT secrets ≥32 chars; empty `SENTRY_DSN` commented out). Gitignored, not staged.

## Decisions Made This Session (via adversarial 6-lens review + user approval)
- **MerchantSettings added** — per-merchant tunable config (COD-verify windows/reminders/auto-cancel, fake-order thresholds, attribution windows, email defaults, white-label branding) had no home; would have forced 3 lanes to edit schema. Grouped `Json?` columns.
- **MerchantIntegration promoted to required** (was optional) — per-merchant WhatsApp/courier/SMS/SES creds; `externalId` + `@@unique([provider, externalId])` for inbound-webhook→merchant routing. `credentials Json` must be encrypted at rest (app-layer/KMS).
- **User overrides:** billing fields on Merchant = **include now**; FlowTemplate = **system-only** (no merchantId); OnSiteElementType = **+EMBED**; AI copywriter = **AiGeneration table added** (open-rate learning loop + Anthropic token cost trail).
- **Courier enum +OTHER** and **ShipmentStatus +ATTEMPTED/+RETURN_IN_TRANSIT** so new couriers / attempt-failed events don't force a future migration. `CodOrder.courier` stays `String` (existing free-string rows can't be safely converted); app normalizes to the `Courier` enum when creating `CourierShipment` rows.
- **AbTest.entityType** and **WhatsAppConversation.state** made enums (closed discriminants); other status/type fields (EmailTemplate/SendingDomain/OnSiteElement status, FlowTemplate.category, MerchantIntegration.provider, contextType) kept `String` because those taxonomies genuinely grow (String avoids a migration per new value).
- **`Message.toPhone` kept required** (not widened to nullable) — verified the merged channels code and its tests don't break; email/push reuse the existing `toPhone: ''` inbound sentinel.

## Deviations from Roadmap
- None to the roadmap. Enabling work, not a roadmap milestone — no milestone row marked complete.
- Added three tables beyond the requested list (MerchantSettings, MerchantIntegration promoted, AiGeneration) and EmailSuppression, all to honor the hard rule "no lane touches schema.prisma again."

## Known Issues Left Open (all app-code, not schema)
- **Every PLACEHOLDER column has no producer yet** — filled by its Wave-2 lane. Notable secret columns: `MerchantIntegration.credentials` and `OutboundWebhook.secret` must be **encrypted at rest** by their lane (app-layer/KMS); the schema comments flag this. No real secret is stored.
- **GIN + partial-unique raw indexes recur** — every future `prisma migrate dev` will re-emit `DROP INDEX customers_anon_ids_idx` **and** now also `DROP INDEX whatsapp_conversations_open_phone_key` (both live only in raw SQL). Delete those DROP lines from any new migration before applying. A permanent fix (guarded re-create / preview feature) is still worth doing.
- **CampaignRecipient DELIVERED/READ propagation** and **refund `returns_data` population** remain the same app-code follow-ups noted in the phase-0 freeze (unaffected here).

## What to Do Next
Freeze v2 is complete on branch `schema/freeze-v2`, preflight-green, `/health`=200. **Integrator (Abdullah): merge `schema/freeze-v2` into `main`, then update `memory/context.md`** (schema now 37 models / 26 enums; freeze v2 recorded) per the single-writer rule. After merge, Wave-2 lanes branch from the new `main` and apply migrations with `db:migrate:deploy` only — **no lane runs `prisma migrate dev` or edits `schema.prisma`.**
