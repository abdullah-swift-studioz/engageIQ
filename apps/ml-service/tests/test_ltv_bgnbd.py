"""BG/NBD + Gamma-Gamma LTV path (milestone 7.2 upgrade).

The small-population tests in test_churn_ltv.py exercise the fallback formula (< the fit
threshold). These drive the *fitted* model with a real population so the lifetimes path runs.
"""

import math

import pytest

from app.models import ltv as ltv_model
from app.schemas import LtvCustomer


def _population(n: int = 60) -> list[LtvCustomer]:
    custs: list[LtvCustomer] = []
    for i in range(n):
        freq = 2 + (i % 8)  # 2..9 total orders → repeat history for Gamma-Gamma
        tenure = 200.0 + (i % 100)
        recency = float((i % 5) * 20)  # 0..80 days since last order
        aov = 3000.0 + (i % 10) * 500
        custs.append(
            LtvCustomer(
                id=f"c{i}",
                recency_days=recency,
                frequency=freq,
                monetary=aov * freq,
                avg_order_value=aov,
                tenure_days=tenure,
            )
        )
    return custs


@pytest.mark.skipif(not ltv_model._HAVE_LIFETIMES, reason="lifetimes not installed")
def test_bgnbd_population_scores_are_finite_nonneg_monotonic():
    scores = ltv_model.score_ltv(_population())
    assert len(scores) == 60
    for s in scores:
        for v in (s.ltv90d, s.ltv180d, s.ltv365d):
            assert math.isfinite(v)
            assert v >= 0
        # BG/NBD expected purchases is monotonic increasing in the horizon.
        assert s.ltv90d <= s.ltv180d <= s.ltv365d
    # At least some customers get a positive LTV from the fitted model.
    assert any(s.ltv365d > 0 for s in scores)


@pytest.mark.skipif(not ltv_model._HAVE_LIFETIMES, reason="lifetimes not installed")
def test_bgnbd_recent_buyer_beats_lapsed_within_fitted_population():
    pop = _population()
    recent = LtvCustomer(id="recent", recency_days=3, frequency=8, monetary=40000,
                         avg_order_value=5000, tenure_days=300)
    lapsed = LtvCustomer(id="lapsed", recency_days=280, frequency=8, monetary=40000,
                         avg_order_value=5000, tenure_days=300)
    out = {s.id: s for s in ltv_model.score_ltv(pop + [recent, lapsed])}
    assert out["recent"].ltv365d >= out["lapsed"].ltv365d


def test_ltv_zero_customer_is_zero_regardless_of_path():
    zero = LtvCustomer(id="z", recency_days=0, frequency=0, monetary=0,
                       avg_order_value=0, tenure_days=0)
    out = ltv_model.score_ltv([zero])[0]
    assert out.ltv90d == out.ltv180d == out.ltv365d == 0.0
