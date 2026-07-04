# Update: Lane 10 — AI Upgrades + Loose-End Wiring

**Date:** 2026-07-03
**Phase:** Wave 2 loose-ends (roadmap 4.5 / 5.3 / 6.1 / 7.2 / 7.3) | **Lane:** 10 — AI Upgrades + Wiring (`lane/ai-wiring`)
**Author:** Claude Code (Session — "LANE 10 — AI Upgrades + Loose-End Wiring")

## What Was Built

Six deferred wirings from the Wave-1 integration follow-up list (`memory/context.md`
"Known Issues / Blockers") were completed, turning existing-but-inert pieces into working
end-to-end flows. **No schema changes** — everything writes existing columns/tables.

1. **Real-time fake-order gating (7.3).** New `services/fake-order-gate.service.ts` scores a
   COD order inline (synchronously) at ingestion via the ML service, reads the merchant's
   thresholds from `MerchantSettings.fakeOrderThresholds` (defaults 40/70), and applies the
   gate: `PROCESS` (0–<verify) leaves `verificationStatus=UNVERIFIED`; `VERIFY`
   (verify–<hold) and `HOLD` (≥hold) set `verificationStatus=PENDING_VERIFICATION` (only
   advancing forward from UNVERIFIED). The `HOLD` band additionally stamps `held:true` in
   `CodOrder.fakeScoreDetails`. It rolls up `Customer.fakeOrderScore` (worst score). It
   **never** auto-cancels or sets `Customer.isBlocked` — a per-order signal must not nuke the
   customer. Wired into `order.processor.ts#processOrder` after aggregates recalc (so
   customer features are fresh), awaited but wrapped so an ML outage cannot drop the order
   (the nightly batch re-scores anything left unscored).
2. **Cluster → Segment promotion (5.3).** New route group `routes/clusters/`
   (`GET /api/v1/clusters`, `POST /api/v1/clusters/:runId/promote`) reads the latest
   `segment-discovery` `ModelRun` and one-click promotes a chosen cluster into a real
   **static** Segment (isDynamic=false, provenance in `conditions`, membership materialised
   from the cluster snapshot, re-validated against live tenant-owned non-merged customers).
   `scoring.worker.ts#runSegmentDiscovery` now stores per-cluster `customerIds` + a stable
   `index` in the run metadata (previously omitted, which made promotion impossible). Small
   Remix UI at `apps/web/app/routes/clusters.tsx` (`/clusters`).
3. **Churn threshold journey trigger.** `runChurn` now captures pre-update scores, resolves
   the merchant threshold (`MerchantSettings.extra.churnThreshold`, default = CHURN MEDIUM
   band = 50), and fires `checkJourneyEntry(customerId, merchantId, 'churn_risk', …)` for
   customers whose score crossed the threshold (below→above transition only, so a
   persistently-at-risk customer does not re-fire every run). Fire-and-forget; the journey's
   re-entry rule guards against duplicate active enrollments.
4. **CampaignRecipient DELIVERED/READ propagation.** Appended (`// lane:ai-wiring`) to the
   WhatsApp webhook `processStatuses`: when a Message advances to DELIVERED/READ (or a
   post-send FAILED), the linked `CampaignRecipient` (via `messageId @unique`) is advanced
   monotonically (SENT→DELIVERED→READ), terminal-safe (leaves FAILED/SKIPPED). Previously the
   recipient stopped at SENT. Kept strictly separate from inbound routing (lane
   wa-conversation).
5. **Refund `returns_data` population.** `order.processor.ts` now stores each line's Shopify
   `line_item_id` in `Order.lineItems`; `refund.processor.ts` maps a refund's
   `refund_line_items` (which carry only `line_item_id`) back to their `product_id` and
   appends `{product_id, line_item_id, quantity, subtotal}` to `Order.returnsData` — the exact
   shape `product-analytics.service.ts` consumes, so `Product.returnRate` now computes.
   Restock ($0) refunds still record returned units. Accumulates across separate refunds
   (each webhook processed once).
6. **LTV upgrade (7.2).** `apps/ml-service/app/models/ltv.py` replaced with a real
   **BG/NBD + Gamma-Gamma** model via the `lifetimes` package (fit across the scored
   population, applied per customer). `lifetimes` is imported **defensively** and the model
   falls back to the previous transparent numpy formula per-customer when: the package is
   absent, the population is too small (< 20 fittable), the fit raises, or the customer is
   ineligible (no age / no repeat history) — the graceful sparse-data path. Same
   `LtvCustomer/LtvScore` interface; no API change.

## Files Created / Modified

