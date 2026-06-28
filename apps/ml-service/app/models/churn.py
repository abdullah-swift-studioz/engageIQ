"""Churn prediction model (milestone 7.1).

A gradient-boosted classifier (sklearn HistGradientBoosting) predicts the
probability a customer has churned; we expose it as a 0–100 ``churn_score`` and a
band label. The 0–100 scale and the band boundaries are pinned by ``CHURN_SCORE``
in ``@engageiq/shared`` (LOW≤25, MEDIUM≤50, HIGH≤75, CRITICAL≤100) so the ML
writer, the segment builder and journey triggers all agree.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

from app.schemas import ChurnCustomer, ChurnRiskLabel, ChurnScore

# Feature order MUST match training.synthetic.make_churn_dataset.
FEATURES = [
    "recency_days",
    "frequency",
    "monetary",
    "avg_order_value",
    "tenure_days",
    "inter_purchase_gap_days",
    "session_count",
    "days_since_last_seen",
    "cod_order_count",
    "cod_rejection_rate",
]

# Inclusive upper bound of each band — mirrors CHURN_SCORE.BANDS in @engageiq/shared.
_BANDS: list[tuple[float, ChurnRiskLabel]] = [
    (25.0, "LOW"),
    (50.0, "MEDIUM"),
    (75.0, "HIGH"),
    (100.0, "CRITICAL"),
]


def band_for(score: float) -> ChurnRiskLabel:
    for upper, label in _BANDS:
        if score <= upper:
            return label
    return "CRITICAL"


def build_features(c: ChurnCustomer) -> list[float]:
    last_seen = c.days_since_last_seen if c.days_since_last_seen is not None else c.recency_days
    return [
        float(c.recency_days),
        float(c.frequency),
        float(c.monetary),
        float(c.avg_order_value),
        float(c.tenure_days),
        float(c.inter_purchase_gap_days),
        float(c.session_count),
        float(last_seen),
        float(c.cod_order_count),
        float(c.cod_rejection_rate),
    ]


def train(X: np.ndarray, y: np.ndarray, seed: int) -> HistGradientBoostingClassifier:
    clf = HistGradientBoostingClassifier(
        max_iter=200,
        learning_rate=0.08,
        max_depth=4,
        l2_regularization=1.0,
        random_state=seed,
    )
    clf.fit(X, y)
    return clf


def predict(clf: HistGradientBoostingClassifier, customers: list[ChurnCustomer]) -> list[ChurnScore]:
    if not customers:
        return []
    X = np.array([build_features(c) for c in customers], dtype=float)
    proba = clf.predict_proba(X)[:, 1]  # P(churn)
    scores: list[ChurnScore] = []
    for c, p in zip(customers, proba):
        s = round(float(p) * 100.0, 2)
        scores.append(ChurnScore(id=c.id, churn_score=s, churn_risk_label=band_for(s)))
    return scores
