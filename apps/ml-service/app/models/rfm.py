"""RFM scoring engine (milestone 4.2).

Scores are *relative*: R, F and M are quintile (1–5) ranks computed within the
merchant's own customer base, exactly per the roadmap ("percentile-based within
merchant's own customer base"). The named segment is then read off the standard
R × FM grid, where FM = round((F + M) / 2).

Pure-numpy: no model training, no persistence. Deterministic for a given cohort.
"""

from __future__ import annotations

import numpy as np

from app.schemas import RfmCustomer, RfmScore, RfmSegmentName

# Standard 5×5 RFM grid → 11 named segments (all RfmSegment enum values used).
# Rows = recency score (1 worst … 5 best), Cols = FM score (1 … 5).
_GRID: dict[tuple[int, int], RfmSegmentName] = {
    (5, 1): "NEW_CUSTOMER",     (5, 2): "POTENTIAL_LOYALIST", (5, 3): "POTENTIAL_LOYALIST", (5, 4): "LOYAL",            (5, 5): "CHAMPION",
    (4, 1): "PROMISING",        (4, 2): "POTENTIAL_LOYALIST", (4, 3): "POTENTIAL_LOYALIST", (4, 4): "LOYAL",            (4, 5): "CHAMPION",
    (3, 1): "ABOUT_TO_SLEEP",   (3, 2): "NEED_ATTENTION",     (3, 3): "NEED_ATTENTION",     (3, 4): "LOYAL",            (3, 5): "LOYAL",
    (2, 1): "HIBERNATING",      (2, 2): "AT_RISK",            (2, 3): "AT_RISK",            (2, 4): "CANNOT_LOSE_THEM", (2, 5): "CANNOT_LOSE_THEM",
    (1, 1): "LOST",             (1, 2): "HIBERNATING",        (1, 3): "AT_RISK",            (1, 4): "CANNOT_LOSE_THEM", (1, 5): "CANNOT_LOSE_THEM",
}


def _quintile_ranks(values: np.ndarray, *, ascending: bool) -> np.ndarray:
    """Map values to 1–5 quintile ranks.

    ``ascending=True``  → larger value gets the higher score (frequency, monetary).
    ``ascending=False`` → smaller value gets the higher score (recency days).

    Uses average-rank percentiles so ties land in the same band, then bins into 5.
    Degrades gracefully for tiny cohorts (n < 5) where true quintiles don't exist.
    """
    n = len(values)
    if n == 0:
        return np.array([], dtype=int)
    if n == 1:
        return np.array([3], dtype=int)  # single customer → neutral middle band

    arr = values.astype(float)
    if not ascending:
        arr = -arr

    # Average-rank percentile in [0, 1].
    order = arr.argsort(kind="mergesort")
    ranks = np.empty(n, dtype=float)
    sorted_arr = arr[order]
    i = 0
    while i < n:
        j = i
        while j + 1 < n and sorted_arr[j + 1] == sorted_arr[i]:
            j += 1
        avg_rank = (i + j) / 2.0  # 0-based average rank for the tie group
        ranks[order[i : j + 1]] = avg_rank
        i = j + 1
    pct = ranks / (n - 1)  # 0 … 1

    # 5 equal-width percentile bands → 1..5.
    scores = np.clip(np.floor(pct * 5).astype(int) + 1, 1, 5)
    return scores


def score_rfm(customers: list[RfmCustomer]) -> list[RfmScore]:
    if not customers:
        return []

    recency = np.array([c.recency_days for c in customers], dtype=float)
    frequency = np.array([c.frequency for c in customers], dtype=float)
    monetary = np.array([c.monetary for c in customers], dtype=float)

    r = _quintile_ranks(recency, ascending=False)
    f = _quintile_ranks(frequency, ascending=True)
    m = _quintile_ranks(monetary, ascending=True)

    out: list[RfmScore] = []
    for idx, c in enumerate(customers):
        fm = int(round((int(f[idx]) + int(m[idx])) / 2.0))
        fm = max(1, min(5, fm))
        segment = _GRID[(int(r[idx]), fm)]
        out.append(
            RfmScore(
                id=c.id,
                recency_score=int(r[idx]),
                frequency_score=int(f[idx]),
                monetary_score=int(m[idx]),
                segment=segment,
            )
        )
    return out
