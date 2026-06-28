from app.models.recommendations import recommend
from app.schemas import Interaction


def _interactions():
    # Two customers who bought {A,B}, one who bought {B,C}; A&B co-occur strongly.
    return [
        Interaction(customer_id="u1", product_id="A", weight=3),
        Interaction(customer_id="u1", product_id="B", weight=3),
        Interaction(customer_id="u2", product_id="A", weight=3),
        Interaction(customer_id="u2", product_id="B", weight=3),
        Interaction(customer_id="u3", product_id="B", weight=3),
        Interaction(customer_id="u3", product_id="C", weight=3),
    ]


def test_recommends_cooccurring_item():
    # u3 has B,C; B co-occurs with A → A should be recommended to u3.
    recs = recommend(_interactions(), targets=["u3"], top_n=3, rec_type="ALSO_BOUGHT")
    assert len(recs) == 1
    assert "A" in recs[0].product_ids
    assert "B" not in recs[0].product_ids  # already owned, excluded
    assert recs[0].rec_type == "ALSO_BOUGHT"


def test_cold_start_falls_back_to_popularity():
    recs = recommend(_interactions(), targets=["new_user"], top_n=2, rec_type="MIGHT_LIKE")
    assert len(recs) == 1
    assert len(recs[0].product_ids) > 0  # popularity fallback gives something


def test_empty_interactions():
    assert recommend([], targets=[], top_n=5, rec_type="ALSO_BOUGHT") == []


def test_all_targets_default_to_all_users():
    recs = recommend(_interactions(), targets=[], top_n=3, rec_type="ALSO_BOUGHT")
    customer_ids = {r.customer_id for r in recs}
    assert {"u1", "u2", "u3"}.issubset(customer_ids)
