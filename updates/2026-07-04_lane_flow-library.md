# Update: Pre-Built Flow Library (50+ flows)

**Date:** 2026-07-04
**Phase:** 6 | **Milestone:** 6.5 (flow-library half — guide §7.6) | **Lane:** flows (`lane/flows`)
**Author:** Claude Code (Session)

## What Was Built

A one-click **Pre-Built Flow Library**: 52 system-owned `FlowTemplate` rows across the guide's
categories, a browse/preview UI, and a "Use this flow" action that instantiates a real, editable
merchant Journey. The whole feature builds on the already-merged journey engine and channels — it
adds **no** schema and does **not** touch the journey executor or the visual builder internals.

**How instantiation works (reuses the existing graph-save path, never rebuilds the executor):**
Each template's `graphJson` is `{ trigger, nodes }` where `nodes` is exactly the visual builder's
`GraphNode` shape (`apps/api/src/routes/journeys/schema.ts`). "Use this flow" creates a DRAFT
`Journey` from `trigger` (stamping `Journey.sourceFlowTemplateKey` for provenance), then deep-copies
the nodes into `journey_steps` by calling the builder's own `saveJourneyGraph()`. The result is a
DRAFT journey the merchant edits in the existing builder and activates — the live executor runs it
unchanged. Every template graph is authored to the executor's step-config contract
(`ActionStepConfig` `{channel,content}`, `DelayStepConfig` `{duration,unit}`, `ConditionStepConfig`
`{field,operator,value}` with children labeled `true`/`false`), so every flow is immediately runnable.

**The 52 flows** (idempotent `upsert`-by-`key`, seeded into every DB):
abandoned_cart 9 · welcome 7 · post_purchase 12 · win_back 8 · loyalty_vip 7 · cod 9 — covering
abandoned cart/checkout (email/WhatsApp-first/COD/high-value/browse/SMS/push variants), welcome
series, post-purchase (confirmation, review requests, cross-sell, complete-the-look, replenishment/
restock, loyalty points, COD thank-you, return empathy), win-back (30/60/90-day, escalating,
high-value personal, churn-risk), loyalty & VIP (tier upgrade, birthday, points expiry, early access,
champion, anniversary, referral), and COD-specific (WhatsApp/SMS+IVR verification, prepaid
conversion, post-rejection win-back, fake-order-score review, address/pre-delivery confirmation).
They use WhatsApp, Email, SMS and Push — the channels now live in the merged codebase.

**Browse UI (design system, monochrome):** `/flows` groups templates by category with cards
(channels, step summary); `/flows/:key` previews the trigger + full step graph (branches rendered as
indented If-yes / If-no columns) and has a **Use this flow** button that instantiates the journey and
redirects into the visual builder at `/journeys/builder/:id`. The Flows nav entry's `soon` flag is
flipped off.

## Files Created / Modified

**Owned (new):**
- `packages/db/prisma/flow-templates.seed.ts` — graph-builder DSL (`msg`/`wait`/`branch` →
  GraphNode tree) + all 52 flow definitions + idempotent `seedFlowTemplates(prisma)` (also runnable
  standalone). Guards against duplicate keys.
- `apps/api/src/services/flow-library/index.ts` — `listFlowTemplates`, `getFlowTemplate`,
  `instantiateFlowTemplate` (reuses `saveJourneyGraph`), `FlowTemplateNotFoundError`.
- `apps/api/src/routes/flow-library/{index,controller,schema}.ts` — `GET /api/v1/flow-library`,
  `GET /api/v1/flow-library/:key`, `POST /api/v1/flow-library/:key/use` (authenticate +
  `journeys:read`/`journeys:write` gate; POST sub-path before the `:key` wildcard).
- `apps/api/src/services/flow-library/graph-contract.test.ts` — 4 tests locking the invariant that
  seeder-shaped graphs pass the builder's `validateGraph` and condition heads are `true`/`false`.
- `apps/web/app/routes/flows._index.tsx` — category browse.
- `apps/web/app/routes/flows.$key.tsx` — graph preview + "Use this flow" action.

**Append-only (tagged `// lane:flows`):**
- `packages/shared/src/types.ts` + `index.ts` — `FlowCategory`, `FLOW_CATEGORIES`,
  `FlowTemplateNode/Trigger/Graph`, `FlowTemplateDTO`, `FlowInstantiationResult`.
