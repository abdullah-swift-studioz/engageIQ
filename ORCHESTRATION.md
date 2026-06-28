# ORCHESTRATION.md — Running EngageIQ Across Multiple Claude Code Instances

> Read this in full before launching any parallel lane. It is the rulebook for Tier 2
> parallelism (5 to 6 concurrent Claude Code instances). CLAUDE.md is still the base contract.
>
> Goal: finish EngageIQ faster by running several instances at once, each on a different
> slice of the product, without the instances corrupting each other's work or the database.

---

## 1. The mental model

Each instance is a separate process in its own git worktree, on its own branch, with its own ports and its own local database. Instances do not see each other. They are coordinated by exactly two things:

1. A frozen database schema, so no two instances ever fight over `schema.prisma` or migrations.
2. A single integrator (a person or one dedicated instance) who merges finished lanes onto `main` one at a time.

Everything below exists to protect those two invariants. If you remember nothing else: **do not touch the schema in a lane, and do not merge to main in a lane.**

```
                          main (integrator only)
                                 |
        ┌──────────┬─────────────┼─────────────┬──────────┐
   lane/channels  lane/analytics lane/ml  lane/journey  lane/campaigns ...
   (worktree A)   (worktree C)  (wt D)    (worktree E)   (worktree B)
   own files      own files     own svc   own web files  own files
   own DB+Redis   own DB+Redis  own DB    own DB+Redis    own DB+Redis
```

---

## 2. The core principle: freeze the schema first (Phase 0)

The single biggest hazard in this repo is `packages/db/prisma/schema.prisma` plus the migrations folder. It is one file, migrations order lexicographically by folder name, there is no CI, and there is no migration-ownership rule. If multiple instances each run `prisma migrate dev`, they generate independently-named migrations that drift, and Prisma will want to reset the database. (See PROJECT_OVERVIEW.md section 6 and 11.)

The fix is a one-time **schema freeze** done by a single instance before any lane launches:

- One instance (the "schema owner") adds every table, column, and enum that the upcoming lanes will need, in one migration (or a short sequence authored back to back by that one owner).
- That migration is applied once and merged to `main`.
- From then on, lanes build against the frozen schema. Lanes apply migrations with `prisma migrate deploy` (apply only). Lanes never run `prisma migrate dev` and never create migrations.
- If a lane later discovers it genuinely needs a schema change the freeze missed, it STOPS and requests it from the integrator, who routes it through the single schema owner. It is never added inside a lane.

This front-loads all schema contention into one serial step and removes it from the parallel phase entirely. It is the most important thing in this document.

---

## 3. Phase 0 schema-freeze spec (the schema owner executes this)

The schema owner adds the following to `schema.prisma` and generates one migration. Some tables are already fully designed; others need their columns finalized from the feature guide and the relevant lane spec. Tables needing finalization are flagged **[TO-FINALIZE]**: the owner must define their columns before freezing, and must flag any field left as a placeholder in the migration PR description.

Channels lane (already designed in `docs/superpowers/specs/...whatsapp-channel-adapter...`):
- `WhatsAppTemplate`: id, merchantId, name, language (store the Meta language code as a string, for example en, en_US, ur, ar, ar_AE; not a two-value enum), category (UTILITY | MARKETING), bodyText, variableMap (Json; each entry maps `{{n}}` to a profile field AND carries an optional default value), status (DRAFT | PENDING | APPROVED | REJECTED), metaTemplateId?, rejectionReason?, timestamps. `@@unique([merchantId, name, language])`, `@@index([merchantId])`.
- `Message`: id, merchantId, customerId?, channel (Channel), direction (OUTBOUND | INBOUND), templateId?, providerMessageId? (@unique), status (QUEUED | SENT | DELIVERED | READ | FAILED | RECEIVED), errorCode?, errorTitle?, body, toPhone, fromPhone?, journeyEnrollmentId?, campaignId?, sentAt?/deliveredAt?/readAt?/failedAt?, createdAt. Indexed on merchantId, providerMessageId, customerId.
- New enums: MessageDirection, MessageStatus, TemplateStatus, TemplateCategory.
- Add `isSubscribedSms` and `isSubscribedEmail` booleans to `Customer` (WhatsApp opt-in already exists), so the SMS and Email lanes have their suppression flags ready.

Campaign lane:
- `Campaign` already exists. **[TO-FINALIZE]** Add `CampaignRecipient` (or `CampaignSend`): id, merchantId, campaignId, customerId, status, providerMessageId?, timestamps, for per-recipient tracking of one-time blasts. Confirm whether campaign counters on `Campaign` are sufficient or per-recipient rows are needed.

