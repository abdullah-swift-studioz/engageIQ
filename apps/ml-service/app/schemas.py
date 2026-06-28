"""Request/response contracts between the Node scoring worker and this service.

All JSON keys are camelCase (TS-friendly); Python attributes stay snake_case via a
camelCase alias generator. Responses are serialised with ``by_alias=True``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

RfmSegmentName = Literal[
    "CHAMPION",
    "LOYAL",
    "POTENTIAL_LOYALIST",
    "NEW_CUSTOMER",
    "PROMISING",
    "NEED_ATTENTION",
    "ABOUT_TO_SLEEP",
    "AT_RISK",
    "CANNOT_LOSE_THEM",
    "HIBERNATING",
    "LOST",
]
ChurnRiskLabel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
FakeRiskBand = Literal["PROCESS", "VERIFY", "CANCEL"]
RecommendationType = Literal["ALSO_BOUGHT", "MIGHT_LIKE", "COMPLETE_LOOK", "RESTOCK"]


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


# ─── RFM (milestone 4.2) ──────────────────────────────────────────────────────
class RfmCustomer(CamelModel):
    id: str
    recency_days: float  # days since last order (lower = more recent)
    frequency: int  # lifetime order count
    monetary: float  # lifetime spend (PKR)


class RfmScoreRequest(CamelModel):
    customers: list[RfmCustomer]


class RfmScore(CamelModel):
    id: str
    recency_score: int  # 1–5
    frequency_score: int  # 1–5
    monetary_score: int  # 1–5
    segment: RfmSegmentName


class RfmScoreResponse(CamelModel):
    scores: list[RfmScore]


# ─── Churn (milestone 7.1) ────────────────────────────────────────────────────
class ChurnCustomer(CamelModel):
    id: str
    recency_days: float
    frequency: int
    monetary: float
    avg_order_value: float = 0.0
    tenure_days: float = 0.0  # days since first order
    inter_purchase_gap_days: float = 0.0  # avg gap between orders
    session_count: int = 0
    days_since_last_seen: float | None = None
    cod_order_count: int = 0
    cod_rejection_rate: float = 0.0


class ChurnScoreRequest(CamelModel):
    customers: list[ChurnCustomer]


class ChurnScore(CamelModel):
    id: str
    churn_score: float  # 0–100
    churn_risk_label: ChurnRiskLabel


class ChurnScoreResponse(CamelModel):
    scores: list[ChurnScore]


# ─── LTV (milestone 7.2) ──────────────────────────────────────────────────────
class LtvCustomer(CamelModel):
    id: str
    recency_days: float
    frequency: int
    monetary: float
    avg_order_value: float = 0.0
    tenure_days: float = 0.0


class LtvScoreRequest(CamelModel):
    customers: list[LtvCustomer]


class LtvScore(CamelModel):
    id: str
    # Explicit aliases: to_camel would mangle ltv90d → ltv90D; DB/TS use ltv90d.
    ltv90d: float = Field(alias="ltv90d")
    ltv180d: float = Field(alias="ltv180d")
    ltv365d: float = Field(alias="ltv365d")


class LtvScoreResponse(CamelModel):
    scores: list[LtvScore]


# ─── Fake-order scoring (milestone 7.3) ───────────────────────────────────────
class FakeOrderInput(CamelModel):
    id: str  # cod order id
    amount: float
    is_first_order: bool = False
    is_high_value: bool = False
    customer_cod_order_count: int = 0
    customer_cod_rejection_rate: float = 0.0
    phone_valid: bool = True  # passed E.164 / length check
    address_length: int = 0
    address_has_street_signal: bool = True  # contains a digit / house no.
    address_duplication_count: int = 0  # other accounts sharing this address
    city_known: bool = True
    orders_last_24h: int = 0


class FakeOrderRequest(CamelModel):
    orders: list[FakeOrderInput]


class FakeOrderScore(CamelModel):
    id: str
    fake_score: float  # 0–100
    risk_band: FakeRiskBand
    details: dict


class FakeOrderResponse(CamelModel):
    scores: list[FakeOrderScore]


# ─── Product recommendations (milestone 7.2) ──────────────────────────────────
class Interaction(CamelModel):
    customer_id: str
    product_id: str
    weight: float = 1.0  # purchase=heavier than view


class RecommendationRequest(CamelModel):
    interactions: list[Interaction]
    customers: list[str] = []  # target customers; empty = all seen in interactions
    top_n: int = 5
    rec_type: RecommendationType = "ALSO_BOUGHT"


class CustomerRecommendation(CamelModel):
    customer_id: str
    rec_type: RecommendationType
    product_ids: list[str]
    score: float


class RecommendationResponse(CamelModel):
    recommendations: list[CustomerRecommendation]


# ─── AI segment discovery (milestone 5.3) ─────────────────────────────────────
class DiscoveryCustomer(CamelModel):
    id: str
    recency_days: float
    frequency: int
    monetary: float
    ltv365d: float = Field(default=0.0, alias="ltv365d")
    session_count: int = 0


class SegmentDiscoveryRequest(CamelModel):
    customers: list[DiscoveryCustomer]
    max_clusters: int = 6


class DiscoveredCluster(CamelModel):
    label: str
    size: int
    avg_ltv: float
    avg_recency_days: float
    avg_frequency: float
    avg_monetary: float
    description: str
    recommended_action: str
    customer_ids: list[str]


class SegmentDiscoveryResponse(CamelModel):
    clusters: list[DiscoveredCluster]
    silhouette: float | None = None
