# CLAUDE.md — EngageIQ Project Instructions

> This file is the single source of authority for how Claude Code operates on this project.
> Read it fully before doing anything. No exceptions.
>
> If you are one of several Claude Code instances running in parallel, this file plus
> `docs/ORCHESTRATION.md` together define the rules. Read both before writing any code.

---

## MANDATORY STARTUP SEQUENCE

Every session, no matter how small the task, begins with this exact sequence. Do not skip steps. Do not assume you remember context from a previous session. You do not have memory across sessions.

```
STEP 1 → Read this file (CLAUDE.md) fully
STEP 2 → Read docs/PROJECT_OVERVIEW.md   (the comprehensive architecture + current-state reference)
STEP 3 → Read memory/context.md          (live state: current phase, completed milestones, blockers, decisions)
STEP 4 → If you are working as part of a parallel lane: read docs/ORCHESTRATION.md fully
STEP 5 → List files in updates/ and read the 3 most recent  (exact recent changes)
STEP 6 → Read the roadmap.md section(s) for your assigned work
STEP 7 → Read packages/db/prisma/schema.prisma for the current schema (it is the schema source of truth)
STEP 8 → Confirm understanding before writing a single line of code. If you are in a lane, state your lane,
         the exact files you own, and the files you must NOT touch (see the contention list below).
```

**Note on missing memory files.** Earlier versions of this file referenced `memory/architecture.md`, `memory/schema.md`, and `memory/env.md`. These do not currently exist. Until they do, use the following as the source of truth instead, and do not block waiting for the missing files:
- Architecture and current state: `docs/PROJECT_OVERVIEW.md`
- Database schema: `packages/db/prisma/schema.prisma`
- Environment variables: `packages/shared/src/env.ts`

**Do not ask "where should I start?" Do not assume. Read first, then tell the user what you understand the current state to be, and propose the next action.**

---

## PROJECT OVERVIEW

**Project:** EngageIQ
**What it is:** A full-stack, multi-tenant SaaS customer engagement platform for Shopify merchants. The CleverTap / Klaviyo equivalent built specifically for South Asian and MENA e-commerce: WhatsApp-first, COD-native, Urdu-capable, multi-store.
**Built by:** Swift Studioz, Lahore, Pakistan
**Owner:** Abdullah Ali (CEO, Swift Studioz)

### Why This Exists

Western engagement platforms (Klaviyo, CleverTap, Omnisend) ignore:
- Cash on Delivery (70 percent or more of Pakistani orders): no COD verification, no fake order scoring
- WhatsApp as primary channel (90 percent or higher open rate vs 18 percent email)
- Urdu language support and RTL rendering
- Multi-store operators running 3 to 10 Shopify stores simultaneously
- PKR pricing (Western minimums are unaffordable for local SMEs)

EngageIQ solves all of this. It is not a clone. It is a market-specific product built for a gap these companies actively ignore.

### Current State (do not hardcode progress here; context.md is authoritative)

The live, authoritative state lives in `memory/context.md`. As of the last overview (commit `16cbd67`, branch `main`):
- Roughly 10 of 38 milestones recorded complete (about 26 percent). The completed work is the data spine: scaffold, auth/RBAC/multi-tenancy, Postgres schema, ClickHouse event store, Shopify OAuth plus webhook ingestion plus backfill, storefront tracking SDK, unified profiles, identity resolution, custom-event API, segment builder/evaluator, and a journey entry/exit executor.
- Almost nothing customer-facing sends or analyzes yet. All outbound channels are a single stub (`apps/api/src/lib/channels/dispatcher.ts`). All ML/AI scores are nullable DB columns with no engine writing them. No analytics dashboard, no campaign engine, no courier integration, no Python ML service.
- Nothing is deployed. No CI. Migrations exist as files but their application state to any DB is unverified.

**Important numbering note.** The team's "Phase 4 / Phase 5" labels in `context.md` do NOT match `roadmap.md`'s numbering. The team resequenced segmentation and journeys earlier and skipped roadmap Phase 4 (Analytics Engine) entirely. The reconciliation table lives in `docs/ORCHESTRATION.md`. Treat `memory/context.md` as authoritative for STATE and `roadmap.md` as the canonical WORK BREAKDOWN, reconciled through ORCHESTRATION.md.

