# CLAUDE.md — EngageIQ Project Instructions

> This file is the single source of authority for how Claude Code operates on this project.
> Read it fully before doing anything. No exceptions.

---

## MANDATORY STARTUP SEQUENCE

Every single session — no matter how small the task — begins with this exact sequence. Do not skip steps. Do not assume you remember context from a previous session. You do not have memory across sessions.

```
STEP 1 → Read memory/context.md          (current phase, decisions, blockers)
STEP 2 → Read memory/architecture.md     (stack, patterns, constraints)
STEP 3 → Read memory/schema.md           (current DB schema state)
STEP 4 → List files in updates/          (see what has changed recently)
STEP 5 → Read the 3 most recent files in updates/  (understand exact current state)
STEP 6 → Read the roadmap (docs/roadmap.md) section for the current phase
STEP 7 → Confirm your understanding before writing a single line of code
```

If any of these files do not exist yet, say so immediately and create them with the correct structure before proceeding.

**Do not ask "where should I start?" Do not assume. Read first, then tell the user what you understand the current state to be, and propose the next action.**

---

## PROJECT OVERVIEW

**Project:** EngageIQ
**What it is:** A full-stack, multi-tenant SaaS customer engagement platform for Shopify merchants. The CleverTap / Klaviyo equivalent built specifically for South Asian and MENA e-commerce — WhatsApp-first, COD-native, Urdu-capable, multi-store.
**Built by:** Swift Studioz, Lahore, Pakistan
**Owner:** Abdullah Ali (CEO, Swift Studioz)

### Why This Exists

Western engagement platforms (Klaviyo, CleverTap, Omnisend) ignore:
- Cash on Delivery (70%+ of Pakistani orders) — no COD verification, no fake order scoring
- WhatsApp as primary channel (90%+ open rate vs 18% email)
- Urdu language support and RTL rendering
- Multi-store operators running 3–10 Shopify stores simultaneously
- PKR pricing (their minimums are unaffordable for local SMEs)

EngageIQ solves all of this. It is not a clone — it is a market-specific product built for a gap these companies actively ignore.

### Current Progress

- **Phases 1 and 2: COMPLETE** (8 of 38 milestones done — 21%)
- **Phase 3: IN PROGRESS** — Starting at Milestone 3.1
- Next task: Profile Aggregation and Real-Time Updates (3.1)

---

## MEMORY & UPDATES SYSTEM

This project uses a structured memory system to give Claude context across sessions. You are responsible for maintaining it religiously.

### Directory Structure

```
memory/
  context.md          ← Current state: phase, completed milestones, blockers, decisions
  architecture.md     ← Stack, patterns, naming conventions, non-negotiable constraints
  schema.md           ← Current DB schema (PostgreSQL + ClickHouse), updated after every schema change
  env.md              ← All required environment variables and their purpose (no values, just keys)

updates/
  YYYY-MM-DD_phase<N>_<milestone-slug>.md   ← One file per completed milestone
  YYYY-MM-DD_fix_<slug>.md                  ← One file per significant bug fix
  YYYY-MM-DD_decision_<slug>.md             ← One file for significant architectural decisions

docs/
  roadmap.md          ← The full 38-milestone roadmap (do not modify unless roadmap changes)
  feature-guide.md    ← Full feature spec (read when building any feature)
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
| 1.2 | Database Schema (PostgreSQL) | YYYY-MM-DD |
| ... | ... | ... |

## What Was Just Built

[Paragraph describing the most recently completed milestone — what was built, how it works, what to know about it]

## In Progress

[What is currently being worked on, what is complete within it, what remains]

## Known Issues / Blockers

- [Issue 1]
- [Issue 2]

## Key Decisions Made

| Decision | Rationale | Date |
|---|---|---|
| Using ClickHouse for events (not Postgres) | Columnar DB required for fast event queries at scale | YYYY-MM-DD |
| BullMQ over native Redis pub/sub | Retry logic, dead letter queues, concurrency control | YYYY-MM-DD |
| ... | ... | ... |

## Environment Warnings

[Any environment-specific issues, missing vars, docker quirks — things that will bite the next session]
```

