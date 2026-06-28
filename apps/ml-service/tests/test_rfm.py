from app.models.rfm import score_rfm
from app.schemas import RfmCustomer


def _cohort():
    # 5 customers spanning the spectrum from best (champion-ish) to worst (lost-ish).
    return [
        RfmCustomer(id="best", recency_days=2, frequency=20, monetary=100000),
        RfmCustomer(id="good", recency_days=15, frequency=10, monetary=40000),
        RfmCustomer(id="mid", recency_days=60, frequency=5, monetary=15000),
        RfmCustomer(id="weak", recency_days=180, frequency=2, monetary=4000),
        RfmCustomer(id="worst", recency_days=400, frequency=1, monetary=1000),
    ]


def test_scores_in_range():
    scores = score_rfm(_cohort())
    assert len(scores) == 5
    for s in scores:
        assert 1 <= s.recency_score <= 5
        assert 1 <= s.frequency_score <= 5
        assert 1 <= s.monetary_score <= 5


def test_best_customer_outranks_worst():
    by_id = {s.id: s for s in score_rfm(_cohort())}
    assert by_id["best"].recency_score >= by_id["worst"].recency_score
    assert by_id["best"].frequency_score > by_id["worst"].frequency_score
    assert by_id["best"].monetary_score > by_id["worst"].monetary_score
    assert by_id["best"].segment == "CHAMPION"
    assert by_id["worst"].segment in {"LOST", "HIBERNATING", "AT_RISK"}


def test_recency_is_lower_is_better():
    # The most recent buyer should never get a worse recency score than a stale one.
    by_id = {s.id: s for s in score_rfm(_cohort())}
    assert by_id["best"].recency_score == 5
    assert by_id["worst"].recency_score == 1


def test_empty_and_singleton():
    assert score_rfm([]) == []
    one = score_rfm([RfmCustomer(id="solo", recency_days=10, frequency=3, monetary=9000)])
    assert len(one) == 1
    assert 1 <= one[0].recency_score <= 5


def test_segments_are_valid_enum_values():
    valid = {
        "CHAMPION", "LOYAL", "POTENTIAL_LOYALIST", "NEW_CUSTOMER", "PROMISING",
        "NEED_ATTENTION", "ABOUT_TO_SLEEP", "AT_RISK", "CANNOT_LOSE_THEM",
        "HIBERNATING", "LOST",
    }
    for s in score_rfm(_cohort()):
        assert s.segment in valid
