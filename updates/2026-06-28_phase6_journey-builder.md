# Update: Visual Journey Builder

**Date:** 2026-06-28
**Phase:** 6 | **Milestone:** 6.1 Visual Journey Builder | **Lane:** E — Journey Builder (`lane/journey-builder`)
**Author:** Claude Code (Session — "EngageIQ Instance 4")

## What Was Built

A drag-and-drop visual journey editor (React Flow / `@xyflow/react` v12) in the Remix app, plus the
backend graph-persistence the editor needs. The canvas saves into the existing self-referential
`journey_steps` shape (parentStepId / childSteps + `config` Json + canvas coords), so journeys built
visually run on the **existing** execution engine unchanged.

**Frontend (owned files — `apps/web/app/components/journey/*`, `apps/web/app/routes/journeys.builder.*`):**
- A React Flow canvas with five node types: **Trigger, Action, Condition/Branch, Time Delay, A/B Split.**
- Drag-from-palette **and** click-to-add; nodes are draggable, connectable, selectable; minimap +
  controls + background grid.
- A right-hand **inspector** that edits each node's config: trigger type/segment/event, action
  channel + message body (+ email subject), condition field/operator/value, delay duration/unit, and
  A/B split variants + weights.
- Branch-aware handles: a **Condition** node exposes labelled `true` / `false` source handles; an
  **A/B Split** exposes one handle per variant. The branch key is written into each child step's
  `label`, which is exactly what the executor routes on (`label === 'true' | 'false'`).
- Connection rules enforced live: single incoming edge per node (one parent), no edge into the
  Trigger, no self-loops, one edge per branch handle.
- **Activate / Pause / Archive** controls in the toolbar, plus a live validation panel that blocks
  Activate until the graph is structurally sound (one connected tree rooted at a single Trigger).
- Client-only render (mounted guard) because React Flow measures the DOM / uses ResizeObserver.

**Backend (strictly-needed minor extensions to the existing journeys route — approved scope):**
- `PUT /api/v1/journeys/:id/graph` — replace a **DRAFT** journey's whole step graph in one
  transaction. Temp ids → real cuids via a two-pass create (create all, then wire `parentStepId`),
  so sibling references resolve regardless of input order. The previous `createJourney` /
  `updateJourney` could not persist a connected graph (nested create can't resolve sibling
  `parentStepId`; `updateJourney` ignored `steps` entirely) — this endpoint fixes that gap.
- `POST /api/v1/journeys/:id/archive` — DRAFT/ACTIVE/PAUSED → ARCHIVED.
- A pure, DB-free `validateGraph()` (single trigger root, every other node has exactly one existing
  parent, no self-parent, acyclic) with 12 co-located Vitest cases. DRAFT-only save is enforced
  (`JourneyNotDraftError` → HTTP 409) because ACTIVE/PAUSED journeys may have enrollments whose
  `currentStepId` references steps we would delete.
- `AB_SPLIT` added to the route's step-type Zod enum so split nodes persist (see deviation below).

## Files Created / Modified
- `apps/web/app/components/journey/types.ts` — editor types, step/channel/field registries, presentation meta
- `apps/web/app/components/journey/graph-transform.ts` — pure API-steps ↔ React-Flow node/edge mapping, save payload, client validation
- `apps/web/app/components/journey/JourneyNode.tsx` — custom node renderer + branch handles
- `apps/web/app/components/journey/NodeInspector.tsx` — per-type config forms
- `apps/web/app/components/journey/Palette.tsx` — draggable / click-to-add palette
- `apps/web/app/components/journey/JourneyCanvas.tsx` — the canvas (state, connect rules, drag-drop, save, status controls)
- `apps/web/app/routes/journeys.builder.$id.tsx` — builder route (loader + save/activate/pause/archive action) at `/journeys/builder/:id`
- `apps/web/package.json` — added `@xyflow/react@^12.3.0`
- `apps/api/src/routes/journeys/schema.ts` — `StepTypeEnum` (+ `AB_SPLIT`), `GraphNodeSchema`, `SaveGraphBodySchema`
- `apps/api/src/routes/journeys/service.ts` — `validateGraph`, `saveJourneyGraph`, `archiveJourney`, error classes
- `apps/api/src/routes/journeys/controller.ts` — `saveJourneyGraphHandler`, `archiveJourneyHandler`
- `apps/api/src/routes/journeys/index.ts` — registered `PUT /:id/graph`, `POST /:id/archive` (before `/:id`)
- `apps/api/src/routes/journeys/service.graph.test.ts` — 12 graph-validation tests
- `apps/web/app/routes/journeys.$id.tsx` — one tagged `// lane:journey` link to the builder
- `pnpm-lock.yaml` — React Flow install (see known issue re: `@fastify/rate-limit`)

