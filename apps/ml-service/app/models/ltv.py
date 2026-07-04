"""Predicted customer lifetime value (milestone 7.2).

Upgraded from the earlier transparent formula to the standard **BG/NBD + Gamma-Gamma**
buy-till-you-die model (via the `lifetimes` package):

  BG/NBD       models the number of FUTURE (repeat) purchases each customer will make in a
               horizon, from (frequency, recency, T).
  Gamma-Gamma  models each customer's expected monetary value per transaction, from
               (frequency, monetary_value), independent of purchase count.

  predicted_ltv(h) = E[purchases in h | BG/NBD] × E[avg order value | Gamma-Gamma]

Both are fit across the whole scored population, then applied per customer.

Graceful fallback (the important part for sparse South-Asian COD data, where most customers
have a single order and repeat history is thin):
  * If `lifetimes` is not installed, or the population is too small to fit, or the fit raises,
    OR an individual customer is ineligible (no age / no repeat history for Gamma-Gamma),
    that customer falls back to the transparent probabilistic formula below.
  * The formula is the previous model: purchase_rate × survival × avg_order_value — monotonic,
    explainable, and dependency-free — so a fresh store with no repeat history still gets
    sensible LTVs on day one.
"""

from __future__ import annotations

import math

from app.schemas import LtvCustomer, LtvScore

_HORIZONS = (90, 180, 365)
_RETENTION_K = 1.5  # how forgiving the survival curve is to recency vs. the typical gap
# Below this many fittable customers we don't trust the MLE — fall back to the formula.
_MIN_FIT_POPULATION = 20
_PENALIZER = 0.01  # light L2 regularisation for numerical stability of the fits

# lifetimes is optional: import defensively so the service runs (via fallback) without it.
try:  # pragma: no cover - import guard
    from lifetimes import BetaGeoFitter, GammaGammaFitter

    _HAVE_LIFETIMES = True
except Exception:  # pragma: no cover - any import failure → formula fallback
    BetaGeoFitter = None  # type: ignore[assignment,misc]
    GammaGammaFitter = None  # type: ignore[assignment,misc]
    _HAVE_LIFETIMES = False


def _fallback_one(c: LtvCustomer) -> tuple[float, float, float]:
    """Transparent probabilistic LTV — the day-one / sparse-data model."""
    tenure = max(float(c.tenure_days), 1.0)
    freq = max(float(c.frequency), 0.0)
    aov = float(c.avg_order_value)
    if aov <= 0 and freq > 0:
        aov = float(c.monetary) / freq

    if freq <= 0 or aov <= 0:
        return (0.0, 0.0, 0.0)

    purchase_rate = freq / tenure  # orders/day
    gap = tenure / freq
    retention = math.exp(-float(c.recency_days) / (gap * _RETENTION_K + 1.0))

    out = []
    for h in _HORIZONS:
        expected_orders = purchase_rate * h * retention
        out.append(round(expected_orders * aov, 2))
    return (out[0], out[1], out[2])


def _rfm_terms(c: LtvCustomer) -> tuple[float, float, float, float]:
    """(frequency_repeat, recency_tx, T, monetary_value) in BG/NBD conventions.

    lifetimes uses: frequency = # repeat transactions; recency = age (in the chosen time
    unit) at the LAST purchase; T = age at observation. Our inputs give tenure (T) and
    recency_days (T - recency_tx), so recency_tx = tenure − recency_days, clamped to [0, T].
    """
    T = max(float(c.tenure_days), 0.0)
    freq_repeat = max(float(c.frequency) - 1.0, 0.0)
    recency_tx = min(max(T - float(c.recency_days), 0.0), T)
    aov = float(c.avg_order_value)
    if aov <= 0 and c.frequency > 0:
        aov = float(c.monetary) / float(c.frequency)
    return (freq_repeat, recency_tx, T, aov)


def score_ltv(customers: list[LtvCustomer]) -> list[LtvScore]:
    if not customers:
        return []

    terms = [_rfm_terms(c) for c in customers]

    bgf = None
    ggf = None
    if _HAVE_LIFETIMES:
        # Fit BG/NBD on customers with a positive observation age.
        fit_idx = [i for i, (_f, _r, T, _m) in enumerate(terms) if T > 0]
        if len(fit_idx) >= _MIN_FIT_POPULATION:
            try:
                freq = [terms[i][0] for i in fit_idx]
                rec = [terms[i][1] for i in fit_idx]
                age = [terms[i][2] for i in fit_idx]
                bgf = BetaGeoFitter(penalizer_coef=_PENALIZER)
                bgf.fit(freq, rec, age)
            except Exception:
                bgf = None

            # Gamma-Gamma needs repeat buyers with positive monetary value.
            gg_idx = [i for i in fit_idx if terms[i][0] > 0 and terms[i][3] > 0]
            if bgf is not None and len(gg_idx) >= _MIN_FIT_POPULATION:
                try:
                    gg_freq = [terms[i][0] for i in gg_idx]
                    gg_val = [terms[i][3] for i in gg_idx]
                    ggf = GammaGammaFitter(penalizer_coef=_PENALIZER)
                    ggf.fit(gg_freq, gg_val)
                except Exception:
                    ggf = None

    scores: list[LtvScore] = []
    for c, (freq_repeat, recency_tx, T, aov) in zip(customers, terms):
        # No fitted model, or customer has no age → transparent fallback.
        if bgf is None or T <= 0:
            l90, l180, l365 = _fallback_one(c)
            scores.append(LtvScore(id=c.id, ltv90d=l90, ltv180d=l180, ltv365d=l365))
            continue

        # Expected per-transaction value: Gamma-Gamma for repeat buyers, else their own AOV.
        if ggf is not None and freq_repeat > 0 and aov > 0:
            try:
                exp_value = float(ggf.conditional_expected_average_profit(freq_repeat, aov))
            except Exception:
                exp_value = aov
        else:
            exp_value = aov
        if not math.isfinite(exp_value) or exp_value <= 0:
            exp_value = aov

        out: list[float] = []
        for h in _HORIZONS:
            try:
                exp_purchases = float(
                    bgf.conditional_expected_number_of_purchases_up_to_time(
                        h, freq_repeat, recency_tx, T
                    )
                )
            except Exception:
                exp_purchases = 0.0
            if not math.isfinite(exp_purchases) or exp_purchases < 0:
                exp_purchases = 0.0
            out.append(round(exp_purchases * exp_value, 2))

        # If the model collapsed to ~0 for a customer who clearly has value, use the formula
        # so a genuine buyer is never scored at 0 purely due to a thin fit.
        if out[2] <= 0 and c.frequency > 0:
            l90, l180, l365 = _fallback_one(c)
            scores.append(LtvScore(id=c.id, ltv90d=l90, ltv180d=l180, ltv365d=l365))
        else:
            scores.append(LtvScore(id=c.id, ltv90d=out[0], ltv180d=out[1], ltv365d=out[2]))

    return scores
