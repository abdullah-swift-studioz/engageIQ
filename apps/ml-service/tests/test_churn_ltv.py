import numpy as np

from app.config import get_settings
from app.models import churn as churn_model
from app.models import ltv as ltv_model
from app.schemas import ChurnCustomer, LtvCustomer
from app.training.registry import build_registry


def _registry():
    return build_registry(get_settings())


def test_churn_band_boundaries():
    assert churn_model.band_for(0) == "LOW"
    assert churn_model.band_for(25) == "LOW"
    assert churn_model.band_for(25.1) == "MEDIUM"
    assert churn_model.band_for(50) == "MEDIUM"
    assert churn_model.band_for(75) == "HIGH"
    assert churn_model.band_for(99) == "CRITICAL"


def test_churn_scores_in_range():
    reg = _registry()
    custs = [
        ChurnCustomer(id="active", recency_days=5, frequency=12, monetary=50000,
                      avg_order_value=4000, tenure_days=400, inter_purchase_gap_days=30,
                      session_count=40),
        ChurnCustomer(id="lapsed", recency_days=300, frequency=2, monetary=4000,
                      avg_order_value=2000, tenure_days=320, inter_purchase_gap_days=40,
                      session_count=2, cod_rejection_rate=0.5),
    ]
    scores = churn_model.predict(reg.churn_model, custs)
    for s in scores:
        assert 0 <= s.churn_score <= 100


def test_lapsed_customer_higher_churn_than_active():
    reg = _registry()
    active = ChurnCustomer(id="a", recency_days=5, frequency=15, monetary=80000,
                           avg_order_value=5000, tenure_days=500, inter_purchase_gap_days=33,
                           session_count=60)
    lapsed = ChurnCustomer(id="l", recency_days=350, frequency=2, monetary=3000,
                           avg_order_value=1500, tenure_days=360, inter_purchase_gap_days=45,
                           session_count=1, cod_rejection_rate=0.6)
    out = {s.id: s for s in churn_model.predict(reg.churn_model, [active, lapsed])}
    assert out["l"].churn_score > out["a"].churn_score


def test_ltv_monotonic_in_horizon_and_nonneg():
    custs = [
        LtvCustomer(id="x", recency_days=10, frequency=12, monetary=60000,
                    avg_order_value=5000, tenure_days=360),
        LtvCustomer(id="zero", recency_days=0, frequency=0, monetary=0,
                    avg_order_value=0, tenure_days=0),
    ]
    out = {s.id: s for s in ltv_model.score_ltv(custs)}
    assert out["x"].ltv90d <= out["x"].ltv180d <= out["x"].ltv365d
    assert out["x"].ltv365d > 0
    assert out["zero"].ltv90d == out["zero"].ltv180d == out["zero"].ltv365d == 0.0


def test_ltv_recent_buyer_beats_lapsed():
    recent = LtvCustomer(id="r", recency_days=5, frequency=10, monetary=50000,
                         avg_order_value=5000, tenure_days=300)
    lapsed = LtvCustomer(id="l", recency_days=280, frequency=10, monetary=50000,
                         avg_order_value=5000, tenure_days=300)
    out = {s.id: s for s in ltv_model.score_ltv([recent, lapsed])}
    assert out["r"].ltv365d > out["l"].ltv365d
