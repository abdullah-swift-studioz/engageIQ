"""Model registry: trains the supervised models on synthetic bootstrap data,
persists the fitted estimators with joblib, and reloads them on restart.

Only churn and fake-order require a fitted estimator. RFM, LTV, recommendations
and segment discovery are computed analytically per request and need no artifact.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import joblib
from sklearn.ensemble import HistGradientBoostingClassifier

from app.config import Settings
from app.models import churn, fake_order
from app.training import synthetic

log = logging.getLogger("ml.registry")

CHURN_VERSION = "churn-hgb-synthetic-v1"
FAKE_VERSION = "fake-order-hgb-synthetic-v1"


@dataclass
class Registry:
    churn_model: HistGradientBoostingClassifier
    fake_model: HistGradientBoostingClassifier
    churn_version: str = CHURN_VERSION
    fake_version: str = FAKE_VERSION


def _path(settings: Settings, name: str):
    return settings.model_dir / f"{name}.joblib"


def _load_or_train(
    settings: Settings,
    name: str,
    version: str,
    make_dataset,
    train_fn,
) -> HistGradientBoostingClassifier:
    path = _path(settings, name)
    if path.exists():
        try:
            payload = joblib.load(path)
            if payload.get("version") == version:
                log.info("loaded %s from %s", name, path)
                return payload["model"]
            log.info("%s version mismatch (%s != %s); retraining", name, payload.get("version"), version)
        except Exception as exc:  # noqa: BLE001 - corrupt artifact → retrain
            log.warning("failed to load %s (%s); retraining", name, exc)

    log.info("training %s on %d synthetic rows", name, settings.synthetic_rows)
    X, y = make_dataset(settings.synthetic_rows, settings.random_seed)
    model = train_fn(X, y, settings.random_seed)
    joblib.dump({"model": model, "version": version}, path)
    return model


def build_registry(settings: Settings) -> Registry:
    churn_model = _load_or_train(
        settings, "churn", CHURN_VERSION, synthetic.make_churn_dataset, churn.train
    )
    fake_model = _load_or_train(
        settings, "fake_order", FAKE_VERSION, synthetic.make_fake_order_dataset, fake_order.train
    )
    return Registry(churn_model=churn_model, fake_model=fake_model)