---

## MEMORY & UPDATES SYSTEM

This project uses a structured memory system to give Claude context across sessions. You are responsible for maintaining it.

### Directory Structure

```
memory/
  context.md          ← Live state: phase, completed milestones, blockers, decisions (THE state file)

updates/
  YYYY-MM-DD_phase<N>_<milestone-slug>.md   ← One file per completed milestone
  YYYY-MM-DD_fix_<slug>.md                  ← One file per significant bug fix
  YYYY-MM-DD_decision_<slug>.md             ← One file for significant architectural decisions

docs/
  PROJECT_OVERVIEW.md ← Comprehensive architecture + state reference (read at startup)
  ORCHESTRATION.md    ← Multi-instance parallel execution playbook (read when working a lane)
  roadmap.md          ← The full 38-milestone roadmap (canonical work breakdown; lives at repo root)
  superpowers/        ← plans/ and specs/ from the superpowers planning workflow
```

### memory/context.md — Required Format

```markdown
# EngageIQ — Project Context

**Last Updated:** YYYY-MM-DD
**Current Phase:** Phase N — [Name]
**Current Milestone:** N.X — [Milestone Name]
**Overall Progress:** X of 38 milestones complete

## Completed Milestones

| Milestone | Name | Date Completed |
|---|---|---|
| 1.1 | Project Scaffold & Monorepo Setup | YYYY-MM-DD |
| ... | ... | ... |

## What Was Just Built

[Paragraph: what was built, how it works, what to know about it]

## In Progress

[What is being worked on, what is complete within it, what remains. If multiple lanes are active,
list each lane, its branch, and its current status.]

## Known Issues / Blockers

- [Issue]

## Key Decisions Made

| Decision | Rationale | Date |
|---|---|---|
| ... | ... | ... |

## Environment Warnings

[Env-specific issues, missing vars, docker quirks: things that will bite the next session]
```

### updates/ — Required Format Per File

```markdown
# Update: [Milestone Name]

**Date:** YYYY-MM-DD
**Phase:** N | **Milestone:** N.X | **Lane:** [lane name, if applicable]
**Author:** Claude Code (Session)

## What Was Built
[Detailed description of everything created or modified]

## Files Created / Modified
- `path/to/file.ts` — [what it does]

## Decisions Made This Session
- [Decision and why]

## Deviations from Roadmap
- [Any intentional deviation and why. "None" if there were none.]

## Known Issues Left Open
- [Any open issue, tech debt, or incomplete item. "None" if there were none.]

## What to Do Next
[Exact next step: milestone number and first action]
```

---

## SESSION CLOSING PROTOCOL

This is mandatory. Every session. No exceptions.

After completing any milestone, feature, or significant bug fix:

1. Write the update file to `updates/YYYY-MM-DD_<context>.md`.
2. Update `memory/context.md`: phase, completed milestones, blockers, decisions.
3. Commit your work (see the lane commit rules in ORCHESTRATION.md if you are in a lane).
4. Confirm to the user: "Session closed. updates/ and context.md are current. Safe to end session."

**Single-writer rule for context.md.** When multiple instances run in parallel, only ONE instance (the integrator, per ORCHESTRATION.md) writes `memory/context.md`. Lane instances write their own `updates/` file (unique filename, no collision) and report their summary. The integrator folds lane status into context.md at integration time. This prevents the state file from becoming a contention point.

**If a session ends without this protocol, the next session starts blind. This costs real development time. Do not skip it.**

---

## TECH STACK — NON-NEGOTIABLE

These choices are final. Do not suggest alternatives unless you have discovered a concrete technical blocker that makes the chosen tool impossible to use.