Analytics lane (mostly reads existing data; minimal new schema):
- **[TO-FINALIZE]** Optional `SavedReport` / `FunnelDefinition` / `CohortDefinition` if saved analytics configs are persisted. If analytics are computed on demand and not saved, no new tables are needed. Decide this before freezing.
- **[TO-FINALIZE]** Revenue attribution: decide whether attribution is computed from existing `Message`/`Order`/UTM fields on the fly, or persisted in a `CampaignAttribution` table. The Campaign model already has UTM fields.

ML / AI lane (score columns already exist on Customer and CodOrder):
- `churnScore`, `churnRiskLabel`, `ltv90d/180d/365d`, `fakeOrderScore`, RFM fields already exist. No new columns required to write scores.
- **[TO-FINALIZE]** Optional `ModelRun` audit table (model name, version, run timestamp, row count) and optional `Recommendation` cache table for the product recommendation engine. Add if you want auditability and a rec cache; otherwise skip.
- **[TO-FINALIZE]** Products: there is currently no `Product` Postgres table (catalog is Redis-only). Product-level retention analytics (4.5), recommendations (7.2), and email dynamic blocks all want one. Strongly consider adding a `Product` table in the freeze so multiple lanes are unblocked at once.

Platform lane (only if Lane F is run):
- Courier (8.1) **[TO-FINALIZE]**: `CourierShipment` and `CourierEvent` tables, plus a courier enum (POSTEX | LEOPARDS | TCS | MP).
- Outbound webhooks (8.2) **[TO-FINALIZE]**: `OutboundWebhook` (merchant endpoint config) and `WebhookDelivery` (attempt log) tables.

On-site personalization (6.5, later wave) **[TO-FINALIZE]**: `OnSiteElement` (popup / sticky bar config) table. Not needed in the first wave.

Also during Phase 0, the schema owner adds two pieces of tooling and merges them with the freeze:
- A `db:migrate:deploy` script in `packages/db/package.json` mapped to `prisma migrate deploy` (lanes use this; it applies without creating).
- The preflight gate script in section 10.

After Phase 0 is merged to `main`, the parallel phase can begin.

---

## 4. Roadmap reconciliation (read once, then trust this table)

`roadmap.md` and `memory/context.md` number phases differently. The team skipped roadmap Phase 4 (Analytics Engine) and pulled segmentation and journeys earlier. Use this mapping. `context.md` is authoritative for STATE; `roadmap.md` is the canonical WORK BREAKDOWN.

| Team label (context.md) | Roadmap (canonical) | Status |
|---|---|---|
| Phase 1, 2, 3 (1.1 to 3.3) | Phase 1, 2, 3 | Done |
| "4.1 Segment Builder" | 5.1 Behavioral Segment Builder | Done |
| "4.2 Journey Executor" | 6.2 Journey Execution Engine (entry/exit slice) | Partial |
| (segment evaluation) | 5.2 Dynamic Segment Evaluation | Largely done |
| "Phase 5 / WhatsApp" (current) | 6.3 WhatsApp and SMS Adapters | In progress (design only) |
| not yet started | Phase 4 Analytics Engine (4.1 to 4.5) | Skipped, fully unbuilt |
| not yet started | 6.1 Visual Journey Builder | Unbuilt |
| not yet started | 6.4 Email and COD Verification | Unbuilt |
| not yet started | 5.3 AI Segment Discovery, Phase 7 AI/ML | Unbuilt (needs Python service) |
| not yet started | 8.1 to 8.3 Platform | Unbuilt |

When you assign a lane, refer to the canonical roadmap number so instances are not confused by the team's compressed numbering.

---

## 5. The lanes

Six lanes are defined. They are chosen to maximize independence: each owns its own new files and meets other lanes only at a small number of agreed interfaces. You do not have to run all six at once (see the wave plan in section 12).

