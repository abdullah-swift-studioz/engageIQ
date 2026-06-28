# EngageIQ ML Service (`lane:ml`)

Python FastAPI microservice that trains and serves the platform's ML/AI models.
It is **stateless with respect to the application database**: the Node scoring
worker (`apps/api/src/workers/scoring.worker.ts`) reads tenant-scoped features
from Postgres, POSTs them here, and persists the scores we return. This keeps a
single DB writer (multi-tenant safe) and zero Prisma/DB coupling in Python.

## Models / milestones

| Endpoint | Milestone | Model |
|---|---|---|
| `POST /score/rfm` | 4.2 RFM Scoring | Percentile R/F/M (1–5) within merchant + 11-segment grid. Pure numpy. |
| `POST /score/churn` | 7.1 Churn Prediction | Gradient-boosted classifier → 0–100 score + band (LOW/MEDIUM/HIGH/CRITICAL). |
| `POST /score/ltv` | 7.2 LTV | Probabilistic LTV (purchase-rate × survival × AOV) for 90/180/365d. |
| `POST /score/fake-order` | 7.3 Fake Order (COD) | Gradient-boosted fraud classifier → 0–100 + PROCESS/VERIFY/CANCEL band. Batch **or** single (real-time). |
| `POST /recommendations` | 7.2 Recommendations | Item-item collaborative filtering with popularity fallback. |
| `POST /segments/discover` | 5.3 AI Segment Discovery | K-means (silhouette-chosen k) + cluster profiling. |
| `GET /health` | — | Liveness + loaded model versions. |

All request/response JSON is **camelCase** (see `app/schemas.py`).

## Bootstrap training

The seeded merchant has too few labelled outcomes to train churn/fake-order on
real data, so those two supervised models bootstrap on **synthetic** data whose
label comes from a known monotonic propensity function (`app/training/synthetic.py`).
This yields a real fitted classifier that behaves sensibly in the intuitive
directions. Fitted models are persisted with joblib under `model_store/` and
reloaded on restart. When real labelled outcomes accumulate, the same training
entry points retrain on real data with no API change. RFM, LTV, recommendations
and segment discovery are computed analytically per request — no artifact.

## Run locally

```bash
cd apps/ml-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000   # http://localhost:8000/health
pytest                                            # 28 tests
```

## Docker

```bash
docker build -t engageiq-ml-service apps/ml-service
docker run -p 8000:8000 engageiq-ml-service
```

The image trains the bootstrap models at build time so the container starts warm.

## Config (env, `ML_` prefix)

| Var | Default | Meaning |
|---|---|---|
| `ML_MODEL_DIR` | `./model_store` | Where fitted models are persisted. |
| `ML_TRAIN_ON_STARTUP` | `true` | Train/load bootstrap models on startup. |
| `ML_RANDOM_SEED` | `42` | Determinism for training + tests. |
| `ML_SYNTHETIC_ROWS` | `4000` | Synthetic rows per supervised model. |