| Layer | Technology | Version / Notes |
|---|---|---|
| Monorepo | pnpm + Turborepo | pnpm@9.1.0, workspaces |
| Backend API | Fastify (Node.js) | TypeScript strict mode |
| Frontend | Remix (React) | Shopify App Bridge compatible |
| ORM | Prisma | PostgreSQL target |
| Primary DB | PostgreSQL 16 | Docker locally, RDS in prod |
| Analytics DB | ClickHouse 24.3 | Columnar, events only, never use for profile data |
| Cache / Queue | Redis 7 + BullMQ | Redis for cache and queue backend |
| Auth | JWT (dashboard) + API Keys (Custom Event API) | |
| Email | AWS SES | Resend as fallback |
| WhatsApp | Meta Cloud API (WhatsApp Business API) | Official, no third-party. Graph API version pinned in env (META_API_VERSION), not hardcoded |
| SMS | Twilio (global) + local PK aggregator | |
| AI / ML | Python microservice (FastAPI) | scikit-learn / XGBoost for RFM/churn/LTV/fake-order. Does not exist yet |
| LLM | Anthropic Claude API | for AI copywriter |
| IVR | Fixerr AI integration | COD verification calls |
| Couriers | PostEx, Leopards, TCS, M&P | PK-specific REST APIs |
| Infra (local) | Docker Compose | postgres + clickhouse + redis |
| Infra (prod) | AWS ECS + RDS + ElastiCache + ClickHouse Cloud | Phase 10, not built |
| CI/CD | GitHub Actions | test, build, deploy. Not built. See ORCHESTRATION.md for the minimum preflight gate |
| Logging | pino (Fastify native) + pino-pretty (dev only) | Structured JSON in prod |
| Error tracking | Sentry | |
| Testing | Vitest (unit), Playwright (E2E), k6 (load) | Vitest configured in apps/api only; E2E/load not set up |

### Package Structure

```
engageiq/
  apps/
    api/          ← Fastify backend (HTTP server + BullMQ workers + processors)
    web/          ← Remix dashboard
  packages/
    db/           ← Prisma client + ClickHouse abstraction layer
    queue/        ← BullMQ queue definitions + shared Redis connection
    shared/       ← Types, env schema, RBAC matrix, constants shared across apps
    sdk/          ← Storefront tracking SDK (vanilla JS IIFE)
  extensions/
    app-embed-block/  ← Shopify App Embed extension (SDK injection)
  memory/         ← Context file (read every session)
  updates/        ← Session update logs (read recent ones every session)
  docs/           ← PROJECT_OVERVIEW, ORCHESTRATION, roadmap, feature guide, superpowers specs
```

---

## SHARED / HIGH-CONTENTION FILES (read this before any parallel work)

These files are touched by almost every feature. They are the collision points when multiple instances run at once. The rule for all of them: **do not scatter edits through these files. Append your additions at the END of the relevant block, tagged with a `// lane:<name>` comment, and let the integrator wire them in.** Append-only-at-end means git can usually auto-merge, and when it cannot, the conflict is a trivial "keep both."

| Concern | Exact path | Rule |
|---|---|---|
| Prisma schema | `packages/db/prisma/schema.prisma` | FROZEN during parallel work. Lanes never edit it. Only the schema owner edits it, and only during the Phase 0 schema freeze (see ORCHESTRATION.md). |
| Migrations | `packages/db/prisma/migrations/` | Lanes never create migrations. Lanes apply existing ones with `prisma migrate deploy` only. Only the schema owner runs `prisma migrate dev`. |
| Env schema | `packages/shared/src/env.ts` (+ `.env`, `.env.example`) | Append new vars at the end, tagged `// lane:<name>`. Keep `.env.example` in sync. |
| Shared types | `packages/shared/src/types.ts` | Append new types/job-payloads at the end, tagged. |
| Shared barrel | `packages/shared/src/index.ts` | Append new re-exports at the end. |
| Queue registry | `packages/queue/src/queues.ts` | Append new `Queue` + `QueueName` union member at the end, tagged. |
| Worker registry | `apps/api/src/worker.ts` | Append new worker instantiation + event handlers + shutdown entry at the end, tagged. |
| Route registry | `apps/api/src/index.ts` | Append new `app.register(...)` at the end of the registration block. (Static-before-wildcard ordering is internal to each route group, so it does not cross lanes.) |
| RBAC matrix | `packages/shared/src/roles.ts` | Append new permissions/roles. |
| DB barrel | `packages/db/src/index.ts` | Append new ClickHouse helper re-exports. |
| Turbo config | `turbo.json` | Build-graph edges. Coordinate with the integrator before editing. |

