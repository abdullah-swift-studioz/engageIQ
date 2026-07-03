# Update: Monochrome Design System, Component Library & App Shell

**Date:** 2026-07-03
**Phase:** Frontend foundation | **Milestone:** Design System (enabling work, not a roadmap milestone) | **Lane:** F2 — Design System (branch `design/system`)
**Author:** Claude Code (Session)

## What Was Built

A complete, strictly-monochrome design system for `apps/web` that every feature/restyle lane will import and build UI from. Nothing outside `apps/web` (+ `docs/DESIGN_SYSTEM.md`) was touched — no API, schema, or shared-package changes.

**1. Design tokens (`apps/web/tailwind.config.ts`).** The Tailwind color palette is **replaced, not extended**: the only colors that exist are `white`, `black`, and one true-gray ramp (`#FAFAFA → #0A0A0A`, = Tailwind `neutral`, matching the brief exactly). `gray` and `brand` are aliased to that ramp so legacy `gray-*`/`brand-*` usage in existing pages keeps resolving to grayscale. Every hue utility (`bg-blue-500`, `text-red-600`, …) now simply does not compile — color is structurally impossible to introduce. Also: small consistent radii (6px default), subtle black-alpha shadows only, a black focus ring (overriding Tailwind's blue `ringColor.DEFAULT`), restrained keyframes/animations, and a `text-2xs` (11px) size for the signature uppercase "data-label" eyebrow.

**2. Base CSS (`apps/web/app/tailwind.css`).** White page bg + near-black text, monochrome text selection, a global black `:focus-visible` fallback, thin monochrome scrollbars, a `.tabular` numerics helper, and a global `prefers-reduced-motion` guard.

**3. Component library (`apps/web/app/components/ui/`, 26 components).** Button (primary/secondary/ghost/destructive × sm/md/lg/icon, loading), Input, Textarea, Select, Checkbox (indeterminate), Radio, Switch, Label, FormField (auto-wires `id`/`aria-invalid`/`aria-describedby`/`aria-required`), Card (+ sub-parts), Table (+ empty state), Badge/Tag (removable), StatCard/KPI, PageHeader + SectionHeader, EmptyState, Skeleton (+ text), Avatar (initials fallback), Breadcrumb, Pagination (ellipsis), Modal, Drawer (L/R), Tabs, DropdownMenu, Tooltip, Toast (provider + `useToast`). Plus a dependency-free inline-SVG icon set, a `cn()` joiner, shared `field-styles`, and a shared `useOverlayBehavior` hook (scroll-lock + Escape + focus trap + focus restore) used by Modal, Drawer, and the mobile nav. All overlays are keyboard-accessible and SSR-safe. Everything is re-exported from `components/ui/index.ts`.

**4. Chart wrappers (`apps/web/app/components/charts/`).** Thin, responsive, monochrome SVG charts with hover tooltips built in: BarChart, LineChart (crosshair + shade/dash-differentiated series + auto legend for ≥2), Heatmap (grayscale-sequential light→dark cells), Sparkline. No colored series — magnitude uses a single gray ramp, identity uses shade + dash. `use-chart-width` measures the container so charts render at 1:1 (crisp, no viewBox distortion).

**5. App shell + full nav (`apps/web/app/components/shell/`, wired into `app/root.tsx`).** `AppShell` = fixed left Sidebar + Topbar + content region, wrapping `<Outlet/>` under a `ToastProvider`. The Sidebar links **every** product section — Dashboard, Customers, Segments, Campaigns, Journeys, Flows, WhatsApp Templates, Messages, Analytics (+ its 7 sub-pages), On-Site, Settings/RBAC — grouped, with an active near-black indicator and auto-expanding Analytics children. This fixes the prior gap where only "Customers" was linked. `nav.ts` is the single source of truth. Topbar has global search (→ customers), notifications, and an account dropdown. Mobile: the sidebar becomes a focus-trapped modal drawer.

**6. Docs (`docs/DESIGN_SYSTEM.md`).** Tokens, the no-color rule, a one-line usage example for every component + chart, the shell/nav model, and the rules lanes must follow (build from these components; never introduce color).

## Files Created / Modified

- `apps/web/tailwind.config.ts` — MODIFIED: monochrome token system (palette replacement, radius, shadow, type, motion, ring)
- `apps/web/app/tailwind.css` — MODIFIED: base layer (focus, selection, scrollbars, reduced-motion, `.tabular`)
- `apps/web/app/root.tsx` — MODIFIED: replaced the single-link nav with `<ToastProvider><AppShell><Outlet/></AppShell></ToastProvider>`
- `apps/web/app/components/ui/*` — NEW: 26 components + `icons.tsx`, `cn.ts`, `field-styles.ts`, `overlay-behavior.ts`, `index.ts`
- `apps/web/app/components/charts/*` — NEW: `BarChart`, `LineChart`, `Heatmap`, `Sparkline`, `chart-utils.ts`, `use-chart-width.ts`, `index.ts`
- `apps/web/app/components/shell/*` — NEW: `AppShell`, `Sidebar`, `Topbar`, `Logomark`, `nav.ts`
- `docs/DESIGN_SYSTEM.md` — NEW

## Decisions Made This Session

- **Enforce monochrome at the token layer (replace, not extend, the palette).** This makes color impossible to add and instantly brings the whole app to grayscale, rather than relying on discipline. Verified in the compiled CSS: zero accent hexes, zero non-gray `rgb()` values. Existing pages keep working (unknown hue classes no-op, no build break); their inline-hex colors (charts/journey builder) are the restyle lane's job.
- **Dependency-free.** No npm packages added (no lockfile change, safe for parallel lanes): icons are hand-authored inline SVG; `cn()` is a local joiner; charts are pure SVG.
- **Semantic state without color** (per brief): shade / border weight / fills / icons / font weight; destructive = solid pure-black fill (distinct from primary's near-black); error fields = darker border via `aria-invalid`; focus = black ring.
- **Nav lists every section; feature lanes add the route, not the nav entry.** Sections without routes yet (Flows, On-Site, Settings/RBAC) are tagged `soon: true` in `nav.ts` and will 404 until their lane ships — expected, not a broken nav.
- **Hardened via an adversarial multi-lens review** (monochrome-leak / a11y / API-SSR / type-build / docs), each finding verified; 6 confirmed a11y/correctness defects fixed (mobile-drawer focus trap, FormField `aria-required` + label association, DropdownMenu context memoization, hamburger `aria-expanded`, `cn(0)` stray-class). Monochrome/type/build/docs dimensions came back clean.

## Deviations from Roadmap

None. This is enabling foundation work (not a numbered roadmap milestone); it unblocks the restyle lane and all future UI.

## Known Issues Left Open

- **Restyle not applied to existing feature pages** — out of scope by design; a separate lane applies the system to `routes/*` and removes their inline-hex/color-class usage. Until then the app is visually mixed (monochrome shell + not-yet-restyled pages).
- **Flows, On-Site, Settings/RBAC have nav links but no routes** — they 404 until their feature lanes build them; flip `soon` off in `nav.ts` when they land.
- **Full `scripts/preflight.sh` not run here** — it also runs API tests + `prisma migrate status`, which need a lane DB not configured in this worktree and are unrelated to this UI-only lane. The web portions of the gate are green: `pnpm --filter @engageiq/web type-check` and `build` both pass.

## What to Do Next

Integrator: rebase `design/system` on `main` (only shared file touched is `app/root.tsx`, which no other lane owns — trivial), run the preflight web build, and merge. Then the restyle lane can migrate `routes/*` and feature components onto `~/components/ui` + `~/components/charts` and strip their color.
