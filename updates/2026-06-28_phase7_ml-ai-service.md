# Update: ML / AI Service — RFM, Churn, LTV, Fake-Order, Recommendations, Segment Discovery

**Date:** 2026-06-28
**Phase:** 4 / 5 / 7 (roadmap) | **Milestones:** 4.2 RFM, 7.1 Churn, 7.2 LTV + Recommendations, 7.3 Fake Order, 5.3 AI Segment Discovery | **Lane:** D — ML / AI Service (`lane/ml`)
**Author:** Claude Code (Session — "EngageIQ Instance 3")

## What Was Built

A new Python FastAPI ML microservice (`apps/ml-service/`) that trains and serves all
platform ML/AI models, plus the Node-side BullMQ scoring worker
(`apps/api/src/workers/scoring.worker.ts`) that reads tenant-scoped features from
Postgres, calls the service, and **persists results to the existing score columns**.
No schema changes — only existing columns/tables are written.

**Architecture decision:** the Python service is **stateless w.r.t. the app DB**. The
Node worker is the only DB reader/writer (preserving the single-writer, tenant-scoped
contract); Python is a pure train/serve function. This keeps Prisma/DB coupling out of
Python and tenant-scoping enforcement on the Node side where the rest of the codebase
already does it.

**Models (all camelCase JSON contract in `apps/ml-service/app/schemas.py`):**
- **RFM (4.2)** — percentile R/F/M (1–5) within each merchant + standard 5×5 grid → all
  11 `RfmSegment` enum values. Pure numpy, no training. `POST /score/rfm`.
- **Churn (7.1)** — scikit-learn HistGradientBoosting classifier → 0–100 `churnScore` +
  band (LOW/MEDIUM/HIGH/CRITICAL). Bands pinned to `CHURN_SCORE` in `@engageiq/shared`.
  `POST /score/churn`.
- **LTV (7.2)** — transparent probabilistic model (purchase-rate × recency survival ×
  AOV) for ltv90d/180d/365d. `POST /score/ltv`.
- **Fake order (7.3)** — HistGradientBoosting fraud classifier → 0–100 + PROCESS/VERIFY/
  CANCEL bands + human-readable reasons. Batch **or** single (real-time). `POST /score/fake-order`.
- **Recommendations (7.2)** — item-item collaborative filtering on purchase line-items with
  popularity fallback. `POST /recommendations`. Read API: `GET /api/v1/recommendations/:customerId`.
- **AI segment discovery (5.3)** — K-means (silhouette-chosen k) + cluster profiling
  (size, avg LTV/RFM, description, recommended action). `POST /segments/discover`.

**Bootstrap training:** churn + fake-order train on **synthetic** labelled data
(`app/training/synthetic.py`) with a known monotonic propensity function, since the seed
DB has no labelled outcomes yet. Fitted models persist via joblib (`model_store/`,
gitignored) and reload on restart. Same training entry points retrain on real data later
with no API change. Documented in the service README.

**Node side:**
- `scoring.worker.ts` — `scoring` BullMQ queue consumer. Tasks: `rfm | churn | ltv |
  fake-order | recommendations | segment-discovery | full`. `full` = daily bundle. Every
  query merchant-scoped; writes RFM/churn/LTV columns, COD `fakeScore`/`fakeScoreDetails`
  + `Customer.fakeOrderScore` rollup (worst score), `Recommendation` upserts, and a
  `ModelRun` audit row per task. Pure feature builders exported for unit testing.
- Repeatable schedulers via `scoringQueue.upsertJobScheduler` (idempotent): daily full run
  (`ML_SCORING_CRON`), weekly segment discovery (`ML_SEGMENT_DISCOVERY_CRON`).

## Files Created / Modified

**Created (owned):**
- `apps/ml-service/**` — FastAPI service: `app/main.py`, `app/config.py`, `app/schemas.py`,
  `app/models/{rfm,churn,ltv,fake_order,recommendations,segment_discovery}.py`,
  `app/training/{synthetic,registry}.py`, `tests/test_*.py` (28 pytest), `Dockerfile`,
  `requirements*.txt`, `pyproject.toml`, `README.md`, `.gitignore`.
- `apps/api/src/workers/scoring.worker.ts` + `scoring.worker.test.ts` (9 vitest).
- `apps/api/src/routes/recommendations/{index,controller,service,schema}.ts` — read API (7.2).

