# Update: Wave 1 Integration — Channels, Analytics, ML, Journey Builder, Campaigns

**Date:** 2026-06-28
**Phase:** Integration | **Milestone:** Wave-1 merge of 5 parallel lanes | **Lane:** Integrator
**Author:** Claude Code (Session — "EngageIQ Instance 1")

## What Was Built

All five Wave-1 lanes were merged into `main`, in dependency order, each gated by
`scripts/preflight.sh` plus a manual server boot-check (`/health` = 200). Before any
lane merged, three **pre-existing, stacked boot blockers** had to be fixed on `main`
— the API had never actually booted, and `preflight.sh` doesn't start the server so
it passed despite this.

### Step 0 — boot restoration on `main` (3 commits)
1. `0d92620` — `@fastify/rate-limit` `^10`→`^9` (the one blocker the lanes flagged).
2. `122df48` — `@fastify/jwt` `^10`→`^8`. v10 needs Fastify 5; the app is Fastify 4.
   Only the stable jwt API (register/sign/verify/jwtVerify) is used → behavior-neutral.
   Pre-existing since the first commit.
3. `7141af1` — converted 6 plugins/routes from an **invalid sync-`void` Fastify
   signature** (`authenticate`, `api-key`, `auth`, `shopify`, `backfill`, `sdk`) to
   `async`. Per avvio 8.4.0, a plugin completes only if it calls `done` or returns a
   promise-like; these did neither → `AVV_ERR_PLUGIN_EXEC_TIMEOUT` and the server
   never reached `app.listen()`. Verified against the avvio source + a live boot.

All three were masked by preflight never booting. **Boot-check confirmed `/health`=200
after the fix and after every subsequent merge.**

### Lane merges (in order)
1. **Channels** (`af5c425`) — WhatsApp Cloud adapter, message-dispatch queue+worker,
   WhatsApp webhook, template CRUD, message log. Boot-check exposed a 4th sync-void
   route the lane introduced — `whatsappWebhookRoutes` — fixed on `main` (`11a8f83`).
2. **Analytics** (`4804d1c`) — real-time dashboard, funnel, cohort, attribution,
   product retention, COD analytics + analytics worker + web pages.
3. **ML** (`79e6cc3`) — Python FastAPI service (`apps/ml-service`) + scoring worker +
   scoring queue; RFM/churn/LTV/fake-order/recommendations/segment-discovery. Writes
   existing score columns + Recommendation/ModelRun rows (no schema change).
4. **Journey Builder** (`4c3cee9`) — React Flow drag-and-drop canvas + graph persistence.
5. **Campaigns** (`a0f3d3c`) — one-time blasts to a segment, campaign-send worker,
   CRUD + scheduling + dashboard. Depends on Channels' message-dispatch queue.

## Files Created / Modified (integrator-authored)
- `apps/api/package.json` + `pnpm-lock.yaml` — `@fastify/jwt` `^8` pin (`@fastify/rate-limit`
  `^9` was already on `main`).
- `apps/api/src/plugins/{authenticate,api-key}.ts`, `apps/api/src/routes/{auth,shopify,backfill,sdk}.ts`,
  `apps/api/src/routes/webhooks/whatsapp.ts` — sync-`void` → `async` (boot fix).
- `apps/api/src/workers/message-dispatch.worker.ts` (+ `.test.ts`) — **Lane A⇄B last-mile fix**:
  flip `CampaignRecipient` PENDING→SENT/FAILED/SKIPPED and stamp `messageId` (see below).
- Append-block conflict resolutions (always keep-both) in: `apps/api/src/index.ts`,
  `apps/api/src/worker.ts`, `packages/queue/src/{index,queues}.ts`, `packages/shared/src/{index,types}.ts`.

## Conflicts Resolved
Every rebase conflict was a `// lane:<name> START/END` append-block → resolved **keep-both**,
preserving each lane's tagged block in sequence. The only non-pure-append touch was the
worker.ts "[workers] started — … queues" log string, merged to list every queue.
- Channels, Journey Builder: rebased **clean** (no conflicts).
- Analytics: `index.ts`, `worker.ts`.
- ML: `index.ts`, `worker.ts`, `packages/queue/src/{index,queues}.ts`, `packages/shared/src/types.ts`.
- Campaigns: `index.ts`, `worker.ts`, `packages/shared/src/{index,types}.ts`.
No schema-touching rebase occurred; no genuine logic conflict (all keep-both).

## Decisions Made This Session
- **Aborted a pre-staged channels merge.** `main` arrived with an uncommitted, paused
  `--no-ff` merge of channels (MERGE_HEAD set). Verified it was reproducible from
  `lane/channels` (only diff = the rate-limit fix), aborted it, and redid the merges
  cleanly per the prescribed rebase→preflight→`--no-ff` flow. [confirmed with Abdullah]
- **`@fastify/jwt` → `^8`** and **6+1 sync-void → async**: required to reach `/health`=200;
  both behavior-neutral. [confirmed with Abdullah]
- **CampaignRecipient flip implemented now** (not deferred): the campaign-send worker
  creates recipients PENDING and tags `campaignRecipientId` on each MessageDispatchJob,
  but the channels worker only stamped `Message.campaignId` and never flipped the
  recipient — so per-recipient status/`messageId` were dead. Now: success→SENT+messageId,
  permanent fail→FAILED+messageId, consent/stub skip→SKIPPED, rate-limit/retryable→left
  PENDING. Tenant-scoped + idempotent, non-campaign sends no-op. +4 tests. [confirmed with Abdullah]
- **`defaultDispatch` left as-is.** Campaigns uses its own local `Queue('message-dispatch')`
  singleton, not Channels' exported `messageDispatchQueue`. Repointing is NOT behavior-neutral
  (the exported handle carries `defaultJobOptions` attempts:3+backoff; the local one uses
  BullMQ defaults attempts:1), so per the merge guidance it was left as-is and noted.

## Deviations from Roadmap
- None functionally. The three boot fixes + the CampaignRecipient flip were unplanned
  but necessary corrections, all confirmed with Abdullah before applying.

## Known Issues Left Open (deferred follow-ups)
- **Add a boot smoke-test to `preflight.sh`** (start server, curl `/health`, assert 200,
  stop). The gate missed THREE separate boot failures because it never boots — close this
  permanently so the next wave's gate catches boot regressions automatically.
- **Fastify 5 migration** (Phase 10) — would let `@fastify/jwt` and `@fastify/rate-limit`
  return to their v10 majors; until then they stay pinned at v8/v9.
- **SMS half of 6.3** — SMS adapter is still a stub behind the ChannelAdapter interface.
- **Email (6.4)** — not built; extends Lane A.
- **Sync fake-order call** into `order.processor.ts` (ML scores currently batch-only).
- **Discovered-cluster → Segment promotion** (ML 5.3 surfaces clusters; one-click promote not wired).
- **`refund.processor.ts` line-item population** for `Product.returnRate` (column exists, uncomputable until populated).
- **CampaignRecipient DELIVERED/READ propagation** — the WhatsApp webhook updates
  `Message` delivery status but does not propagate DELIVERED/READ back to `CampaignRecipient`
  (recipient stops at SENT). Minor follow-up if per-recipient delivery analytics are needed.
- **Runtime send testing** of campaigns (live Meta send → recipient flip) is Abdullah's
  manual/browser work, intentionally not done here.

## What to Do Next
Wave 2 per ORCHESTRATION.md §12: Lane F Platform (courier or public API), 6.4 Email/COD,
6.5 on-site + flow library. First, add the boot smoke-test to `preflight.sh` so the gate
covers boot before the next wave starts.
