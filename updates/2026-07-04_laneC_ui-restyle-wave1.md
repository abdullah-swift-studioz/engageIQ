# Update: UI Restyle of Wave 1 Pages (Lane C)

**Date:** 2026-07-04
**Phase:** Presentational | **Lane:** UI Restyle (Lane C) | **Branch:** lane/restyle
**Author:** Claude Code (Session)

## What Was Built

Restyled every pre-existing **Wave 1** web page to the monochrome design system
(`docs/DESIGN_SYSTEM.md`) so the whole app is now visually consistent with the
already-styled Wave 2A pages. These pages predated the design system and were raw
Tailwind with hardcoded hues (`bg-brand-*`, `text-green-*`, `bg-emerald-*`, colored
RFM/funnel/cohort charts, colored status pills). All of it is now strict grayscale:
white bg, black text, state expressed via shade / border weight / `Badge` variants /
icons / font weight — **never hue**.

This was **presentational only**. No loader, action, fetch call, API path, data shape,
route, field `name`, hidden input, or business logic was changed anywhere — verified by
diff (only JSX/markup and import-ordering changed) and by a clean `tsc --noEmit`.

Executed via 4 parallel Tier-1 subagents over disjoint file sets, each working from
`docs/DESIGN_SYSTEM.md` + a Wave-2A reference page (`on-site._index`, `email-templates.new`,
`email-templates.$id`); integrated and gated centrally.

## Files Created / Modified (27 files, all under apps/web/app/)

**Dashboard**
- `routes/_index.tsx` — PageHeader + monochrome KPI grid + card-style quick links; brand button → `buttonVariants` primary; amber error banner → `Icons.AlertCircle` monochrome.

**Customers**
- `routes/customers._index.tsx` — PageHeader + StatCard + Card/Table + EmptyState; churn-risk & RFM pills → monochrome Badge (+ AlertTriangle icon for HIGH/CRITICAL).
- `routes/customers.$id.tsx` — Breadcrumb + PageHeader + Card sections + StatCard tiles + Table sub-sections; all 12 sections and every field preserved.
- `routes/customers.$id_.merge.tsx` — two side-by-side profile Cards, search Input+Table, destructive confirm Button; merge form/action/hidden fields untouched.

**Segments**
- `routes/segments._index.tsx`, `routes/segments.new.tsx`, `routes/segments.$id.tsx` — list/form/detail in target style.
- `components/SegmentBuilder.tsx` — recursive AND/OR condition tree rebuilt on Input/Select/Textarea/Button + nested monochrome bordered Cards. **Condition-tree state logic, callbacks, prop shapes, and emitted `SegmentGroup` structure preserved exactly.**

**Campaigns**
- `routes/campaigns._index.tsx`, `routes/campaigns.new.tsx`, `routes/campaigns.$id.tsx` — status pills → Badge variants (solid/outline/subtle by emphasis); Send/Schedule/Cancel/Delete actions keep hidden `intent` inputs + `confirm()` guard.

**Journeys**
- `routes/journeys._index.tsx`, `routes/journeys.new.tsx`, `routes/journeys.$id.tsx`, `routes/journeys.$id_.enrollments.tsx` — list/form/detail/enrollments in target style; journey + enrollment status → monochrome Badge + icon. `journeys.builder.$id.tsx` (React Flow canvas) intentionally NOT touched.

**WhatsApp Templates**
- `routes/whatsapp-templates._index.tsx`, `.new.tsx`, `.$id.tsx` — Card/FormField forms; approval status → Badge + icon; **Urdu/RTL editor (`isRtl()`, `dir`, Noto Naskh font) fully preserved**; WhatsApp-green preview surface → `bg-neutral-100`.

**Messages**
- `routes/messages._index.tsx` — StatCard row + Card/Table; delivery status → Badge + icon; direction arrows → `Icons.ArrowUpRight/ArrowDownRight`.

**Analytics (7 pages + shared shell)**
- `components/analytics/ui.tsx` — presentational shell rewritten on PageHeader/Card/StatCard; monochrome ErrorBanner (AlertCircle). `fetchAnalytics` + formatters left byte-for-byte.
- `routes/analytics._index.tsx` (realtime), `.rfm.tsx`, `.funnel.tsx`, `.cohort.tsx`, `.attribution.tsx`, `.products.tsx`, `.cod.tsx` — all colored charts converted to monochrome wrappers: RFM/funnel/attribution/COD bars → `BarChart`, cohort retention grid → `Heatmap`, realtime revenue → `Sparkline`. Exact figures retained in accompanying monochrome `Table`s.

## Decisions Made This Session
- **Restyled the two local shared helpers** (`components/analytics/ui.tsx`, `components/SegmentBuilder.tsx`) rather than only their call sites — both are used exclusively by Lane C target pages, so fixing them once fixes all consumers' chrome. Logic/formatters inside them preserved.
- **Analytics pages keep a monochrome Table beside each new chart** so exact figures/percentages (charts only show on hover/approximate) remain visible — preserves all previously-shown data.
- **`journeys.builder.$id.tsx` left as-is** — the React Flow visual canvas is out of the restyle scope per lane brief.

## Deviations from Roadmap
- None. This is a presentational consistency pass, not a roadmap milestone.

## Known Issues Left Open
- Cannot browser-verify (Claude Code constraint). Visual QA of the restyled pages in a
  running app is Abdullah's to perform.
- Env setup was limited to the build gate per instruction (no `createdb`/`migrate`/`seed`);
  `prisma generate` + `@engageiq/shared`/`@engageiq/db` builds were run locally only to
  enable the typecheck.

## Preflight / Verification
- **Web production build:** `pnpm --filter @engageiq/web build` → **PASS** (exit 0, client + SSR bundles).
- **Web typecheck:** `apps/web` `tsc --noEmit` → **PASS** (exit 0, zero errors) after building `@engageiq/shared` + `@engageiq/db` (+ `prisma generate`).
- **Color audit:** zero hue classes and zero hex/rgb/hsl inline colors across all 27 files.
- **Scope audit:** `git status` shows exactly the 27 target files modified; nothing outside the lane touched.
- **Logic audit:** diff of removed lines shows only import reordering — no loader/action/fetch/data changes.

## What to Do Next
- Integrator: integrate Lane C **LAST** (it restyles the final merged set of route files),
  then fold this summary into `memory/context.md`. No merge performed by this lane.
