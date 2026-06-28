from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_rfm_endpoint_camel_case_io():
    body = {
        "customers": [
            {"id": "a", "recencyDays": 2, "frequency": 20, "monetary": 100000},
            {"id": "b", "recencyDays": 400, "frequency": 1, "monetary": 1000},
        ]
    }
    r = client.post("/score/rfm", json=body)
    assert r.status_code == 200
    scores = r.json()["scores"]
    assert len(scores) == 2
    # response uses camelCase aliases
    assert "recencyScore" in scores[0]
    assert "frequencyScore" in scores[0]


def test_churn_endpoint():
    body = {"customers": [{"id": "a", "recencyDays": 300, "frequency": 2, "monetary": 4000,
                           "interPurchaseGapDays": 40, "tenureDays": 320, "codRejectionRate": 0.5}]}
    r = client.post("/score/churn", json=body)
    assert r.status_code == 200
    s = r.json()["scores"][0]
    assert 0 <= s["churnScore"] <= 100
    assert s["churnRiskLabel"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


def test_ltv_endpoint():
    body = {"customers": [{"id": "a", "recencyDays": 10, "frequency": 12, "monetary": 60000,
                           "avgOrderValue": 5000, "tenureDays": 360}]}
    r = client.post("/score/ltv", json=body)
    assert r.status_code == 200
    s = r.json()["scores"][0]
    assert s["ltv90d"] <= s["ltv180d"] <= s["ltv365d"]


def test_fake_order_endpoint():
    body = {"orders": [{"id": "o1", "amount": 45000, "isFirstOrder": True, "isHighValue": True,
                        "phoneValid": False, "addressDuplicationCount": 3, "cityKnown": False,
                        "customerCodRejectionRate": 0.8, "ordersLast24h": 5}]}
    r = client.post("/score/fake-order", json=body)
    assert r.status_code == 200
    s = r.json()["scores"][0]
    assert 0 <= s["fakeScore"] <= 100
    assert s["riskBand"] in {"PROCESS", "VERIFY", "CANCEL"}


def test_recommendations_endpoint():
    body = {
        "interactions": [
            {"customerId": "u1", "productId": "A", "weight": 3},
            {"customerId": "u1", "productId": "B", "weight": 3},
            {"customerId": "u2", "productId": "A", "weight": 3},
            {"customerId": "u2", "productId": "B", "weight": 3},
            {"customerId": "u3", "productId": "B", "weight": 3},
        ],
        "customers": ["u3"],
        "topN": 3,
        "recType": "ALSO_BOUGHT",
    }
    r = client.post("/recommendations", json=body)
    assert r.status_code == 200
    recs = r.json()["recommendations"]
    assert recs and "A" in recs[0]["productIds"]


def test_segment_discovery_endpoint():
    customers = [
        {"id": f"hi{i}", "recencyDays": 5, "frequency": 15, "monetary": 80000,
         "ltv365d": 50000, "sessionCount": 40} for i in range(10)
    ] + [
        {"id": f"lo{i}", "recencyDays": 300, "frequency": 1, "monetary": 2000,
         "ltv365d": 1000, "sessionCount": 2} for i in range(10)
    ]
    r = client.post("/segments/discover", json={"customers": customers, "maxClusters": 5})
    assert r.status_code == 200
    assert len(r.json()["clusters"]) >= 2