**Modified (append-only `// lane:ml` blocks):**
- `packages/shared/src/types.ts` — `SCORING` const, `ScoringTask`, `ScoringJob`, `DiscoveredSegment`.
- `packages/shared/src/index.ts` — barrel re-exports for the above.
- `packages/shared/src/env.ts` — `ML_SERVICE_URL`, `ML_SERVICE_TIMEOUT_MS`, `ML_SCORING_CRON`,
  `ML_SEGMENT_DISCOVERY_CRON`, `ML_SCHEDULER_ENABLED`.
- `packages/queue/src/queues.ts` + `index.ts` — `scoringQueue` + `'scoring'` QueueName.
- `apps/api/src/worker.ts` — scoring worker instantiation, handlers, scheduler registration, shutdown.
- `apps/api/src/index.ts` — register recommendations route at `/api/v1/recommendations`.
- `.env.example` — ML service vars.

**Local-only (gitignored, not committed):** `.env`, `packages/db/.env` (lane DB URL for
Prisma CLI), `apps/ml-service/.venv`, `apps/ml-service/model_store`.

## Decisions Made This Session
- **No xgboost/lightgbm** — scikit-learn HistGradientBoosting gives gradient-boosted trees
  with no native runtime deps (no libomp), keeping the image lean. Verified all deps install
  on Python 3.14 (only version available locally); Dockerfile targets 3.12-slim.
- **Stateless Python service; Node owns all DB I/O** — single writer, tenant-safe (see above).
- **LTV is a probabilistic formula, not a trained regressor** — honest given sparse repeat-
  purchase data; BG/NBD + Gamma-Gamma is the documented future swap behind the same interface.
- **Segment discovery surfaces clusters; does NOT auto-create `Segment` rows** — that table is
  the segmentation lane's. Clusters recorded in `ModelRun.metadata` for later one-click promotion.
- **`Customer.fakeOrderScore` = max (worst) across the customer's COD orders** — conservative
  customer-level risk rollup; per-order detail lives on `CodOrder.fakeScore/fakeScoreDetails`.

## Deviations from Roadmap
- 7.3 specifies real-time synchronous fake-order scoring inside the order webhook processor.
  That processor (`order.processor.ts`) is **not owned by this lane**, so the scoring path is
  delivered as a batch task + a batch-or-single ML endpoint ready for synchronous use. Wiring
  the one-line synchronous call into the webhook processor is a small integration follow-up.
- 5.3 "one-click convert cluster to segment" requires writing the `Segment` table (segmentation
  lane). Discovery + surfacing is complete; promotion is a cross-lane follow-up.

## Known Issues Left Open
- **Fake-order address features are partial.** `addressDuplicationCount` is always 0 (needs a
  cross-account address index) and address/phone signals depend on the matched `Order`
  shippingAddress; CODs without a matching Order get neutral defaults. Richer address features
  need shipping-address persistence on the COD path (ingestion-lane follow-up).
- **Recommendations use purchase signals only** (order line-items). Adding `product_viewed`
  ClickHouse events as implicit feedback is a documented enhancement.
- **Bootstrap models train on synthetic data** until real labelled outcomes (confirmed fakes,
  deliveries, churn) accumulate — by design; retrain entry points are in place.

## Verification
- `apps/ml-service`: **28 pytest passing**.
- `scripts/preflight.sh`: **green** — full build, typecheck, **99 api vitest passing** (90 prior
  + 9 new), clean `prisma migrate status` against `engageiq_ml`.
- **End-to-end:** started the Python service, ran a real `full` + `segment-discovery` scoring
  run against `engageiq_ml`. Confirmed writes: RFM segments/scores on 4 buyers (0-order customer
  correctly skipped), churn scores+labels, LTV 90/180/365, COD `fakeScore`+`fakeScoreDetails`
  + `Customer.fakeOrderScore` rollup, 2 `Recommendation` rows (co-occurrence CF), 6 `ModelRun`
  audit rows.

## What to Do Next
Lane ready for integration. Integrator: merge `lane/ml`, then (follow-ups) wire the synchronous
fake-order call into `order.processor.ts`, and expose discovered clusters for one-click segment
promotion in the segmentation lane. To run the service: `cd apps/ml-service && uvicorn app.main:app
--port 8000`; the worker auto-registers daily/weekly schedulers on boot (`ML_SCHEDULER_ENABLED`).