### Lane A — Channels and Messaging   (canonical 6.3, then 6.4 email)
- **Builds:** the real WhatsApp Cloud send path behind a `ChannelAdapter` interface, per the approved spec. The `message-dispatch` queue and worker, the WhatsApp webhook route (status + STOP + native opt-out), template CRUD plus Meta submit, Urdu RTL template editor, and the message log / WhatsApp analytics page. SMS and Email start as stubs behind the same interface; Email (6.4) follows in a later wave.
- **Owns:** `apps/api/src/lib/channels/*`, `apps/api/src/workers/message-dispatch.worker.ts`, `apps/api/src/routes/whatsapp-templates/*`, `apps/api/src/routes/webhooks/whatsapp.ts`, `apps/api/src/routes/messages/*`, `apps/web/app/routes/whatsapp-templates.*`, `apps/web/app/routes/messages.*`.
- **Shared contract it owns:** the `ChannelAdapter` interface and the `dispatchChannel` enqueue contract. Define this in `packages/shared/src/types.ts` in Wave 0 so Lane B can build against it.
- **Depends on:** Phase 0 (Message, WhatsAppTemplate tables).

### Lane B — Campaign Engine   (canonical 6.1 campaign side; 6.2 mostly done)
- **Builds:** one-time campaign blasts to a segment. The `campaign-send` worker (currently a queue with no consumer), campaign CRUD routes, scheduling, and the campaign dashboard UI.
- **Owns:** `apps/api/src/workers/campaign-send.worker.ts`, `apps/api/src/routes/campaigns/*`, `apps/web/app/routes/campaigns.*`.
- **Depends on:** Lane A's `ChannelAdapter` / `dispatchChannel` contract (agreed in Wave 0). Builds against the interface; integrates after Lane A. Phase 0 (CampaignRecipient if used).

### Lane C — Analytics Engine   (canonical Phase 4, 4.1 to 4.5)
- **Builds:** the entire skipped analytics phase. Real-time dashboard, funnel analysis, cohort retention, revenue attribution, product retention, COD analytics. The `analytics` worker (queue exists, no consumer) for any precompute, plus analytics routes and dashboard pages. Reads existing ClickHouse and Postgres.
- **Owns:** `apps/api/src/workers/analytics.worker.ts`, `apps/api/src/routes/analytics/*`, `apps/web/app/routes/analytics.*` (and dashboard home widgets).
- **Depends on:** Phase 0 (only if saved-report tables are added). Reads score columns that Lane D writes, but only reads them, so no conflict. Largely independent. Big lane: use Tier 1 subagents inside it for the five sub-areas.

### Lane D — ML / AI Service   (canonical 4.2 RFM, 5.3, 7.1 to 7.3)
- **Builds:** a new Python FastAPI microservice plus the BullMQ scheduled jobs that call it and write scores to existing Postgres columns. RFM scoring engine, churn prediction, LTV prediction, fake-order scoring, AI segment discovery.
- **Owns:** a new top-level service directory (proposed `apps/ml-service/` or `services/ml/`, Python), plus `apps/api/src/workers/scoring.worker.ts` (the Node side that schedules runs and persists results). Writes only to existing score columns on Customer / CodOrder.
- **Depends on:** Phase 0 (only if ModelRun / Product / Recommendation tables are added). Most isolated lane (separate language, separate process). Writes score columns; Lane C reads them.
- **Note:** confirm the service location and that Python lives in the monorepo (it adds no Node deps and no schema changes).

### Lane E — Visual Journey Builder   (canonical 6.1)
- **Builds:** the drag-and-drop journey canvas (React Flow) in the Remix app: node types (Trigger, Action, Condition, Delay, A/B Split), save as JSON graph into `journey_steps`, activate / pause / archive controls. Backend journey execution already largely exists.
- **Owns:** `apps/web/app/routes/journeys.builder.*`, `apps/web/app/components/journey/*`, and minor read-only extensions to the existing journeys route if needed.
- **Depends on:** the existing `ActionStepConfig` contract in `types.ts` (already defined). Frontend-isolated. Meets Lane A only at the action-content shape.

### Lane F — Platform / Integrations   (canonical 8.1 OR 8.2)   [optional sixth lane]
- **Builds:** EITHER courier integrations (PostEx, Leopards, TCS, M&P) with delivery/return triggers, OR the public REST API plus outbound webhooks plus App Store prep. Pick one per wave.
- **Owns:** for courier: `apps/api/src/services/couriers/*`, `apps/api/src/routes/couriers/*`, a `courier-events` worker. For public API: `apps/api/src/routes/public/*`, an `outbound-webhook` worker.
- **Depends on:** Phase 0 (courier or webhook tables).

Lanes not in the first set (run in later waves once the above land): 6.4 Email and COD verification flows (extends Lane A), 6.5 on-site personalization and the 50-plus pre-built flow library, Phase 9 South Asia polish, Phase 10 QA and launch.

---

## 6. Per-instance setup (worktrees, branches, ports, isolation)