### updates/ — Required Format Per File

```markdown
# Update: [Milestone Name]

**Date:** YYYY-MM-DD
**Phase:** N | **Milestone:** N.X
**Author:** Claude Code (Session)

## What Was Built

[Detailed description of everything created or modified]

## Files Created / Modified

- `path/to/file.ts` — [what it does]
- `path/to/other.ts` — [what it does]

## Decisions Made This Session

- [Decision and why]

## Deviations from Roadmap

- [Any intentional deviation from the spec and why]
- None — if there were none.

## Known Issues Left Open

- [Any open issue, tech debt, or incomplete item]
- None — if there were none.

## What to Do Next

[Exact next step — milestone number and first action]
```

---

## SESSION CLOSING PROTOCOL

**This is mandatory. Every session. No exceptions.**

After completing any milestone, feature, or significant bug fix:

1. Write the update file to `updates/YYYY-MM-DD_<context>.md`
2. Update `memory/context.md` — phase, completed milestones, blockers, decisions
3. Update `memory/schema.md` if any DB schema changed
4. Update `memory/architecture.md` if any architectural pattern was established or changed
5. Run `git add -A && git commit -m "feat(phaseN.X): [milestone name] — [one line summary]"`
6. Confirm to the user: "Session closed. memory/ and updates/ are current. Safe to end session."

**If a session ends without this protocol, the next session starts blind. This costs real development time. Do not skip it.**

---

## TECH STACK — NON-NEGOTIABLE

These choices are final. Do not suggest alternatives unless you have discovered a concrete technical blocker that makes the chosen tool impossible to use.

| Layer | Technology | Version / Notes |
|---|---|---|
| Monorepo | pnpm + Turborepo | pnpm workspaces |
| Backend API | Fastify (Node.js) | TypeScript strict mode |
| Frontend | Remix (React) | Shopify App Bridge compatible |
| ORM | Prisma | PostgreSQL target |
| Primary DB | PostgreSQL | Via Docker locally, RDS in prod |
| Analytics DB | ClickHouse | Columnar, events only — never use for profile data |
| Cache / Queue | Redis + BullMQ | Redis for cache and queue backend |
| Auth | JWT (dashboard) + API Keys (Custom Event API) | |
| Email | AWS SES | Resend as fallback |
| WhatsApp | Meta Cloud API (WhatsApp Business API) | Official, no third-party |
| SMS | Twilio (global) + local PK aggregator | |
| AI / ML | Python microservice (FastAPI) | scikit-learn for RFM/churn |
| LLM | Anthropic Claude API | claude-sonnet-4-20250514 for copywriter |
| IVR | Fixerr AI integration | COD verification calls |
| Couriers | PostEx, Leopards, TCS, M&P | PK-specific REST APIs |
| Infra (local) | Docker Compose | All services |
| Infra (prod) | AWS ECS + RDS + ElastiCache + ClickHouse Cloud | |
| CI/CD | GitHub Actions | test → build → deploy |
| Logging | pino (Fastify native) + pino-pretty (dev only) | Structured JSON in prod |
| Error tracking | Sentry | |
| Testing | Vitest (unit), Playwright (E2E), k6 (load) | |

### Package Structure

```
engageiq/
  apps/
    api/          ← Fastify backend
    web/          ← Remix dashboard
  packages/
    db/           ← Prisma client + ClickHouse abstraction layer
    queue/        ← BullMQ queue definitions and worker base
    shared/       ← Types, constants, utilities shared across apps
  memory/         ← Context files (read every session)
  updates/        ← Session update logs (read recent ones every session)
  docs/           ← Roadmap, feature guide, architecture docs
```

---

## ARCHITECTURE RULES

These are hard rules. Every line of code must follow them.

### Multi-Tenancy (Critical)

