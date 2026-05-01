# Phase 1 — Milestone 1.1: Project Scaffold & Monorepo Setup

**Date:** 2026-04-27
**Status:** Complete

## What Was Built

### Monorepo Structure (pnpm workspaces + Turborepo)
```
engageIQ/
├── apps/
│   ├── api/          — Fastify backend (Node.js, TypeScript)
│   └── web/          — Remix frontend (React, Tailwind CSS)
├── packages/
│   ├── db/           — Prisma (PostgreSQL) + ClickHouse client
│   ├── queue/        — BullMQ queues + Redis connection
│   └── shared/       — Zod env validation + shared types
├── docker-compose.yml
├── turbo.json
├── tsconfig.base.json
├── .eslintrc.js
├── .prettierrc
└── .env.example
```

### Key Files
- `packages/shared/src/env.ts` — Zod schema validates all env vars at startup; process.exit(1) on any missing required var
- `packages/db/src/clickhouse.ts` — ClickHouse abstraction layer (`insertEvent`, `queryEvents`, `createEventsTable`); rest of app never imports @clickhouse/client directly
- `packages/db/src/prisma.ts` — Singleton PrismaClient with global caching for dev hot-reload
- `packages/queue/src/queues.ts` — All BullMQ queues defined: webhook-ingestion, backfill, campaign-send, journey-executor, analytics
- `apps/api/src/index.ts` — Fastify app with helmet, cors, sensible; structured JSON logging; /health endpoint
- `apps/web/` — Remix v2 with Vite plugin, Tailwind CSS, Inter font

### Docker Compose Services
| Service    | Image                            | Port       |
|------------|----------------------------------|------------|
| PostgreSQL | postgres:16-alpine               | 5432       |
| ClickHouse | clickhouse/clickhouse-server:24.3| 8123, 9000 |
| Redis      | redis:7-alpine                   | 6379       |

All services have healthchecks. ClickHouse is partitioned by `toYYYYMM(timestamp)`, ordered by `(merchant_id, customer_id, timestamp)` as specified in the roadmap.

## Decisions Made
- **pnpm workspaces + Turborepo** over Nx — simpler, faster, sufficient for this scale
- **Remix v2 with Vite** over Next.js — better SSR control, smaller bundle, aligns with Fastify-first backend
- **Prisma** over Drizzle — better DX for complex relations; Milestone 1.2 will add full schema
- **Node16 module resolution** for all packages to enforce explicit `.js` extensions in imports
- **Branded types** (`MerchantId`, `CustomerId`) in shared/types.ts to prevent cross-tenant ID confusion at the type level
- ClickHouse `TTL timestamp + INTERVAL 2 YEAR` added to the events table — saves storage cost without config
- Tailwind brand color palette defined (`brand-*`) with PKR-market color conventions in mind

## Known Issues / Deviations
- `packages/db/prisma/schema.prisma` is a stub — no tables yet; full schema is Milestone 1.2
- `prettier-plugin-tailwindcss` listed in `.prettierrc` but lives in `apps/web/` devDeps — root prettier invocation will need it installed at root or scoped per-package; address when running format for the first time
- `pino-pretty` referenced in `apps/api/src/index.ts` but not in package.json — add as devDependency before first `dev` run

## Next Milestone
**1.2 — Database Schema (PostgreSQL):** Add all Prisma models, run migrations, seed test data.
