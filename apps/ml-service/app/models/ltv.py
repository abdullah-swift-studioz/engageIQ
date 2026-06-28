"""Predicted customer lifetime value (milestone 7.2).

Rather than fabricate a trained regressor on synthetic targets, LTV uses a
transparent probabilistic model:

  purchase_rate      = frequency / tenure_days           (orders per day)
  retention(horizon) = exp(-recency_days / (gap * k))     (survival: lapsed buyers decay)
  expected_orders    = purchase_rate * horizon * retention
  predicted_ltv      = expected_orders * avg_order_value

This is the standard "discounted expected purchases × expected spend" shape that
BG/NBD + Gamma-Gamma formalise. It is monotonic and explainable, and is the
honest model until enough repeat-purchase history exists to fit BG/NBD (the
roadmap's stated target — a clean future swap behind this same interface).
"""

from __future__ import annotations

import math

from app.schemas import LtvCustomer, LtvScore

_HORIZONS = (90, 180, 365)
_RETENTION_K = 1.5  # how forgiving the survival curve is to recency vs. the typical gap


def _predict_one(c: LtvCustomer) -> tuple[float, float, float]:
    tenure = max(float(c.tenure_days), 1.0)
    freq = max(float(c.frequency), 0.0)
    aov = float(c.avg_order_value)
    if aov <= 0 and freq > 0:
        aov = float(c.monetary) / freq

    if freq <= 0 or aov <= 0:
        return (0.0, 0.0, 0.0)

    purchase_rate = freq / tenure  # orders/day
    gap = tenure / freq
    # Survival multiplier in (0, 1]: recent buyers ~1, long-lapsed buyers → 0.
    retention = math.exp(-float(c.recency_days) / (gap * _RETENTION_K + 1.0))

    out = []
    for h in _HORIZONS:
        expected_orders = purchase_rate * h * retention
        out.append(round(expected_orders * aov, 2))
    return (out[0], out[1], out[2])


def score_ltv(customers: list[LtvCustomer]) -> list[LtvScore]:
    scores: list[LtvScore] = []
    for c in customers:
        l90, l180, l365 = _predict_one(c)
        scores.append(LtvScore(id=c.id, ltv90d=l90, ltv180d=l180, ltv365d=l365))
    return scores