Every database query that touches merchant data MUST include a `merchant_id` WHERE clause. There are no exceptions. A query that returns data without a resolved `merchant_id` in scope is a critical security bug — it will leak one merchant's data to another.

```typescript
// WRONG — never do this
const customers = await prisma.customer.findMany();

// CORRECT — always scope by merchant
const customers = await prisma.customer.findMany({
  where: { merchant_id: ctx.merchant_id }
});
```

The multi-tenant middleware resolves `merchant_id` from the JWT or API key on every request and attaches it to `request.merchant_id`. Always use it.

### ClickHouse vs PostgreSQL — Know the Boundary

- **PostgreSQL:** Customer profiles, segments, campaigns, journeys, users, merchants, COD orders, config. Anything that has transactions, relationships, or is updated frequently.
- **ClickHouse:** Events only. `page_view`, `product_view`, `add_to_cart`, etc. High-volume, append-only, never updated. If you need to count events or do time-series queries, ClickHouse. If you need a customer's name or order total, PostgreSQL.

Never query ClickHouse for non-event data. Never store events in PostgreSQL.

### BullMQ Queue Rules

- All webhook processing goes through the `webhook-ingestion` queue. Never process webhooks synchronously in the route handler. Acknowledge immediately (HTTP 200), enqueue, process async.
- All campaign sends go through the `campaign-execution` queue with per-merchant rate limiting.
- Every job must be idempotent. Shopify may deliver the same webhook multiple times. Use the Shopify webhook ID as the idempotency key.
- Dead letter queues must be configured for all critical queues.

### API Response Format

All API responses follow this envelope:
```typescript
// Success
{ success: true, data: <payload>, meta?: { page, total, ... } }

// Error
{ success: false, error: { code: string, message: string, details?: any } }
```

### Error Handling

- Never let errors bubble to the Fastify default handler uncaught.
- All route handlers are wrapped in try/catch.
- Zod validation on all inputs. If validation fails, return 400 with the zod error formatted into the standard envelope.
- Never return raw database errors to the client — they may expose schema details.

### TypeScript

- Strict mode everywhere. No `any`. No `as unknown as X` hacks.
- All Prisma generated types are used directly — never redefine what Prisma already gives you.
- Shared types live in `packages/shared/types/`. Never duplicate type definitions.

---

## PARALLEL AGENT USAGE

Claude Code is authorized to spawn **up to 4 parallel subagents** simultaneously when the work is parallelizable. This is encouraged — do not work sequentially when tasks are independent.

### When to Use Parallel Agents

Use parallel agents when:
- Building two or more API endpoints that don't depend on each other
- Writing tests for a feature while another agent implements a different feature
- Running database migrations while another agent scaffolds the route handlers
- Building the frontend page while another agent builds the API it will call
- Multiple isolated utility functions or services that don't share state

### Rules for Parallel Agents

1. **Each agent gets a clearly scoped, isolated task** — define the exact files each agent will touch before spawning. Agents must not write to the same file simultaneously.
2. **Define interfaces first** — before spawning agents for two features that will interact, define the shared interface/type in `packages/shared/types/` first. Both agents then code to the interface.
3. **One agent owns memory updates** — only one agent writes to `memory/` and `updates/` per session. The others report their output; the primary agent writes the summary.
4. **Agents do not make architectural decisions** — if a subagent encounters a decision point that isn't covered by existing architecture rules, it stops and reports back rather than deciding unilaterally.
5. **All agent work lands in a single commit** — coordinate output from all agents before committing.

### Example: Building Milestone 3.1 in Parallel

```
Agent 1: Build GET /api/v1/customers/:id route + controller + service layer
Agent 2: Build the computed fields sync logic (event listener → profile update)
Agent 3: Build the Remix dashboard customer detail page (using mock data initially)
Agent 4: Write Vitest unit tests for the profile aggregation logic
```

