# EngageIQ Design System

> **The one rule:** every screen in EngageIQ is **strict monochrome**. Build all new
> UI from the components below. **Never introduce a color.** State is shown with
> shade, border weight, fills, icons, and font weight — never hue.

This is the shared visual language for the whole product. Feature lanes import from
`~/components/ui` and `~/components/charts` and compose screens; they do not write
their own buttons, inputs, tables, or ad-hoc colors.

- **Components:** `apps/web/app/components/ui/` → `import { Button } from '~/components/ui'`
- **Charts:** `apps/web/app/components/charts/` → `import { BarChart } from '~/components/charts'`
- **Shell / nav:** `apps/web/app/components/shell/` (wired in `app/root.tsx`)
- **Tokens:** `apps/web/tailwind.config.ts`

---

## 1. Why monochrome, and how it is enforced

The Tailwind palette is **replaced, not extended** (`tailwind.config.ts`). The only
colors that exist are `white`, `black`, and one true-gray ramp. `bg-blue-500`,
`text-red-600`, and every other hue **do not compile** — the class produces no rule.
`gray` and `brand` are aliased onto the ramp so legacy `gray-*` / `brand-*` usage in
older pages keeps resolving (to grayscale) until it is migrated.

You cannot add a color even by accident. That is the point.

### Expressing state without color

| State | How to show it (no hue) |
|---|---|
| Primary / high-emphasis | Solid near-black fill (`Button` primary) |
| Secondary | Outline (`Button` secondary) |
| Destructive | Solid **pure-black** fill (`Button` destructive) — distinct from primary by shade |
| Success / error / warning | An **icon** (`CheckCircle` / `AlertCircle` / `AlertTriangle`) + bold text |
| Selected | Filled/darker border + check icon + `bg-neutral-100` |
| Error field | Darker/heavier border (driven by `aria-invalid`), never a red ring |
| Focus | A **black ring** (`ring-neutral-950`) with a white offset |

---

## 2. Tokens

### Color ramp (`neutral`, aliased as `gray`)

| Token | Hex | Typical use |
|---|---|---|
| `white` | `#FFFFFF` | Page background, surfaces, cards |
| `neutral-50` | `#FAFAFA` | Hover wash, zebra rows |
| `neutral-100` | `#F5F5F5` | Subtle fills, `subtle` badge |
| `neutral-200` | `#E5E5E5` | **Default border** / hairlines, gridlines |
| `neutral-300` | `#D4D4D4` | Input borders, scrollbar thumb |
| `neutral-400` | `#A3A3A3` | Placeholder, disabled icon, muted marks |
| `neutral-500` | `#737373` | Secondary text, axis labels |
| `neutral-600` | `#525252` | Body-secondary, nav idle |
| `neutral-700` | `#404040` | Strong secondary, default bar fill |
| `neutral-800` | `#262626` | Primary-button hover |
| `neutral-900` | `#171717` | Headings on subtle surfaces |
| `neutral-950` | `#0A0A0A` | **Primary text**, solid fills, focus ring |

### Type · radius · elevation · motion

- **Font:** Inter (`font-sans`); `font-mono` for tabular figures. Use the `.tabular`
  helper for KPI/table numerics.
- **Type scale:** Tailwind scale + `text-2xs` (11px) for the uppercase **data-label**
  eyebrow — the system's signature label. Headings use `tracking-tight`.
- **Radius (small, consistent):** `rounded` = 6px default, `sm` 4px, `lg` 8px,
  `xl` 10px, `full` pills.
- **Shadow (subtle, black-alpha only):** `shadow-xs` `shadow-sm` on cards/inputs;
  `shadow-md` on tooltips; `shadow-overlay` on modals / drawers / dropdowns. The
  system leans on **borders**, not elevation.
- **Motion:** `animate-fade-in`, `animate-scale-in` (menus/tooltips/modals),
  `animate-drawer-in[-left]`, `animate-toast-in`. All respect
  `prefers-reduced-motion` (handled globally in `tailwind.css`).
- **Focus:** components set `focus-visible:ring-2 ring-neutral-950 ring-offset-2`;
  a global black outline covers anything that doesn't opt in.

---

## 3. Component catalog

Import everything from `~/components/ui`. One-line usage each:

### Forms & controls
- **Button** — `<Button variant="primary|secondary|ghost|destructive" size="sm|md|lg|icon" isLoading leftIcon={<Icons.Plus/>}>Save</Button>`
- **Input** — `<Input placeholder="Name" startIcon={<Icons.Search/>} invalid />`
- **Textarea** — `<Textarea rows={4} placeholder="Message body" />`
- **Select** — `<Select defaultValue="all"><option value="all">All</option></Select>`
- **Checkbox** — `<Checkbox checked={on} indeterminate={mixed} onChange={…} />`
- **Radio** — `<Radio name="plan" value="pro" />`
- **Switch** — `<Switch checked={enabled} onCheckedChange={setEnabled} />`
- **Label** — `<Label htmlFor="email" required>Email</Label>`
- **FormField** — `<FormField label="Email" hint="We never share it." error={err}><Input/></FormField>` (auto-wires `id`, `aria-invalid`, `aria-describedby`)