## Decisions Made This Session
- **No shared-type changes.** Editor types live in the web package; the API contract is the Zod
  schema. `packages/shared` (highest blast radius) was left untouched — no append needed.
- **Branch routing via child `label`.** Reuses the executor's existing contract instead of inventing
  an edge-metadata column, so visually-built CONDITION branches execute correctly today (verified).
- **Graph save is DRAFT-only + replace-all** — the safe, simple model given enrollments can FK to steps.
- **Backend extension over frontend-only** (confirmed with Abdullah): the existing API genuinely
  could not persist a connected graph, so a dedicated graph endpoint was required.

## Deviations from Roadmap
- **A/B Split persists but does not execute yet** (confirmed with Abdullah: "build + persist, flag
  non-exec"). The `JourneyStepType.AB_SPLIT` enum exists, but the journey executor has no `AB_SPLIT`
  case — a customer reaching a split node currently completes the journey. The builder stores
  variants + weights and labels the branch children, so wiring execution is a clean handoff to the
  journey-execution-engine work (out of this lane's scope — the executor is owned/frozen elsewhere).
  The inspector surfaces this caveat to the user.

## Known Issues Left Open
- **[BLOCKER for the integrator — pre-existing, not introduced by this lane] `@fastify/rate-limit`
  vs `fastify` version drift.** `apps/api/package.json` declares `@fastify/rate-limit: ^10.3.0`
  (which requires fastify **5.x**) while `fastify` is pinned `^4.27.0`. The integrator's main
  `node_modules` happens to hold the older `9.1.0`, so it boots there; but any **fresh `pnpm
  install`** (required here to add React Flow) resolves `10.3.0` and the API then refuses to boot
  (`FST_ERR_PLUGIN_VERSION_MISMATCH`). This is latent on `main` too and independent of the journey
  code. **Recommended fix (integrator-owned):** pin `@fastify/rate-limit` to `^9.1.0` in
  `apps/api/package.json` (fastify-4 compatible) or upgrade fastify to 5. I did **not** modify
  `apps/api/package.json` — it is outside this lane and a coordinated dependency decision. Note:
  preflight stays green regardless (it builds + tests but never boots the server).
- **Browser verification still pending Abdullah.** I cannot run a browser. The API also could not be
  booted locally due to the rate-limit blocker above, so the web↔API round-trip wasn't exercised
  through the running server. Instead the load-bearing save path was verified directly against the
  live `engageiq_journey` Postgres (see Verification).
- **Web dev env:** the builder route reads `API_URL` / `DEV_TOKEN` from `process.env` (same pattern
  as the existing journey routes). I set both in the lane's gitignored `.env` (`API_URL=…:4041`, a
  freshly-minted 30-day `DEV_TOKEN` for the seeded OWNER). The web dev server must have `.env` loaded
  into its environment (e.g. `DOTENV_CONFIG_PATH`) for these to apply.

## Verification
- `scripts/preflight.sh` — **green**: build, typecheck, **102 API tests** (incl. 12 new graph tests),
  clean `prisma migrate status`.
- Live-DB smoke test of `saveJourneyGraph` + `getJourney` against `engageiq_journey` (throwaway
  script, not committed): trigger→condition→(true)action/(false)delay persisted with correct
  `parentStepId` wiring, `label` branch keys (`true`/`false`) matching the executor contract, canvas
  coords preserved; replace-all semantics confirmed; non-DRAFT save correctly rejected (409). RESULT: PASS.

## What to Do Next
- Integrator: reconcile the `@fastify/rate-limit` / `fastify` version drift (above) so the API boots
  on a fresh install, then rebase other active lanes.
- Abdullah: browser-verify the canvas at `/journeys/builder/:id` (link added on the journey detail
  page) with API on :4041 and web on :4040.
- Future lane (journey execution engine): implement the `AB_SPLIT` executor case to route variants
  by weight; the builder already persists the variant config + branch labels.
