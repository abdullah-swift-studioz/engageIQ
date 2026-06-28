import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { CohortResult } from '@engageiq/shared'
import { AnalyticsPage, ErrorBanner, fetchAnalytics, formatNumber, formatPct } from '../components/analytics/ui'

export const meta: MetaFunction = () => [{ title: 'Cohort Retention — EngageIQ' }]

interface LoaderData {
  result: CohortResult | null
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<CohortResult>('/api/v1/analytics/cohort', {
    method: 'POST',
    body: JSON.stringify({ groupBy: 'first_purchase_month', periods: 12 }),
  })
  return json<LoaderData>({ result: data, error })
}

// Heat-map background: stronger green for higher retention, gray for null (no data yet).
function heatStyle(value: number | null): React.CSSProperties {
  if (value == null) return { backgroundColor: '#f3f4f6', color: '#9ca3af' }
  // Clamp 0–1, blend white → emerald-600 (#059669) on a perceptual-ish ramp.
  const t = Math.max(0, Math.min(1, value))
  // Lightness from ~96% (white-ish) down to ~32% as value rises.
  const r = Math.round(236 - t * (236 - 5))
  const g = Math.round(253 - t * (253 - 150))
  const b = Math.round(245 - t * (245 - 105))
  const textColor = t > 0.55 ? '#ffffff' : '#065f46'
  return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: textColor }
}

export default function AnalyticsCohort() {
  const { result, error } = useLoaderData<typeof loader>()
  const periods = result?.periods ?? 12
  const rows = result?.rows ?? []
  const periodHeaders = Array.from({ length: periods }, (_, i) => i)

  return (
    <AnalyticsPage
      title="Cohort Retention"
      subtitle="Monthly cohorts grouped by first-purchase month. Each cell is the share of the cohort that ordered again in that month."
    >
      <ErrorBanner error={error} />

      {result && rows.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No cohort data yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Once this store has non-cancelled orders linked to customers, retention cohorts will appear here.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600">
                  Cohort
                </th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Size</th>
                {periodHeaders.map((i) => (
                  <th key={i} className="px-3 py-2 text-center font-medium text-gray-600">
                    M{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cohort} className="border-b border-gray-100 last:border-0">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900">
                    {row.cohort}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {formatNumber(row.cohortSize)}
                  </td>
                  {periodHeaders.map((i) => {
                    const value = row.retention[i] ?? null
                    return (
                      <td
                        key={i}
                        className="px-3 py-2 text-center tabular-nums"
                        style={heatStyle(value)}
                        title={`${row.cohort} · M${i}`}
                      >
                        {value == null ? '' : formatPct(value, 0)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsPage>
  )
}