- `apps/api/src/index.ts` — import + register `flowLibraryRoutes` at `/api/v1/flow-library`.
- `apps/web/app/components/shell/nav.ts` — flip Flows `soon: true` → shipped.
- `packages/db/prisma/seed.ts` — import + one `await seedFlowTemplates(prisma)` call so flows land in
  every `db:seed`.

**Not touched:** `schema.prisma` / `migrations/` (the `FlowTemplate` model + `Journey.
sourceFlowTemplateKey` were already frozen in freeze-v2), the journey executor, and the visual
builder internals.

## Decisions Made This Session

- **`graphJson` shape = `{ trigger, nodes }`** with `nodes` identical to the builder's `GraphNode`,
  so instantiation round-trips through the existing `saveJourneyGraph` with zero adapter code.
- **CONDITION branches are terminal in a chain and always have both `true` and `false` heads.** A
  one-sided condition would mis-route a false result to `children[0]` in the executor; the DSL's
  `branch()` requires both branches to be non-empty.
- **`instantiateFlowTemplate` creates the Journey row directly then calls `saveJourneyGraph`** rather
  than reusing `createJourney` (which does not set `sourceFlowTemplateKey`). Both paths write the same
  step shape; this keeps provenance without editing the journeys lane's files.
- **Flow templates are system rows (`isSystem`/`isActive`), not tenant-scoped** — the browse/preview
  reads carry no merchant data, so they are intentionally not merchant-filtered. Only `/use` is
  tenant-scoped (creates the journey under `request.user.merchantId`).
- **Copy contains `{{variable}}` placeholders** (e.g. `{{first_name}}`, `{{discount_code}}`) matching
  the existing campaign seed convention; substitution is the channel layer's concern.

## Deviations from Roadmap

None. This is the flow-library half of 6.5; on-site personalization (the other half) shipped in the
`lane/onsite` Wave-2A merge.

## Known Issues Left Open

- **Trigger event names are conventions, not a registered catalog.** Templates use `custom_event`
  triggers like `checkout_abandoned`, `order_delivered`, `cod_order_placed`. These are sensible names
  the merchant can rewire in the builder, but there is no central registry mapping them to actual
  emitted events yet — some (e.g. `order_placed`) are live; others (`cod_delivered`, `customer_
  birthday`) will need producers wired before those flows fire automatically.
- **Condition fields are illustrative.** High-value/churn/fake-order branches use real profile fields
  from `FIELD_REGISTRY` (so they evaluate correctly), but "high-value cart" approximates cart value
  via `average_order_value` since cart total lives in the trigger payload, not the customer profile.
- **`.env` local URL stubs:** to boot the API for the smoke test I set valid local URLs for three
  unrelated vars (`TWILIO_STATUS_CALLBACK_URL`, `PK_SMS_API_URL`, `PUBLIC_BASE_URL`) whose
  `.env.example` placeholders were empty and failed Zod `url()`. `.env` is gitignored; the integrator
  may want to fix the `.env.example` placeholders for those (owned by sms/public-api lanes).

## Verification

- `scripts/preflight.sh` **green**: full build, all typechecks, **453 api tests pass** (449 + 4 new),
  `prisma migrate status` = up to date (no drift).
- **Boot smoke-test** (the gap preflight doesn't cover): API booted on :4012, `/health`=200.
  End-to-end over HTTP with a real JWT: list=200 (52 templates), preview=200, `POST …/use`=201
  (created a DRAFT journey, 6 steps copied, `sourceFlowTemplateKey` stamped), unknown key=404, no
  token=401. Runtime-verified a branching flow instantiates to a valid single-root tree with
  condition children labeled `false`/`true`. Test journeys cleaned up afterward.
- No browser verification (per CLAUDE.md, that is Abdullah's step). Health URL: `http://localhost:4012/health`.

## What to Do Next

Lane is ready for integration (no merge performed — integrator merges per ORCHESTRATION §9). After
merge, the highest-value follow-up is a small **trigger-event registry** so `custom_event` templates
map to real emitted events, and (optional) an AI-copywriter hook on flow steps for localized copy.
