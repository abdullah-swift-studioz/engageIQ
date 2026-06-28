"""AI segment discovery (milestone 5.3).

K-means clustering over standardised customer feature vectors (RFM + LTV +
session activity). The number of clusters is chosen automatically by silhouette
score over a small range. Each discovered cluster is profiled with its size,
average LTV / RFM, a human-readable behavioural description and a recommended
action — ready for one-click promotion to a named segment on the Node side.
"""

from __future__ import annotations

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from app.schemas import DiscoveredCluster, DiscoveryCustomer


def _features(customers: list[DiscoveryCustomer]) -> np.ndarray:
    return np.array(
        [
            [
                float(c.recency_days),
                float(c.frequency),
                float(c.monetary),
                float(c.ltv365d),
                float(c.session_count),
            ]
            for c in customers
        ],
        dtype=float,
    )


def _describe(centroid: dict[str, float], overall: dict[str, float]) -> tuple[str, str]:
    """Produce a behavioural description + recommended action from a centroid."""
    bits: list[str] = []
    action = "Nurture with a general re-engagement offer"

    high_value = centroid["monetary"] >= overall["monetary"]
    recent = centroid["recency_days"] <= overall["recency_days"]
    frequent = centroid["frequency"] >= overall["frequency"]

    if high_value and recent and frequent:
        bits.append("high-value, recently active frequent buyers")
        action = "Reward with VIP perks and early access; protect this cohort"
    elif high_value and not recent:
        bits.append("high spenders who have lapsed")
        action = "Win-back campaign with a strong personalised incentive"
    elif recent and not frequent:
        bits.append("recent but low-frequency buyers")
        action = "Drive a second purchase with a time-boxed follow-up offer"
    elif not recent and not frequent:
        bits.append("dormant low-engagement customers")
        action = "Low-cost reactivation or suppress to protect deliverability"
    else:
        bits.append("mid-tier steady customers")
        action = "Upsell / cross-sell to grow order value"

    if centroid["session_count"] >= overall["session_count"] * 1.5:
        bits.append("browse a lot")
    desc = ", ".join(bits)
    return desc, action


def discover(customers: list[DiscoveryCustomer], max_clusters: int) -> tuple[list[DiscoveredCluster], float | None]:
    n = len(customers)
    if n < 3:
        return [], None

    X = _features(customers)
    Xs = StandardScaler().fit_transform(X)

    upper = min(max_clusters, n - 1)
    best_k, best_score, best_labels = 2, -1.0, None
    for k in range(2, max(3, upper + 1)):
        if k >= n:
            break
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(Xs)
        if len(set(labels)) < 2:
            continue
        score = silhouette_score(Xs, labels)
        if score > best_score:
            best_k, best_score, best_labels = k, score, labels

    if best_labels is None:
        return [], None

    overall = {
        "recency_days": float(X[:, 0].mean()),
        "frequency": float(X[:, 1].mean()),
        "monetary": float(X[:, 2].mean()),
        "ltv365d": float(X[:, 3].mean()),
        "session_count": float(X[:, 4].mean()),
    }

    ids = np.array([c.id for c in customers], dtype=object)
    clusters: list[DiscoveredCluster] = []
    for c in range(best_k):
        mask = best_labels == c
        if not mask.any():
            continue
        members = X[mask]
        centroid = {
            "recency_days": float(members[:, 0].mean()),
            "frequency": float(members[:, 1].mean()),
            "monetary": float(members[:, 2].mean()),
            "ltv365d": float(members[:, 3].mean()),
            "session_count": float(members[:, 4].mean()),
        }
        desc, action = _describe(centroid, overall)
        clusters.append(
            DiscoveredCluster(
                label=f"Cluster {c + 1}",
                size=int(mask.sum()),
                avg_ltv=round(centroid["ltv365d"], 2),
                avg_recency_days=round(centroid["recency_days"], 1),
                avg_frequency=round(centroid["frequency"], 2),
                avg_monetary=round(centroid["monetary"], 2),
                description=desc,
                recommended_action=action,
                customer_ids=[str(x) for x in ids[mask]],
            )
        )

    clusters.sort(key=lambda cl: cl.avg_ltv, reverse=True)
    return clusters, round(float(best_score), 4)