**Created (owned):**
- `apps/api/src/services/fake-order-gate.service.ts` (+ `fake-order-gate.test.ts`)
- `apps/api/src/routes/clusters/{index,controller,service,schema}.ts` (+ `service.test.ts`)
- `apps/api/src/processors/refund.processor.test.ts`
- `apps/api/src/routes/webhooks/whatsapp-recipient.test.ts` (own file; does not touch lane:channels' `whatsapp.test.ts`)
- `apps/web/app/routes/clusters.tsx`
- `apps/ml-service/tests/test_ltv_bgnbd.py`

**Modified (owned):**
- `apps/api/src/processors/order.processor.ts` — store `line_item_id`; call real-time fake-order gate for COD.
- `apps/api/src/processors/refund.processor.ts` — `buildReturnItems()` + `returnsData` population.
- `apps/api/src/workers/scoring.worker.ts` — churn threshold trigger (`resolveChurnThreshold`, `churnCrossings`); segment-discovery stores `customerIds`+`index`.
- `apps/api/src/workers/scoring.worker.test.ts` — mocks for merchantSettings + journey-entry; churn-trigger tests.
- `apps/ml-service/app/models/ltv.py` — BG/NBD + Gamma-Gamma with fallback.
- `apps/ml-service/requirements.txt` — add `lifetimes>=0.11` (optional at runtime).

**Modified (append-only `// lane:ai-wiring` blocks):**
- `apps/api/src/routes/webhooks/whatsapp.ts` — DELIVERED/READ/FAILED → CampaignRecipient (`propagateCampaignRecipient`) + one tagged call inside `processStatuses`.
- `apps/api/src/index.ts` — import + register `clustersRoutes` at `/api/v1/clusters`.

**Local-only (gitignored, not committed):** `.env`, `packages/db/.env` (lane DB URL for Prisma CLI), `apps/ml-service/.venv`.

## Decisions Made This Session (all confirmed with Abdullah before build)
- **HOLD maps to `PENDING_VERIFICATION` + `{held:true}`** in `fakeScoreDetails`. No auto-cancel, no `Customer.isBlocked` from a single order.
- **LTV uses the `lifetimes` package** (not a hand-rolled BG/NBD) with the numpy fallback preserved as the sparse-data / no-dependency path.
- **Churn threshold** default = CHURN `MEDIUM` band (50), merchant-overridable via `MerchantSettings.extra.churnThreshold` (no dedicated column exists in the frozen schema; `extra` is the catch-all).
- **Promoted clusters become STATIC segments** (point-in-time snapshot) — k-means clusters are not stable across runs, so materialising exact members is the honest semantic.
- **`runSegmentDiscovery` now stores `customerIds`** in `ModelRun.metadata` (the Wave-1 ML lane omitted them "to keep the row small", which blocked promotion). Bounded by the merchant's scored-buyer count.
- **DELIVERED/READ propagation also handles post-send FAILED** (delivery failure after SEND) — a natural extension of the same seam; still monotonic/terminal-safe.

## Deviations from Roadmap
- None. This is Wave-2 loose-end wiring against the frozen schema; no roadmap milestone row is marked complete by this lane.

## Known Issues Left Open
- **Fake-order gate is inline-awaited on the webhook path.** If the ML service is slow, it adds up to `ML_SERVICE_TIMEOUT_MS` to COD-order webhook processing (bounded, and failures are swallowed). If this becomes a throughput concern, move it to a dedicated queue.
- **`addressDuplicationCount` still 0** in fake-order features (needs a cross-account address index — unchanged from the ML lane's note).
- **No dedicated `churnThreshold`/COD-verification worker.** The gate sets `verificationStatus=PENDING_VERIFICATION`; the actual COD-verification flow is the Wave-2 COD-verify lane's to build. Churn `churn_risk` journeys enroll but a merchant must have an ACTIVE journey with `triggerType='churn_risk'`.
- **Cluster promotion stores customerIds in ModelRun.metadata** — for very large merchants this row can grow; acceptable for now, revisit if it becomes heavy.
- **`lifetimes` is an older lib (last release 2021)** — installs and runs on Python 3.11–3.14 (verified 3.14 locally, 31 pytest green); Dockerfile targets 3.12. Pinned optional; fallback covers any future incompatibility.

## Verification
- `scripts/preflight.sh`: **green** — full turbo build, `pnpm type-check`, **212 api vitest passing (24 files)**, `prisma migrate status` = "Database schema is up to date!" (10 migrations, no drift) against `engageiq_aiwiring`.
- `apps/ml-service`: **31 pytest passing** (incl. new BG/NBD population tests + preserved fallback tests) on Python 3.14 with `lifetimes` installed.
- **Boot smoke-test:** started `node apps/api/dist/index.js` on PORT=4010, `GET /health` → **200** `{"status":"ok",…}`.

## What to Do Next
Lane ready for integration — preflight green, boots, `/health`=200. **Integrator: merge
`lane/ai-wiring`** (independent of other Wave-2 lanes; only shared-file touches are
append-only `// lane:ai-wiring` blocks in `index.ts` and `whatsapp.ts`). Coordinate the
`whatsapp.ts` append block with lane `wa-conversation` if it also edits the webhook — the
DELIVERED/READ propagation is a self-contained tagged block separate from inbound routing.
Then update `memory/context.md` (single-writer rule) to mark these six follow-ups resolved.
To run the ML service for the real-time gate + LTV: `cd apps/ml-service && uvicorn
app.main:app --port 8000` (or set `ML_SERVICE_URL`).
