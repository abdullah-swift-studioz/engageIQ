#!/usr/bin/env bash
set -euo pipefail

echo "==> install"
pnpm install --frozen-lockfile

echo "==> build db and shared first (other packages import their dist)"
pnpm --filter @engageiq/db build
pnpm --filter @engageiq/shared build

echo "==> full build (respects turbo graph)"
pnpm build

echo "==> typecheck"
pnpm type-check

echo "==> api unit tests"
pnpm --filter @engageiq/api test

echo "==> migration status (against the integration DB; must not be drifted)"
pnpm --filter @engageiq/db exec prisma migrate status

echo "preflight OK"