`packages/shared` has the highest blast radius: changing it forces a rebuild of everything. Treat any shared change as integrator-coordinated.

---

## ARCHITECTURE RULES

These are hard rules. Every line of code must follow them.

### Multi-Tenancy (Critical)

Every database query that touches merchant data MUST be scoped by the resolved tenant id. There are no exceptions. A query that returns data without a resolved tenant id in scope is a critical security bug: it leaks one merchant's data to another. There is no DB-level row-security policy and no Prisma middleware guard, so this is enforced by you, every time.

```typescript
// WRONG — never do this
const customers = await prisma.customer.findMany();

// CORRECT — always scope by the resolved tenant
const customers = await prisma.customer.findMany({
  where: { merchantId: request.user.merchantId },   // API-key routes use request.apiKeyMerchantId
});
```

- Dashboard (JWT) requests: `plugins/authenticate.ts` sets `request.user = { userId, merchantId, role }` and rejects on tenant mismatch or inactive account.
- API-key requests: `plugins/api-key.ts` sets `request.apiKeyMerchantId`.
- Child-of-child tables (`SegmentMembership`, `JourneyStep`, `JourneyEnrollment`) do not carry a direct `merchantId`. They scope through their merchant-owned parent (segment / journey / customer). When you query these directly, join through the parent to stay tenant-safe.

### ClickHouse vs PostgreSQL — Know the Boundary

- **PostgreSQL:** Customer profiles, segments, campaigns, journeys, users, merchants, orders, COD orders, abandoned checkouts, API keys, config. Anything transactional, related, or frequently updated.
- **ClickHouse:** Events only. Append-only, high-volume, never updated. Single table `engageiq.events` plus materialized views. If you need to count events or run time-series queries, ClickHouse. If you need a name or order total, PostgreSQL.
- All ClickHouse access goes through `packages/db/src/clickhouse.ts`. Never import `@clickhouse/client` directly.

### BullMQ Queue Rules

- All webhook processing goes through the `webhook-ingestion` queue. Never process webhooks synchronously in the route handler. Acknowledge immediately (HTTP 200), enqueue, process async.
- All campaign and message sends go through their queue with per-merchant rate limiting. Note: the queue is named `campaign-send` in code. (A `message-dispatch` queue is being added for channel sends; see the channels lane in ORCHESTRATION.md.)
- Every job must be idempotent. Shopify may deliver the same webhook multiple times. Use the Shopify webhook id as the idempotency key.
- Dead-letter handling is required for critical queues. (Currently reliability relies on BullMQ retry plus retention. Explicit DLQs are a known gap. If your lane adds a critical queue, add a DLQ.)

### Standard pattern for a new queue + worker

1. Add `new Queue('name', { connection: redisConnection, defaultJobOptions })` at the END of `packages/queue/src/queues.ts`, and append the literal to the `QueueName` union (tag with `// lane:<name>`).
2. Define the job payload type at the END of `packages/shared/src/types.ts` and re-export from the barrel.
3. Create `apps/api/src/workers/<name>.worker.ts` exporting a `create<Name>Worker()` factory returning a BullMQ `Worker`.
4. Append its instantiation + `completed`/`failed`/`error` handlers + its entry in `shutdown()` at the END of `apps/api/src/worker.ts`.

### API Response Format

```typescript
// Success
{ success: true, data: <payload>, meta?: { page, total, ... } }
// Error
{ success: false, error: { code: string, message: string, details?: any } }
```

### Error Handling

- Never let errors bubble to the Fastify default handler uncaught. Wrap route handlers in try/catch.
- Zod validation on all inputs. On failure, return 400 with the zod error in the standard envelope.
- Never return raw database errors to the client.

### TypeScript

- Strict mode everywhere. No `any`. No `as unknown as X` hacks.
- Use Prisma generated types directly. Never redefine what Prisma already gives you.
- Shared types live in `packages/shared/src/types.ts`. Never duplicate type definitions.