Each lane runs in its own git worktree so the instances never share a working directory. Each gets its own ports and its own local Postgres database and Redis logical DB, so workers and seed data never cross.

### 6.1 Allocation table

| Lane | Branch | Worktree path | API PORT | WEB_PORT | Redis DB | Postgres DB |
|---|---|---|---|---|---|---|
| (integrator / main) | `main` | `../engageiq` (primary) | 3001 | 3000 | 0 | engageiq |
| A Channels | `lane/channels` | `../engageiq-channels` | 4001 | 4000 | 1 | engageiq_channels |
| B Campaigns | `lane/campaigns` | `../engageiq-campaigns` | 4011 | 4010 | 2 | engageiq_campaigns |
| C Analytics | `lane/analytics` | `../engageiq-analytics` | 4021 | 4020 | 3 | engageiq_analytics |
| D ML service | `lane/ml` | `../engageiq-ml` | 4031 (Node) / 8000 (Python) | n/a | 4 | engageiq_ml |
| E Journey builder | `lane/journey-builder` | `../engageiq-journey` | 4041 | 4040 | 5 | engageiq_journey |
| F Platform | `lane/platform` | `../engageiq-platform` | 4051 | 4050 | 6 | engageiq_platform |

Redis DB 0 is reserved for the integrator's main checkout. ClickHouse can be shared read-only (`engageiq` database) since these lanes mostly read events; a lane that writes test events should set its own `CLICKHOUSE_DB=engageiq_<lane>`.

### 6.2 Create a lane worktree (run once per lane, from the primary repo with Phase 0 merged)

```bash
# from ../engageiq on an up-to-date main that already includes the Phase 0 freeze
git worktree add ../engageiq-channels -b lane/channels

cd ../engageiq-channels
pnpm install
cp ../engageiq/.env .env     # start from the base env, then edit the per-lane values below

# edit .env for this lane:
#   PORT=4001
#   WEB_PORT=4000           (and API_URL=http://localhost:4001 for the web app)
#   REDIS_URL=redis://localhost:6379/1        (note the /1 logical DB)
#   DATABASE_URL=postgresql://engageiq:engageiq@localhost:5432/engageiq_channels

# create this lane's own Postgres database, then apply the FROZEN migrations (never create)
createdb -h localhost -U engageiq engageiq_channels   # or: psql -c 'CREATE DATABASE engageiq_channels;'
pnpm --filter @engageiq/db build
pnpm --filter @engageiq/db db:migrate:deploy          # apply only; do NOT run db:migrate
pnpm --filter @engageiq/db db:seed
pnpm --filter @engageiq/db ch:setup                   # if this lane touches ClickHouse
```

Repeat per lane with its row from the table. Workers do not bind a port, so multiple worker processes are fine; isolation comes from the separate Redis DB number.

### 6.3 Removing a worktree after its lane is merged

```bash
git worktree remove ../engageiq-channels
git branch -d lane/channels        # after it is merged to main
dropdb engageiq_channels           # optional cleanup
```

---

## 7. Rules of the road (the lane contract every instance follows)

1. **Schema is frozen.** Do not edit `packages/db/prisma/schema.prisma`. Do not run `prisma migrate dev`. Do not create a migration. Use `db:migrate:deploy` to apply. If you truly need a schema change, STOP and request it from the integrator.
2. **Stay in your owned files.** Build inside the paths your lane owns (section 5). Create new files freely there.
3. **Touch shared / high-contention files only by appending.** For the files in the CLAUDE.md contention table (queues.ts, worker.ts, index.ts, types.ts, env.ts, the barrels, roles.ts), add your lines at the END of the relevant block, each wrapped in a `// lane:<name> START` ... `// lane:<name> END` comment pair. Do not reorder or edit other lanes' lines. Append-only-at-end keeps merges trivial.
4. **Interfaces first.** Any contract another lane consumes (the `ChannelAdapter` / `dispatchChannel` contract above all) is defined in Wave 0 and frozen before lanes diverge.
5. **Do not merge to main.** When your lane's milestone is done and its tests pass, commit to your lane branch, write your `updates/` file, and report ready. The integrator merges.
6. **Write only your own updates file.** Do not edit `memory/context.md`. The integrator owns it.
7. **Rebase on request.** When the integrator merges another lane to main, they will ask you to `git rebase main`. Because the schema is frozen, this almost never touches your owned files; conflicts are limited to the appended registry lines and resolve as "keep both."
8. **Respect all CLAUDE.md hard rules.** Tenant scoping, ClickHouse/Postgres boundary, idempotent jobs, response envelope, strict TS, no secrets in code.
9. **No browser claims.** Deploy or finish, run the health check, report the URL. Abdullah verifies in the browser.

