from app.config import get_settings
from app.models import fake_order as fake_model
from app.schemas import FakeOrderInput
from app.training.registry import build_registry


def _reg():
    return build_registry(get_settings())


def test_bands():
    assert fake_model.band_for(10) == "PROCESS"
    assert fake_model.band_for(40) == "PROCESS"
    assert fake_model.band_for(55) == "VERIFY"
    assert fake_model.band_for(85) == "CANCEL"


def test_scores_in_range_and_details():
    reg = _reg()
    orders = [
        FakeOrderInput(id="clean", amount=2000, is_first_order=False, is_high_value=False,
                       customer_cod_order_count=8, customer_cod_rejection_rate=0.0,
                       phone_valid=True, address_length=60, address_has_street_signal=True,
                       address_duplication_count=0, city_known=True, orders_last_24h=0),
        FakeOrderInput(id="risky", amount=45000, is_first_order=True, is_high_value=True,
                       customer_cod_order_count=0, customer_cod_rejection_rate=0.8,
                       phone_valid=False, address_length=8, address_has_street_signal=False,
                       address_duplication_count=3, city_known=False, orders_last_24h=5),
    ]
    out = {s.id: s for s in fake_model.predict(reg.fake_model, orders)}
    for s in out.values():
        assert 0 <= s.fake_score <= 100
        assert "reasons" in s.details
    assert out["risky"].fake_score > out["clean"].fake_score
    assert len(out["risky"].details["reasons"]) > 0


def test_single_order_realtime_path():
    reg = _reg()
    out = fake_model.predict(reg.fake_model, [
        FakeOrderInput(id="o1", amount=5000, is_first_order=True, is_high_value=True,
                       phone_valid=False, address_duplication_count=2)
    ])
    assert len(out) == 1
    assert out[0].risk_band in {"PROCESS", "VERIFY", "CANCEL"}


def test_empty():
    reg = _reg()
    assert fake_model.predict(reg.fake_model, []) == []