### Layout & data
- **Card** — `<Card><CardHeader><CardTitle>Overview</CardTitle></CardHeader><CardContent>…</CardContent></Card>`
- **Table** — `<Table><TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader><TableBody>{rows.length? …rows : <TableEmpty colSpan={3}>No customers yet.</TableEmpty>}</TableBody></Table>`
- **Badge / Tag** — `<Badge variant="solid|outline|subtle" dot>Active</Badge>` · `<Tag onRemove={…}>WhatsApp</Tag>`
- **StatCard** — `<StatCard label="Revenue Today" value="PKR 482,300" delta={{value:'12%',direction:'up'}} chart={<Sparkline values={[…]}/>} />`
- **PageHeader** — `<PageHeader eyebrow="Audience" title="Customers" description="…" actions={<Button>New</Button>} />`
- **SectionHeader** — `<SectionHeader title="Filters" divider actions={…} />`
- **EmptyState** — `<EmptyState icon={<Icons.Users/>} title="No customers yet" description="…" action={<Button>Import</Button>} />`
- **Skeleton** — `<Skeleton className="h-4 w-32" />` · `<SkeletonText lines={3} />`
- **Avatar** — `<Avatar name="Abdullah Ali" src={url} size="sm|md|lg" />`
- **Breadcrumb** — `<Breadcrumb items={[{label:'Customers',href:'/customers'},{label:'Detail'}]} />`
- **Pagination** — `<Pagination page={p} pageCount={n} onPageChange={setP} />`

### Overlays & feedback
- **Modal** — `<Modal open={open} onClose={close} title="Delete segment?" footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="destructive">Delete</Button></>}>This can't be undone.</Modal>`
- **Drawer** — `<Drawer open={open} onClose={close} side="right" title="Filters">…</Drawer>`
- **Tabs** — `<Tabs defaultValue="all"><TabsList><TabsTrigger value="all">All</TabsTrigger></TabsList><TabsContent value="all">…</TabsContent></Tabs>`
- **DropdownMenu** — `<DropdownMenu><DropdownMenuTrigger>…</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={…}>Edit</DropdownMenuItem></DropdownMenuContent></DropdownMenu>`
- **Tooltip** — `<Tooltip content="Notifications"><button>…</button></Tooltip>`
- **Toast** — provider is wired in `root.tsx`; call `const { toast } = useToast(); toast({ title:'Saved', variant:'success' })`
- **Icons** — `import { Icons } from '~/components/ui'` → `<Icons.Search className="size-4" />`

Modal, Drawer, Tabs, DropdownMenu, Tooltip are keyboard-accessible (Escape, focus
trap/return, arrow keys) and SSR-safe.

---

## 4. Charts

Thin, responsive, monochrome SVG wrappers with hover tooltips built in. Series are
separated by **shade + dash**, magnitude by a **single light→dark gray ramp**. No
colored series, ever.

- **BarChart** — `<BarChart data={[{label:'Mon',value:120}]} height={240} showValues />`
- **LineChart** — `<LineChart labels={days} series={[{name:'Orders',values:[…]}]} showArea />` (legend auto-shows for ≥2 series)
- **Heatmap** — `<Heatmap rowLabels={weeks} colLabels={days} values={grid} />` (cohort/retention)
- **Sparkline** — `<Sparkline values={[3,5,4,8]} area showLast />` (inline, for StatCard)

Keep line/heatmap to ~3 series max — monochrome can only carry so many at once. A
4th series folds into "Other" or a small multiple.

---

## 5. App shell & navigation

`AppShell` (Sidebar + Topbar + content) wraps every route from `root.tsx`. The
**Sidebar** is the single source of truth for navigation — `components/shell/nav.ts`
lists every product section (Dashboard, Customers, Segments, Campaigns, Journeys,
Flows, WhatsApp Templates, Messages, Analytics + sub-pages, On-Site, Settings/RBAC).

**Feature lanes add their route, not a nav entry** — the section is already listed.
Sections whose route isn't built yet are marked `soon: true` in `nav.ts`; flip that
off when your lane ships the route.

---

## 6. Rules for lanes

1. **Build all new UI from `~/components/ui` and `~/components/charts`.** Don't
   re-implement a button/input/table or hand-roll a card.
2. **Never introduce color.** No hue classes, no colored inline `style`, no colored
   chart series. If you reach for red/green to signal state, use an icon + weight +
   shade instead (§1).
3. **Use the tokens.** Text `neutral-950/600/500`, borders `neutral-200`, radius via
   `rounded`/`rounded-lg`, focus via the ring pattern. Don't invent spacing/shade
   one-offs when a token fits.
4. **Keep it accessible.** Label controls (`FormField`), keep focus visible, give
   icon-only buttons an `aria-label`.
5. **Extending the system?** Add the primitive here (in `components/ui`), export it
   from the barrel, and document it in this file — don't fork a variant into a
   feature folder.