---

## 8. The append-only registry protocol (concrete)

When your lane adds a queue, worker, route, type, env var, or export, append it at the end of the shared file inside a tagged block. Example for the channels lane adding the message-dispatch queue:

In `packages/queue/src/queues.ts`, at the end of the queue declarations:
```typescript
// lane:channels START
export const messageDispatchQueue = new Queue('message-dispatch', {
  connection: redisConnection,
  defaultJobOptions,
});
// lane:channels END
```
and at the end of the `QueueName` union:
```typescript
export type QueueName =
  | 'webhook-ingestion'
  | 'backfill'
  | 'segment-evaluate'
  | 'journey-executor'
  | 'campaign-send'
  | 'analytics'
  // lane:channels START
  | 'message-dispatch';
  // lane:channels END
```

In `apps/api/src/worker.ts`, at the end of the worker registrations and inside `shutdown()`:
```typescript
// lane:channels START
const messageDispatchWorker = createMessageDispatchWorker();
messageDispatchWorker.on('completed', (job) => log.info({ jobId: job.id }, 'message-dispatch completed'));
messageDispatchWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'message-dispatch failed'));
messageDispatchWorker.on('error', (err) => log.error({ err }, 'message-dispatch worker error'));
// lane:channels END
// ... and add messageDispatchWorker.close() to the shutdown Promise.all, also inside a lane:channels block
```

The integrator's job at merge time is to confirm these blocks landed at the end and did not interleave with another lane's block. Two lanes appending different trailing blocks usually auto-merge; if git conflicts, the resolution is to keep both blocks in sequence.

---

## 9. Integration protocol (the integrator runs this, one lane at a time)

Only one person or one dedicated instance is the integrator. Never merge two lanes simultaneously.

For each lane that reports ready:
1. On the primary checkout, ensure `main` is up to date.
2. Bring the lane up to date on top of main:
   ```bash
   cd ../engageiq                # primary, on main
   git fetch
   git checkout lane/channels    # or pull the worktree branch
   git rebase main               # resolve any appended-registry conflicts (keep both)
   ```
3. Run the preflight gate (section 10) against a clean integration database. It must pass: build, typecheck, all api tests, and a clean `prisma migrate deploy`.
4. Merge to main:
   ```bash
   git checkout main
   git merge --no-ff lane/channels
   ```
5. Update `memory/context.md`: mark the milestone done, note the lane, record decisions. Write or confirm the lane's `updates/` file is present.
6. Tell the other active lanes to `git rebase main` in their worktrees, so they pick up the new registry lines and any new shared types.

Integrate in dependency order: Phase 0 first, then independent lanes (channels, analytics, ml, journey builder) in any order, then dependent lanes (campaigns after channels). Email/COD (6.4) integrates after channels since it extends Lane A.

---

## 10. The preflight gate (minimum CI, run before every merge)

There is no CI today. Until GitHub Actions is set up (Phase 10, optional to bring forward), this script is the floor. The schema owner adds it in Phase 0 as `scripts/preflight.sh`. The integrator runs it before every merge. Lanes should run it before reporting ready.

```bash
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
```

If you do bring GitHub Actions forward, it is the same steps on push, plus a job that spins up Postgres / ClickHouse / Redis service containers and runs `prisma migrate deploy` against a fresh DB to catch migration drift automatically. That single drift check is the highest-value piece of CI for this project.

---

## 11. Kickoff prompt template (paste one per instance, fill the placeholders)

Start each lane instance with a message like the following. Replace every `{{...}}` placeholder. **Placeholders to fill are flagged; do not leave them in.**

