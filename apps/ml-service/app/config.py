"""Service configuration (env-driven, validated by pydantic-settings)."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ML_", env_file=".env", extra="ignore")

    # Where fitted models (joblib) are persisted between restarts.
    model_dir: Path = Path(__file__).resolve().parent.parent / "model_store"

    # If true, (re)train the bootstrap models on startup when no persisted model exists.
    train_on_startup: bool = True

    # Deterministic seed so model versions and tests are reproducible.
    random_seed: int = 42

    # Number of synthetic rows generated to bootstrap each supervised model.
    synthetic_rows: int = 4000

    # Service version string stamped onto ModelRun rows from the Node side.
    service_version: str = "0.1.0"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        _settings.model_dir.mkdir(parents=True, exist_ok=True)
    return _settings
