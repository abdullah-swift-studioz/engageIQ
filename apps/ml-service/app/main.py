"""EngageIQ ML & AI microservice — FastAPI entrypoint (lane:ml).

Stateless w.r.t. the application database: the Node scoring worker reads
tenant-scoped features from Postgres, POSTs them here, and persists the scores we
return. This service only trains/serves models — it never touches the app DB,
which keeps a single DB writer and preserves multi-tenant scoping on the Node side.

Endpoints:
  GET  /health
  POST /score/rfm            RFM (4.2)
  POST /score/churn          Churn prediction (7.1)
  POST /score/ltv            LTV prediction (7.2)
  POST /score/fake-order     COD fake-order scoring (7.3) — batch or single (real-time)
  POST /recommendations      Product recommendations (7.2)
  POST /segments/discover    AI segment discovery (5.3)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.config import get_settings
from app.models import churn as churn_model
from app.models import fake_order as fake_model
from app.models import ltv as ltv_model
from app.models import recommendations as rec_model
from app.models import rfm as rfm_model
from app.models import segment_discovery as seg_model
from app.schemas import (
    ChurnScoreRequest,
    ChurnScoreResponse,
    FakeOrderRequest,
    FakeOrderResponse,
    LtvScoreRequest,
    LtvScoreResponse,
    RecommendationRequest,
    RecommendationResponse,
    RfmScoreRequest,
    RfmScoreResponse,
    SegmentDiscoveryRequest,
    SegmentDiscoveryResponse,
)
from app.training.registry import build_registry

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ml.main")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.train_on_startup:
        log.info("building model registry (train_on_startup=True)")
        _state["registry"] = build_registry(settings)
    _state["settings"] = settings
    yield
    _state.clear()


app = FastAPI(title="EngageIQ ML Service", version=__version__, lifespan=lifespan)


def _registry():
    reg = _state.get("registry")
    if reg is None:
        # Lazy build (e.g. tests that skip lifespan or set train_on_startup later).
        reg = build_registry(get_settings())
        _state["registry"] = reg
    return reg


@app.get("/health")
def health() -> dict:
    reg = _state.get("registry")
    return {
        "status": "ok",
        "version": __version__,
        "models": {
            "churn": reg.churn_version if reg else "not-loaded",
            "fake_order": reg.fake_version if reg else "not-loaded",
        },
    }


@app.post("/score/rfm", response_model=RfmScoreResponse, response_model_by_alias=True)
def score_rfm(req: RfmScoreRequest) -> RfmScoreResponse:
    return RfmScoreResponse(scores=rfm_model.score_rfm(req.customers))


@app.post("/score/churn", response_model=ChurnScoreResponse, response_model_by_alias=True)
def score_churn(req: ChurnScoreRequest) -> ChurnScoreResponse:
    scores = churn_model.predict(_registry().churn_model, req.customers)
    return ChurnScoreResponse(scores=scores)


@app.post("/score/ltv", response_model=LtvScoreResponse, response_model_by_alias=True)
def score_ltv(req: LtvScoreRequest) -> LtvScoreResponse:
    return LtvScoreResponse(scores=ltv_model.score_ltv(req.customers))


@app.post("/score/fake-order", response_model=FakeOrderResponse, response_model_by_alias=True)
def score_fake_order(req: FakeOrderRequest) -> FakeOrderResponse:
    scores = fake_model.predict(_registry().fake_model, req.orders)
    return FakeOrderResponse(scores=scores)


@app.post("/recommendations", response_model=RecommendationResponse, response_model_by_alias=True)
def recommendations(req: RecommendationRequest) -> RecommendationResponse:
    recs = rec_model.recommend(req.interactions, req.customers, req.top_n, req.rec_type)
    return RecommendationResponse(recommendations=recs)


@app.post("/segments/discover", response_model=SegmentDiscoveryResponse, response_model_by_alias=True)
def discover_segments(req: SegmentDiscoveryRequest) -> SegmentDiscoveryResponse:
    clusters, silhouette = seg_model.discover(req.customers, req.max_clusters)
    return SegmentDiscoveryResponse(clusters=clusters, silhouette=silhouette)