---

## PARALLEL EXECUTION — TWO TIERS

There are two distinct kinds of parallelism on this project. Do not confuse them.

### Tier 1 — Subagents within a single session (up to 4)

A single Claude Code session may spawn up to 4 parallel subagents for independent work inside that one session and one working directory. The session coordinates them and lands their output in a single commit. Collision risk is low because one orchestrator owns the result.

Rules for subagents:
1. Each subagent gets a clearly scoped, isolated set of files. Subagents must not write the same file simultaneously.
2. Define interfaces first. Before two subagents build interacting features, define the shared type in `packages/shared/src/types.ts` and have both code to it.
3. One subagent owns the write-up. Only one writes the `updates/` file; others report their output.
4. Subagents do not make architectural decisions. If one hits a decision not covered by these rules, it stops and reports back.
5. All subagent work lands in a single commit.

### Tier 2 — Multiple Claude Code instances running concurrently (5 to 6)

This is separate processes in separate git worktrees, each on its own branch, each possibly with its own ports and Redis DB, NOT coordinated by a shared orchestrator. This is the high-leverage, high-risk mode, and it is governed entirely by **`docs/ORCHESTRATION.md`**. If you are launched as a lane instance, read that file in full before writing code.

The non-negotiable core rules (full detail in ORCHESTRATION.md):
- **Schema is frozen.** You do not edit `schema.prisma`. You do not run `prisma migrate dev`. You do not create migrations. If your lane genuinely needs a schema change that the Phase 0 freeze missed, you STOP and request it from the integrator. You never add it yourself.
- **Stay in your lane.** You edit only the files your lane owns. You touch the shared/high-contention files only by appending at the end, tagged `// lane:<name>`, per the table above.
- **Interfaces first.** Any contract shared with another lane (for example, the `dispatchChannel` / `ChannelAdapter` contract shared by the channels and campaign lanes) is defined and agreed before lanes diverge.
- **You do not merge to main.** A single integrator merges lanes one at a time after the preflight gate passes. You prepare your branch and report ready.
- **One writer for context.md.** You write your own `updates/` file only.

---

## CODING STANDARDS

### File Naming

```
kebab-case for files:        customer-profile.service.ts
PascalCase for classes:      CustomerProfileService
camelCase for functions:     getCustomerProfile()
SCREAMING_SNAKE for env:     SHOPIFY_API_SECRET
```

### Folder Structure Within apps/api

```
apps/api/src/
  index.ts             ← HTTP server entry + central route registry (append registrations at end)
  worker.ts            ← Worker entry + central worker registry (append workers at end)
  plugins/             ← jwt.ts, authenticate.ts, api-key.ts
  routes/
    customers/  events/  segments/  journeys/   ← folder routes (index/controller/service/schema/test)
    auth.ts  shopify.ts  backfill.ts  sdk.ts     ← single-file routes
  services/            ← cross-route business logic
  processors/          ← Shopify webhook payload processors
  workers/             ← BullMQ worker factories
  lib/
    channels/          ← dispatcher.ts (channel dispatch seam)
    segments/          ← condition-validator.ts, field-registry.ts
```

Route-ordering rule (load-bearing): within a route group, register static and sub-paths BEFORE `/:id` wildcards.

### Commit Message Format

```
feat(phase6.3): whatsapp adapter — real Meta Cloud send behind ChannelAdapter
fix(phase2.2): webhook deduplication — idempotency key collision on rapid duplicate delivery
chore(memory): update context.md after integrating channels lane
refactor(queue): extract rate-limit logic into shared middleware
```

When working a lane, prefix is the same; the integrator squashes or merges per ORCHESTRATION.md.

---

## ENVIRONMENT VARIABLES

### .env Write Permission — FULL ACCESS GRANTED

Claude Code has full, unrestricted permission to read, create, and modify all `.env` files in this project (`.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test`, and any `apps/*` or `packages/*` env files). You do not need to ask before editing them. When a new service is integrated or a new var is required, just write it.

