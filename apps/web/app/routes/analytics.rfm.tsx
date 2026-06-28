import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { RfmDashboard } from '@engageiq/shared'
import { AnalyticsPage, ErrorBanner, fetchAnalytics, formatNumber, formatPct } from '../components/analytics/ui'

export const meta: MetaFunction = () => [{ title: 'RFM Segments — EngageIQ' }]

interface LoaderData {
  dashboard: RfmDashboard | null
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<RfmDashboard>('/api/v1/analytics/rfm')
  return json<LoaderData>({ dashboard: data, error })
}

// Human label + bar color per RFM segment.
const SEGMENT_META: Record<string, { label: string; color: string }> = {
  CHAMPION: { label: 'Champions', color: 'bg-emerald-500' },
  LOYAL: { label: 'Loyal', color: 'bg-green-500' },
  POTENTIAL_LOYALIST: { label: 'Potential Loyalist', color: 'bg-teal-500' },
  NEW_CUSTOMER: { label: 'New Customers', color: 'bg-sky-500' },
  PROMISING: { label: 'Promising', color: 'bg-blue-500' },
  NEED_ATTENTION: { label: 'Need Attention', color: 'bg-amber-500' },
  ABOUT_TO_SLEEP: { label: 'About to Sleep', color: 'bg-orange-500' },
  AT_RISK: { label: 'At Risk', color: 'bg-rose-500' },
  CANNOT_LOSE_THEM: { label: 'Cannot Lose Them', color: 'bg-red-600' },
  HIBERNATING: { label: 'Hibernating', color: 'bg-gray-500' },
  LOST: { label: 'Lost', color: 'bg-gray-700' },
}

export default function AnalyticsRfm() {
  const { dashboard, error } = useLoaderData<typeof loader>()
  const maxCount = dashboard ? Math.max(1, ...dashboard.segments.map((s) => s.count)) : 1

  return (
    <AnalyticsPage
      title="RFM Segments"
      subtitle={
        dashboard
          ? `${formatNumber(dashboard.totalScored)} of ${formatNumber(dashboard.totalCustomers)} customers scored`
          : undefined
      }
    >
      <ErrorBanner error={error} />

      {dashboard && dashboard.totalScored === 0 && !error && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No RFM scores yet</p>
          <p className="mt-1 text-sm text-gray-500">
            The RFM scoring job (ML service) has not run for this store yet.
          </p>
        </div>
      )}

      {dashboard && dashboard.totalScored > 0 && (
        <div className="space-y-2">
          {dashboard.segments.map((s) => {
            const meta = SEGMENT_META[s.segment] ?? { label: s.segment, color: 'bg-brand-500' }
            return (
              <div key={s.segment} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{meta.label}</span>
                  <span className="text-sm text-gray-600">
                    {formatNumber(s.count)} <span className="text-gray-400">({formatPct(s.pctOfBase)})</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${meta.color}`}
                    style={{ width: `${(s.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AnalyticsPage>
  )
}
