"""Synthetic, labelled bootstrap datasets.

The seeded merchant has a handful of customers and no labelled churn/fraud
outcomes, so the supervised models (churn, fake-order) cannot be trained on real
data yet. We bootstrap them on synthetic data whose label is generated from a
known, monotonic propensity function. This produces a *real* fitted classifier
that behaves sensibly in the intuitive directions; once real labelled outcomes
(confirmed fakes, delivered orders, actual churn) accumulate, the same training
entry points retrain on real data with no API change.

Everything here is deterministic given the seed.
"""

from __future__ import annotations

import numpy as np


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def make_churn_dataset(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (X, y) for churn. Feature order matches app.models.churn.FEATURES.

    Ground-truth churn rises with recency relative to a customer's own typical
    inter-purchase gap, and falls with frequency / engagement.
    """
    rng = np.random.default_rng(seed)

    tenure_days = rng.uniform(15, 720, n)
    rate = np.exp(rng.uniform(np.log(0.002), np.log(0.06), n))  # orders/day
    frequency = np.maximum(1, rng.poisson(rate * tenure_days)).astype(float)
    avg_order_value = np.exp(rng.normal(np.log(2500), 0.5, n))
    monetary = frequency * avg_order_value * rng.uniform(0.8, 1.2, n)
    inter_gap = tenure_days / frequency

    # recency: a multiple of the customer's own gap (active << gap, lapsed >> gap)
    recency_ratio = np.exp(rng.normal(0.0, 0.9, n))  # median 1.0
    recency_days = np.minimum(inter_gap * recency_ratio, tenure_days + 400)
    session_count = np.maximum(0, rng.poisson(frequency * rng.uniform(1.0, 4.0, n))).astype(float)
    days_since_last_seen = recency_days * rng.uniform(0.4, 1.1, n)
    cod_order_count = np.minimum(frequency, rng.poisson(frequency * 0.4)).astype(float)
    cod_rejection_rate = np.clip(rng.beta(1.2, 8.0, n), 0, 1)

    ratio = recency_days / (inter_gap + 1.0)
    logit = (
        -2.2
        + 1.5 * ratio
        - 0.10 * frequency
        - 0.0002 * monetary
        - 0.05 * session_count
        + 1.2 * cod_rejection_rate
    )
    p = _sigmoid(logit)
    y = (rng.uniform(0, 1, n) < p).astype(int)

    X = np.column_stack(
        [
            recency_days,
            frequency,
            monetary,
            avg_order_value,
            tenure_days,
            inter_gap,
            session_count,
            days_since_last_seen,
            cod_order_count,
            cod_rejection_rate,
        ]
    )
    return X, y


def make_fake_order_dataset(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (X, y) for fake-order. Feature order matches app.models.fake_order.FEATURES.

    Ground-truth fraud rises with: first order + high value, invalid phone,
    duplicated / weak address, prior COD rejections, order velocity, unknown city.
    """
    rng = np.random.default_rng(seed + 1)

    is_first_order = rng.binomial(1, 0.35, n).astype(float)
    is_high_value = rng.binomial(1, 0.30, n).astype(float)
    cod_order_count = rng.poisson(2.0, n).astype(float)
    cod_rejection_rate = np.clip(rng.beta(1.3, 7.0, n), 0, 1)
    phone_valid = rng.binomial(1, 0.85, n).astype(float)
    address_length = rng.integers(5, 120, n).astype(float)
    address_has_street_signal = rng.binomial(1, 0.8, n).astype(float)
    address_duplication_count = rng.poisson(0.3, n).astype(float)
    city_known = rng.binomial(1, 0.9, n).astype(float)
    orders_last_24h = rng.poisson(0.5, n).astype(float)
    amount = np.exp(rng.normal(np.log(3000), 0.7, n))

    logit = (
        -2.6
        + 1.3 * (is_first_order * is_high_value)
        + 1.6 * (1 - phone_valid)
        + 1.2 * np.minimum(address_duplication_count, 3)
        + 1.0 * (1 - address_has_street_signal)
        + 2.5 * cod_rejection_rate
        + 0.6 * orders_last_24h
        + 0.9 * (1 - city_known)
        - 0.35 * np.log1p(cod_order_count)
        - 0.6 * (address_length > 40)
    )
    p = _sigmoid(logit)
    y = (rng.uniform(0, 1, n) < p).astype(int)

    X = np.column_stack(
        [
            amount,
            is_first_order,
            is_high_value,
            cod_order_count,
            cod_rejection_rate,
            phone_valid,
            address_length,
            address_has_street_signal,
            address_duplication_count,
            city_known,
            orders_last_24h,
        ]
    )
    return X, y