Responsibilities:
- Add a comment above each new variable explaining what it is and where to get the value.
- Never write a real production secret into a committed `.env`. Use a placeholder like `your-secret-here` and note it must be replaced.
- Keep `.env.example` in sync. Whenever you add a var to `.env`, add the key (with placeholder) to `.env.example`.
- `.env` files are gitignored. Never remove them from `.gitignore`. Never stage a `.env` file.

Format:
```bash
# [What this is] — [Where to get it / how to generate it]
VARIABLE_NAME=value
```

**The validated env module is at `packages/shared/src/env.ts`** (Zod-validated on startup; the app exits with a clear error if a required var is missing). Do not hardcode any value that belongs in an env var.

Known startup gotchas (from context.md):
- `JWT_SECRET` and `JWT_REFRESH_SECRET` must each be 32 chars or longer, or the app exits at startup.
- `SENTRY_DSN=` with an empty value fails Zod `url()`. Keep it blank/commented.
- `pino-pretty` must be present in `apps/api` (it is required by the dev logger transport).
- There is no `API_URL` in `.env.example`. The web app defaults to `http://localhost:3001`. If you change the API port for a lane, set `API_URL` accordingly (see ORCHESTRATION.md port table).

---

## WHAT TO NEVER DO

These are hard stops. If you find yourself about to do any of these, stop and ask the user first.

- Never drop or truncate a database table without explicit user confirmation stating the table name.
- Never commit secrets, API keys, or passwords. If you find one in the codebase, flag it immediately and add it to `.gitignore`, then remove it from history.
- Never mark a milestone complete in `context.md` unless all its deliverables are done. Partial completion is "In Progress" with what remains listed.
- Never change the tech stack without explicit approval from Abdullah.
- Never push directly to `main` without the full commit message format. In Tier 2 parallel mode, lane instances never merge to main at all; the integrator does.
- Never write a query without tenant scoping on any table that stores merchant data.
- Never process a Shopify webhook synchronously in the route handler. Always enqueue.
- Never query ClickHouse for profile data, or PostgreSQL for raw event analytics.
- Never edit `schema.prisma` or create a migration while in a parallel lane. Request the change from the integrator.
- Never skip the Session Closing Protocol.

---

## HOW TO HANDLE UNCERTAINTY

1. Read `docs/PROJECT_OVERVIEW.md`: the answer about architecture or current state may already be there.
2. Read the relevant section of the feature guide (`EngageIQ_Feature_Guide.md`): the product spec is detailed.
3. Read the relevant milestone in `roadmap.md`: the deliverables are explicit.
4. If you are in a lane, read your lane's section in `docs/ORCHESTRATION.md`.
5. If still unsure: stop and ask Abdullah. Do not guess on architectural decisions. Propose two options with clear tradeoffs.

Never make a significant architectural decision silently. Document any new decision in your `updates/` file and mention it to the user.

---

## NOTE ON BROWSER VERIFICATION

Claude Code sessions cannot open a browser or do browser testing. After you deploy or finish a feature, do not claim browser verification. Deploy, run the health check, and report the health check URL. Abdullah performs browser verification himself.

---

## QUICK REFERENCE

```
Read first                  CLAUDE.md → PROJECT_OVERVIEW.md → context.md → (ORCHESTRATION.md if in a lane)
Read recent updates         updates/ — last 3 files by date
Schema source of truth      packages/db/prisma/schema.prisma  (memory/schema.md does not exist)
Env source of truth         packages/shared/src/env.ts
Build a feature             Follow the milestone in roadmap.md; if in a lane, stay inside owned files
Close session               Write updates/ file → (integrator updates context.md) → commit
Subagents per session       Up to 4 (Tier 1)
Concurrent instances        5 to 6 (Tier 2) — governed by ORCHESTRATION.md; schema frozen; one integrator
Never                       Tenant-less queries; sync webhook processing; editing schema.prisma in a lane;
                            skipping session closing protocol
If uncertain                Read docs → read overview → ask Abdullah
```

---

*CLAUDE.md — EngageIQ Project*
*Swift Studioz, Lahore, Pakistan*
*Last updated: 2026-06-28*
