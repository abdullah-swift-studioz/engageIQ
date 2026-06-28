import numpy as np

from app.models.segment_discovery import discover
from app.schemas import DiscoveryCustomer


def _three_blobs():
    rng = np.random.default_rng(0)
    custs = []
    # High-value recent frequent
    for i in range(15):
        custs.append(DiscoveryCustomer(id=f"hi{i}", recency_days=float(rng.uniform(1, 20)),
                                       frequency=int(rng.integers(10, 20)),
                                       monetary=float(rng.uniform(60000, 90000)),
                                       ltv365d=float(rng.uniform(40000, 60000)),
                                       session_count=int(rng.integers(30, 60))))
    # Lapsed high spenders
    for i in range(15):
        custs.append(DiscoveryCustomer(id=f"lapse{i}", recency_days=float(rng.uniform(200, 350)),
                                       frequency=int(rng.integers(5, 12)),
                                       monetary=float(rng.uniform(50000, 80000)),
                                       ltv365d=float(rng.uniform(5000, 12000)),
                                       session_count=int(rng.integers(1, 5))))
    # Low-value recent one-timers
    for i in range(15):
        custs.append(DiscoveryCustomer(id=f"lo{i}", recency_days=float(rng.uniform(1, 30)),
                                       frequency=1,
                                       monetary=float(rng.uniform(1000, 4000)),
                                       ltv365d=float(rng.uniform(500, 2000)),
                                       session_count=int(rng.integers(1, 8))))
    return custs


def test_discovers_multiple_clusters():
    clusters, silhouette = discover(_three_blobs(), max_clusters=6)
    assert len(clusters) >= 2
    assert silhouette is not None
    total = sum(c.size for c in clusters)
    assert total == 45
    for c in clusters:
        assert c.description
        assert c.recommended_action
        assert len(c.customer_ids) == c.size


def test_too_few_customers_returns_empty():
    clusters, silhouette = discover(
        [DiscoveryCustomer(id="a", recency_days=1, frequency=1, monetary=100)], max_clusters=4
    )
    assert clusters == []
    assert silhouette is None


def test_clusters_sorted_by_ltv_desc():
    clusters, _ = discover(_three_blobs(), max_clusters=6)
    ltvs = [c.avg_ltv for c in clusters]
    assert ltvs == sorted(ltvs, reverse=True)
