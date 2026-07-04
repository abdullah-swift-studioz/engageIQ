import type { ReactNode } from 'react'
import { NavLink } from '@remix-run/react'
import type { KpiStatus } from '@engageiq/shared'
import { PageHeader, StatCard, Icons } from '~/components/ui'

// Shared UI primitives + formatters for the analytics dashboard pages (roadmap Phase 4).

export function formatPkr(value: number | string | null | undefined): string {
  if (value == null) return '—'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '—'
  return `PKR ${Math.round(num).toLocaleString('en-PK')}`
}

export function formatPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || isNaN(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'
  return value.toLocaleString('en-PK')
}

// State is shown with an icon + weight, never a hue (design system §1).
const STATUS_ICON: Record<KpiStatus, ReactNode> = {
  green: <Icons.CheckCircle />,
  amber: <Icons.AlertTriangle />,
  red: <Icons.AlertCircle />,
}

export function KpiCard(props: {
  label: string
  value: string
  sub?: string
  status?: KpiStatus
  delta?: { value: string; positive: boolean } | null
  /** Optional trailing visual (e.g. a <Sparkline/>). */
  chart?: ReactNode
}) {
  const { status, delta } = props
  return (
    <StatCard
      label={props.label}
      value={props.value}
      sub={props.sub}
      icon={status ? STATUS_ICON[status] : undefined}
      delta={delta ? { value: delta.value, direction: delta.positive ? 'up' : 'down' } : undefined}
      chart={props.chart}
    />
  )
}

const TABS: Array<{ to: string; label: string }> = [
  { to: '/analytics', label: 'Real-Time' },
  { to: '/analytics/rfm', label: 'RFM' },
  { to: '/analytics/funnel', label: 'Funnel' },
  { to: '/analytics/cohort', label: 'Cohorts' },
  { to: '/analytics/attribution', label: 'Attribution' },
  { to: '/analytics/products', label: 'Products' },
  { to: '/analytics/cod', label: 'COD' },
]

export function AnalyticsNav() {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/analytics'}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-neutral-950 text-neutral-950'
                : 'border-transparent text-neutral-500 hover:text-neutral-900'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AnalyticsPage(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader eyebrow="Analytics" title={props.title} description={props.subtitle} />
      <AnalyticsNav />
      {props.children}
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
      <Icons.AlertCircle className="mt-0.5 size-4 shrink-0 text-neutral-700" />
      <p className="text-sm font-medium text-neutral-900">{error}</p>
    </div>
  )
}

// Shared loader helper: fetch an analytics endpoint with the dev bearer token.
export async function fetchAnalytics<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T | null; error: string | null }> {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return { data: null, error: `API error ${res.status}: ${text}` }
    }
    const body = (await res.json()) as { success: boolean; data: T }
    if (!body.success) return { data: null, error: 'API returned an error.' }
    return { data: body.data, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { data: null, error: `Failed to reach API: ${message}` }
  }
}
