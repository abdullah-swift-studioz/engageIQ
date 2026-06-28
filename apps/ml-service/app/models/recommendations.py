"""Product recommendations (milestone 7.2).

Item-item collaborative filtering on implicit feedback (purchases weighted more
than views). For each target customer we score candidate products by summed
cosine similarity to the items they've already interacted with, exclude items
they already have, and return the top-N. Cold-start customers (no interactions)
fall back to global popularity so every customer gets a non-empty result.

Pure numpy/pandas; no persistence — recomputed per run from the interaction set
the Node worker supplies.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from app.schemas import CustomerRecommendation, Interaction, RecommendationType


def _cosine_item_similarity(
    user_index: dict[str, int],
    item_index: dict[str, int],
    interactions: list[Interaction],
) -> np.ndarray:
    n_users = len(user_index)
    n_items = len(item_index)
    mat = np.zeros((n_users, n_items), dtype=float)
    for it in interactions:
        u = user_index[it.customer_id]
        i = item_index[it.product_id]
        mat[u, i] += it.weight

    # Cosine similarity between item columns.
    norms = np.linalg.norm(mat, axis=0)
    norms[norms == 0] = 1.0
    normalized = mat / norms
    sim = normalized.T @ normalized  # n_items x n_items
    np.fill_diagonal(sim, 0.0)
    return mat, sim


def recommend(
    interactions: list[Interaction],
    targets: list[str],
    top_n: int,
    rec_type: RecommendationType,
) -> list[CustomerRecommendation]:
    if not interactions:
        return []

    users = sorted({it.customer_id for it in interactions})
    items = sorted({it.product_id for it in interactions})
    user_index = {u: i for i, u in enumerate(users)}
    item_index = {p: i for i, p in enumerate(items)}
    items_arr = np.array(items, dtype=object)

    mat, sim = _cosine_item_similarity(user_index, item_index, interactions)

    # Global popularity for cold-start / fallback.
    popularity = mat.sum(axis=0)
    pop_order = np.argsort(-popularity)

    if not targets:
        targets = users

    results: list[CustomerRecommendation] = []
    for cust in targets:
        if cust in user_index:
            u = user_index[cust]
            owned = mat[u] > 0
            # Candidate score = similarity to owned items, weighted by interaction strength.
            scores = sim @ mat[u]
            scores[owned] = -np.inf  # exclude already-interacted items
            ranked = np.argsort(-scores)
            picks = [int(i) for i in ranked if np.isfinite(scores[i]) and scores[i] > 0][:top_n]
            if picks:
                top_score = float(scores[picks[0]]) or 1.0
                product_ids = [str(items_arr[i]) for i in picks]
                score = round(top_score, 4)
            else:
                product_ids, score = _popularity_fallback(pop_order, items_arr, owned, top_n)
        else:
            product_ids, score = _popularity_fallback(pop_order, items_arr, None, top_n)

        if product_ids:
            results.append(
                CustomerRecommendation(
                    customer_id=cust,
                    rec_type=rec_type,
                    product_ids=product_ids,
                    score=score,
                )
            )
    return results


def _popularity_fallback(
    pop_order: np.ndarray,
    items_arr: np.ndarray,
    owned: np.ndarray | None,
    top_n: int,
) -> tuple[list[str], float]:
    picks: list[str] = []
    for i in pop_order:
        if owned is not None and owned[i]:
            continue
        picks.append(str(items_arr[i]))
        if len(picks) >= top_n:
            break
    return picks, 0.0