```
You are working on EngageIQ as a single lane in a multi-instance parallel build.

FIRST, run the mandatory startup sequence in CLAUDE.md, then read docs/ORCHESTRATION.md in full.

YOUR LANE: {{LANE_NAME}}            // e.g. Channels and Messaging (canonical roadmap 6.3)
YOUR BRANCH: {{BRANCH}}             // e.g. lane/channels  (you are already in this worktree)
YOUR ROADMAP MILESTONE(S): {{MILESTONES}}   // e.g. 6.3, per roadmap.md and the reconciliation table

FILES YOU OWN (create and edit freely here):
{{OWNED_PATHS}}                     // copy from this lane's "Owns" list in ORCHESTRATION.md section 5

SHARED FILES YOU MAY ONLY APPEND TO (tagged // lane:{{LANE_TAG}} blocks at end):
packages/queue/src/queues.ts, apps/api/src/worker.ts, apps/api/src/index.ts,
packages/shared/src/types.ts, packages/shared/src/index.ts, packages/shared/src/env.ts,
packages/db/src/index.ts, packages/shared/src/roles.ts

FILES YOU MUST NOT TOUCH:
packages/db/prisma/schema.prisma and packages/db/prisma/migrations/  (schema is FROZEN)
Any file owned by another lane.

HARD RULES:
- Do NOT edit the schema or create a migration. Apply existing migrations with db:migrate:deploy only.
- Do NOT merge to main. When done and tests pass, commit to {{BRANCH}}, write your updates/ file, and report ready.
- Do NOT edit memory/context.md.
- Follow all CLAUDE.md hard rules (tenant scoping, ClickHouse/Postgres boundary, idempotent jobs, response envelope, strict TS).
- You cannot test in a browser. Deploy/finish, run the health check, report the URL.

INTERFACE CONTRACT (if your lane shares one):
{{SHARED_CONTRACT}}                 // e.g. ChannelAdapter + dispatchChannel, already defined in types.ts as of Wave 0

THE SPEC FOR THIS WORK:
{{SPEC_PATH_OR_ROADMAP_SECTION}}    // e.g. docs/superpowers/specs/2026-06-26-whatsapp-channel-adapter-design.md

Confirm your understanding first: state your lane, the files you own, the files you will only append to,
and the files you will not touch. Then propose your build order before writing code.
```

---

## 12. Suggested wave plan (you do not have to run all six at once)

Running six instances plus an integrator is a lot to supervise. A calmer, equally fast path is two waves.

**Wave 0 (serial, one instance, then merge to main):**
- Phase 0 schema freeze (section 3).
- Add `db:migrate:deploy` and `scripts/preflight.sh`.
- Define the `ChannelAdapter` / `dispatchChannel` contract in `packages/shared/src/types.ts`.
- Merge to main. Nothing parallel starts before this lands.

**Wave 1 (parallel, the most independent lanes):**
- Lane A Channels, Lane C Analytics, Lane D ML, Lane E Journey Builder.
- Lane B Campaigns can start here against the agreed ChannelAdapter contract, but integrates after Lane A.
- These four-to-five lanes barely overlap: different directories, different DBs, scores written by D and read by C.

**Wave 2 (after Wave 1 integrates):**
- Lane F Platform (courier or public API), 6.4 Email and COD (extends A), 6.5 on-site plus flow library, then Phase 9 polish and Phase 10 QA / launch.

This keeps the number of simultaneous moving parts around four to five, which is the sweet spot for one person integrating, while still collapsing the timeline dramatically versus sequential work.

---

## 13. Decisions you must make before launching (placeholders to resolve)

Flagged so nothing silently defaults:

1. **Lane set:** confirm the six lanes in section 5, or adjust which work runs in Wave 1. [DECISION REQUIRED]
2. **Schema-freeze finalization:** the schema owner must finalize all **[TO-FINALIZE]** tables in section 3 (CampaignRecipient, optional SavedReport/attribution tables, optional ModelRun/Recommendation, the `Product` table decision, and Lane F tables if F runs). Flag every placeholder column in the migration PR. [DECISION REQUIRED]
3. **`Product` table:** decide yes/no on adding a Postgres `Product` table in the freeze. Recommended yes, because it unblocks product retention analytics, recommendations, and email dynamic blocks at once. [DECISION REQUIRED]
4. **ML service location and language:** confirm `apps/ml-service/` (Python FastAPI) in the monorepo. [DECISION REQUIRED]
5. **Local PK SMS aggregator vendor:** still unspecified in the stack. Lane A's SMS path needs it eventually. Pick the vendor or defer SMS to Wave 2. [DECISION REQUIRED]
6. **Integrator:** decide whether Abdullah is the integrator or a dedicated instance is. Only one integrator. [DECISION REQUIRED]
7. **CI:** local `preflight.sh` only for now, or stand up GitHub Actions with the migration-drift check. Local is the floor; the drift check is the highest-value addition. [DECISION REQUIRED]
8. **Ports / DB names:** the section 6 table is a default. Change it if it clashes with anything already running locally. [OPTIONAL]

---

*ORCHESTRATION.md — EngageIQ Project*
*Swift Studioz, Lahore, Pakistan*
*Created: 2026-06-28*
