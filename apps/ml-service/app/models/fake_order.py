"""Fake-order (COD fraud) scoring model (milestone 7.3).

A gradient-boosted binary classifier (fake vs. legitimate COD order) scored 0–100.
The score maps to merchant-configurable bands per the roadmap:
  0–40   PROCESS  (process normally)
  41–70  VERIFY   (require COD verification)
  71–100 CANCEL   (auto-cancel / hold)

The scorer is batch-or-single, so the same endpoint serves the real-time
"score within seconds of order placement" path and the nightly re-score.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

from app.schemas import FakeOrderInput, FakeOrderScore, FakeRiskBand

# Feature order MUST match training.synthetic.make_fake_order_dataset.
FEATURES = [
    "amount",
    "is_first_order",
    "is_high_value",
    "cod_order_count",
    "cod_rejection_rate",
    "phone_valid",
    "address_length",
    "address_has_street_signal",
    "address_duplication_count",
    "city_known",
    "orders_last_24h",
]

# Default thresholds; merchants can override on the Node side before persisting.
VERIFY_THRESHOLD = 40.0
CANCEL_THRESHOLD = 70.0


def band_for(score: float, verify: float = VERIFY_THRESHOLD, cancel: float = CANCEL_THRESHOLD) -> FakeRiskBand:
    if score > cancel:
        return "CANCEL"
    if score > verify:
        return "VERIFY"
    return "PROCESS"


def build_features(o: FakeOrderInput) -> list[float]:
    return [
        float(o.amount),
        float(o.is_first_order),
        float(o.is_high_value),
        float(o.customer_cod_order_count),
        float(o.customer_cod_rejection_rate),
        float(o.phone_valid),
        float(o.address_length),
        float(o.address_has_street_signal),
        float(o.address_duplication_count),
        float(o.city_known),
        float(o.orders_last_24h),
    ]


def _reasons(o: FakeOrderInput) -> list[str]:
    """Human-readable risk signals surfaced into details (for merchant review)."""
    r: list[str] = []
    if o.is_first_order and o.is_high_value:
        r.append("first order is high value")
    if not o.phone_valid:
        r.append("phone number failed validation")
    if o.address_duplication_count > 0:
        r.append(f"address shared by {o.address_duplication_count} other account(s)")
    if not o.address_has_street_signal:
        r.append("address missing house/street signal")
    if o.customer_cod_rejection_rate >= 0.4:
        r.append(f"high prior COD rejection rate ({o.customer_cod_rejection_rate:.0%})")
    if o.orders_last_24h >= 3:
        r.append(f"{o.orders_last_24h} orders in last 24h (velocity)")
    if not o.city_known:
        r.append("delivery city not recognised")
    return r


def train(X: np.ndarray, y: np.ndarray, seed: int) -> HistGradientBoostingClassifier:
    clf = HistGradientBoostingClassifier(
        max_iter=250,
        learning_rate=0.08,
        max_depth=4,
        l2_regularization=1.0,
        random_state=seed,
    )
    clf.fit(X, y)
    return clf


def predict(
    clf: HistGradientBoostingClassifier,
    orders: list[FakeOrderInput],
    *,
    verify: float = VERIFY_THRESHOLD,
    cancel: float = CANCEL_THRESHOLD,
) -> list[FakeOrderScore]:
    if not orders:
        return []
    X = np.array([build_features(o) for o in orders], dtype=float)
    proba = clf.predict_proba(X)[:, 1]
    out: list[FakeOrderScore] = []
    for o, p in zip(orders, proba):
        s = round(float(p) * 100.0, 2)
        out.append(
            FakeOrderScore(
                id=o.id,
                fake_score=s,
                risk_band=band_for(s, verify, cancel),
                details={"reasons": _reasons(o), "probability": round(float(p), 4)},
            )
        )
    return out