These four are independent. Agent 1 and 2 can be merged first; Agent 3 switches to real API once Agent 1 is done; Agent 4 tests what Agent 2 builds.

---

## CODING STANDARDS

### File Naming

```
kebab-case for files:        customer-profile.service.ts
PascalCase for classes:      CustomerProfileService
camelCase for functions:      getCustomerProfile()
SCREAMING_SNAKE for env:     SHOPIFY_API_SECRET
```

### Folder Structure Within apps/api

```
apps/api/src/
  routes/
    customers/
      index.ts         ← Route definitions (Fastify plugin)
      controller.ts    ← Request/response handling
      service.ts       ← Business logic
      schema.ts        ← Zod input/output schemas
  middleware/
    auth.ts
    tenant.ts
    rate-limit.ts
  workers/
    webhook.worker.ts
    campaign.worker.ts
  lib/
    shopify.ts
    whatsapp.ts
    clickhouse.ts      ← Re-exported from packages/db — do not import clickhouse directly
```

### Commit Message Format

```
feat(phase3.1): customer profile API — GET /customers/:id with full computed fields
fix(phase2.2): webhook deduplication — idempotency key collision on rapid duplicate delivery
chore(memory): update context.md after completing milestone 3.1
refactor(queue): extract rate-limit logic into shared middleware
```

---

## ENVIRONMENT VARIABLES

### .env Write Permission — FULL ACCESS GRANTED

Claude Code has **full, unrestricted permission to read, create, and modify all `.env` files** in this project. This includes:

- `.env` (root)
- `.env.local`
- `.env.development`
- `.env.production`
- `.env.test`
- Any `apps/*/` or `packages/*/.env` files

You do not need to ask permission before editing `.env` files. You do not need to confirm before adding, changing, or removing variables. When a new service is integrated, a new var is required, or a stub value needs updating — **just write it.**

Responsibilities that come with this permission:
- Always add a comment above each new variable explaining what it is and where to get the value.
- Never write a real production secret into a `.env` file that is committed to git — use a placeholder like `your-secret-here` and note that it must be replaced.
- Keep `.env.example` in sync — whenever you add a var to `.env`, add the key (with placeholder value) to `.env.example`. This is how other developers know what vars are required.
- `.env` files are in `.gitignore`. Never remove them from `.gitignore`. Never stage a `.env` file in a git commit.

**Format for every variable you write:**

```bash
# [What this is] — [Where to get it / how to generate it]
VARIABLE_NAME=value
```

Example:
```bash
# Shopify App API key — found in Shopify Partner Dashboard under your app
SHOPIFY_API_KEY=your-shopify-api-key-here

# JWT signing secret — generate with: openssl rand -base64 32
JWT_SECRET=your-jwt-secret-here
```

---

**Do not hardcode any value that belongs in an env var.** All config goes through the validated env module at `apps/api/src/config/env.ts` (Zod-validated on startup — app crashes with a clear error if a required var is missing).

Known required vars (see `memory/env.md` for the full current list):

```
# Database
DATABASE_URL
CLICKHOUSE_HOST / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD / CLICKHOUSE_DB

# Redis
REDIS_URL

# Auth
JWT_SECRET
API_KEY_SALT

# Shopify
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL

# Channels
META_WHATSAPP_TOKEN
META_PHONE_NUMBER_ID
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
AWS_SES_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

# AI
ANTHROPIC_API_KEY

# App
NODE_ENV
PORT
LOG_LEVEL
```

**Known issue:** `.env` must have stub SHOPIFY_* values for local dev or the app exits on startup. See `memory/env.md` for the current stub values safe for local use.

---

## KNOWN OPEN ISSUES (As of Project Start for Phase 3)

These were documented at the end of Phase 2 and must be resolved before or during Phase 3:

