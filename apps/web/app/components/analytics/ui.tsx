import { NavLink } from '@remix-run/react'
import type { KpiStatus } from '@engageiq/shared'

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

const STATUS_RING: Record<KpiStatus, string> = {
  green: 'border-l-green-500',
  amber: 'border-l-amber-500',
  red: 'border-l-red-500',
}

const STATUS_TEXT: Record<KpiStatus, string> = {
  green: 'text-green-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
}

export function KpiCard(props: {
  label: string
  value: string
  sub?: string
  status?: KpiStatus
  delta?: { value: string; positive: boolean } | null
}) {
  const status = props.status
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${
        status ? `border-l-4 ${STATUS_RING[status]}` : ''
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{props.label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{props.value}</p>
      <div className="mt-1 flex items-center gap-2">
        {props.sub && <span className="text-xs text-gray-500">{props.sub}</span>}
        {props.delta && (
          <span className={`text-xs font-medium ${props.delta.positive ? 'text-green-600' : 'text-red-600'}`}>
            {props.delta.positive ? '▲' : '▼'} {props.delta.value}
          </span>
        )}
        {status && !props.delta && (
          <span className={`text-xs font-medium ${STATUS_TEXT[status]}`}>●</span>
        )}
      </div>
    </div>
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
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/analytics'}
          className={({ isActive }) =>
            `border-b-2 px-3 py-2 text-sm font-medium ${
              isActive
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AnalyticsPage(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">{props.title}</h1>
        {props.subtitle && <p className="mt-1 text-sm text-gray-500">{props.subtitle}</p>}
      </div>
      <AnalyticsNav />
      {props.children}
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-medium text-red-700">{error}</p>
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
