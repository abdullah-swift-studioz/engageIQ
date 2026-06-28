# EngageIQ ML service (lane:ml). Python FastAPI microservice.
# scikit-learn gives gradient-boosted trees with no native runtime deps (no libomp),
# so this image stays slim on python:3.12-slim.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    ML_MODEL_DIR=/app/model_store

WORKDIR /app

# Install deps first for layer caching.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

# Train (or load) bootstrap models at build time so the container starts warm.
RUN mkdir -p /app/model_store && \
    python -c "from app.config import get_settings; from app.training.registry import build_registry; build_registry(get_settings())"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
