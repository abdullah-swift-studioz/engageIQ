#!/usr/bin/env bash
# start-local.sh — bring up the full EngageIQ stack locally for browser review.
#
# Brings up: API (:3001) + worker + web dashboard (:3000), wired to the canonical
# `engageiq` Postgres DB, local ClickHouse (:8123) and Redis (:6379).
#
# It mints a fresh JWT on every run and injects it as the web dashboard's DEV_TOKEN
# (the Remix UI has no login page — it authenticates to the API with this token).
#
# Prereqs (NOT started here — Homebrew/standalone services must already be running):
#   - Postgres 16  (brew services start postgresql@16)
#   - Redis 7      (brew services start redis)
#   - ClickHouse   (standalone on :8123)
#
# Usage:  ./scripts/start-local.sh          # start everything
#         ./scripts/start-local.sh stop     # stop the API/worker/web it started
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export DOTENV_CONFIG_PATH="$ROOT/.env"
LOGDIR="${TMPDIR:-/tmp}/engageiq-local"
mkdir -p "$LOGDIR"
LOGIN_EMAIL="owner@test-store.com"
LOGIN_PASS="Test1234!"

stop() {
  echo "Stopping EngageIQ local stack…"
  for p in 3001 3000; do lsof -ti tcp:$p 2>/dev/null | xargs -r kill -9 2>/dev/null; done
  pgrep -fl "Downloads/engageIQ/.*src/(index|worker)\.ts" 2>/dev/null | awk '{print $1}' | xargs -r kill -9 2>/dev/null
  echo "Stopped."
}

wait_http() {  # wait_http <url> <label>
  curl -s --retry 40 --retry-delay 1 --retry-connrefused --retry-all-errors --max-time 5 -o /dev/null -w "" "$1" \
    && echo "  ✓ $2 reachable" || { echo "  ✗ $2 NOT reachable"; return 1; }
}

if [[ "${1:-}" == "stop" ]]; then stop; exit 0; fi

echo "==> Preflight: required services"
pg_isready -h localhost -p 5432 >/dev/null 2>&1 && echo "  ✓ Postgres :5432" || { echo "  ✗ Postgres :5432 — run: brew services start postgresql@16"; exit 1; }
redis-cli ping >/dev/null 2>&1 && echo "  ✓ Redis :6379" || { echo "  ✗ Redis :6379 — run: brew services start redis"; exit 1; }
curl -s --max-time 3 "http://localhost:8123/?query=SELECT%201" >/dev/null 2>&1 && echo "  ✓ ClickHouse :8123" || { echo "  ✗ ClickHouse :8123 not reachable"; exit 1; }

echo "==> Clearing any stale dev servers on :3001 / :3000"
stop >/dev/null 2>&1

echo "==> Starting API (:3001)"
nohup pnpm --filter @engageiq/api dev > "$LOGDIR/api.log" 2>&1 &
wait_http "http://localhost:3001/health" "API /health" || { echo "  see $LOGDIR/api.log"; exit 1; }

echo "==> Minting dashboard token (login as $LOGIN_EMAIL)"
TOKEN=$(curl -s --max-time 8 -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$LOGIN_EMAIL\",\"password\":\"$LOGIN_PASS\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch(e){}})")
if [[ -z "$TOKEN" ]]; then echo "  ✗ login failed — is the DB seeded? (pnpm --filter @engageiq/db db:seed)"; exit 1; fi
node -e "const fs=require('fs');let s=fs.readFileSync('.env','utf8');s=s.replace(/^DEV_TOKEN=.*$/m,'DEV_TOKEN='+process.argv[1]);fs.writeFileSync('.env',s);" "$TOKEN"
echo "  ✓ token minted (role OWNER) and written to .env DEV_TOKEN"

echo "==> Starting worker (ML scheduler off)"
ML_SCHEDULER_ENABLED=false nohup pnpm --filter @engageiq/api worker:dev > "$LOGDIR/worker.log" 2>&1 &

echo "==> Starting web dashboard (:3000)"
API_URL=http://localhost:3001 DEV_TOKEN="$TOKEN" nohup pnpm --filter @engageiq/web dev > "$LOGDIR/web.log" 2>&1 &
wait_http "http://localhost:3000/" "Web /" || { echo "  see $LOGDIR/web.log"; exit 1; }

# Optional: Python ML service (:8000). Scores are already populated in the DB, so this is
# only needed to (re)compute scores live. Started best-effort if the venv exists.
if [[ -x "$ROOT/apps/ml-service/.venv/bin/uvicorn" ]]; then
  echo "==> Starting ML service (:8000, best-effort — trains models on boot, ~30s)"
  ( cd "$ROOT/apps/ml-service" && lsof -ti tcp:8000 2>/dev/null | xargs -r kill -9 2>/dev/null
    nohup ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > "$LOGDIR/ml.log" 2>&1 & )
else
  echo "==> ML service venv not found — skipping (set up: python3 -m venv apps/ml-service/.venv && apps/ml-service/.venv/bin/pip install -r apps/ml-service/requirements.txt)"
fi

cat <<EOF

────────────────────────────────────────────────────────────────────
  EngageIQ is up.   Open:  http://localhost:3000
  The dashboard is pre-authenticated as $LOGIN_EMAIL (OWNER).
  API:    http://localhost:3001   (health: /health)
  Logs:   $LOGDIR/{api,worker,web}.log
  Stop:   ./scripts/start-local.sh stop
────────────────────────────────────────────────────────────────────
EOF