1. `pino-pretty` is missing from `package.json` — add to `apps/api` devDependencies before first dev run in any new session.
2. `.env` needs stub `SHOPIFY_*` values for local dev — app exits on startup without them. Check `memory/env.md`.
3. No live DB yet for new machines — run `pnpm db:migrate` inside `packages/db` after `docker compose up -d`.
4. `/dashboard` OAuth redirect target does not exist yet — first frontend work starts in Phase 3 (Milestone 3.1 dashboard page).

Check `memory/context.md` for the current up-to-date known issues list — this section reflects the state at the start of Phase 3 and will become stale.

---

## WHAT TO NEVER DO

These are hard stops. If you find yourself about to do any of these, stop and ask the user first.

- **Never drop or truncate a database table** without explicit user confirmation stating the table name.
- **Never commit secrets, API keys, or passwords** to the repository. If you find one in the codebase, flag it immediately and add it to `.gitignore` + remove from git history.
- **Never modify `memory/context.md` to mark a milestone complete unless all its deliverables are done.** Partial completion is recorded as "In Progress" with what remains listed.
- **Never change the tech stack** (replace Fastify with Express, Prisma with Drizzle, etc.) without first getting explicit approval from Abdullah. Document the reason and get a yes before touching it.
- **Never push directly to `main`** without the full commit message format above.
- **Never write a query without `merchant_id` scoping** on any table that stores merchant data.
- **Never process a Shopify webhook synchronously** in the route handler. Always enqueue.
- **Never query ClickHouse for profile data** or PostgreSQL for raw event analytics.
- **Never skip the Session Closing Protocol** at the end of a session.
- **Never store the Anthropic API key, Shopify API secret, or any credential in code.** Environment variables only.

---

## HOW TO HANDLE UNCERTAINTY

When you are unsure about an architectural decision, a product requirement, or which direction to take:

1. Read `memory/architecture.md` — the answer may already be there.
2. Read the relevant section of `docs/feature-guide.md` — the product spec is detailed.
3. Read the relevant milestone in `docs/roadmap.md` — the deliverables are explicit.
4. If still unsure: **stop and ask Abdullah.** Do not guess on architectural decisions. Propose two options with clear tradeoffs and ask which to take.

Never make a significant architectural decision silently. If you made a decision that isn't covered by existing rules, document it immediately in `memory/architecture.md` under "Decisions" and mention it to the user.

---

## PHASE 3 — WHAT TO BUILD NEXT

**Current milestone: 3.1 — Profile Aggregation and Real-Time Updates**

Deliverables:
- Customer profile object matches the full schema (Identity, Shopify Data, Behavioral Data, RFM Scores, AI Scores, COD Profile, Campaign Engagement, Segment Memberships)
- Computed fields (total_orders, total_spent, avg_order_value, last_seen_at, session_count, etc.) stay in sync as new events and webhooks arrive
- `GET /api/v1/customers/:id` — returns the full enriched profile object
- Dashboard customer detail page in Remix — renders every profile field (design doesn't matter yet, correctness does)
- Update file: `updates/YYYY-MM-DD_phase3_profile-aggregation.md`

**Good parallel agent split for 3.1:**
- Agent 1: Profile service + `GET /api/v1/customers/:id` route
- Agent 2: Event listener that updates computed fields on incoming events
- Agent 3: Remix customer detail page
- Agent 4: Unit tests for profile aggregation logic

After 3.1 is complete, move to 3.2 (Identity Resolution) then 3.3 (Custom Event API + Multi-Store Unification), then begin Phase 4.

---

## QUICK REFERENCE

```
Read memory first           memory/context.md, memory/architecture.md, memory/schema.md
Read recent updates         updates/ — last 3 files by date
Build                       Follow milestone spec in docs/roadmap.md
Close session               Write updates/ file → update memory/ → git commit
Max parallel agents         4 — use them for independent work
Never skip                  Merchant ID scoping, BullMQ for webhooks, session closing protocol
If uncertain                Read docs → read memory → ask Abdullah
```

---

*CLAUDE.md — EngageIQ Project*
*Swift Studioz, Lahore, Pakistan*
*Last updated: 2026-05-02*
