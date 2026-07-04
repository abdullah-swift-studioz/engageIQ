import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { CohortResult } from '@engageiq/shared'
import { AnalyticsPage, ErrorBanner, fetchAnalytics, formatNumber, formatPct } from '../components/analytics/ui'
import { Card, CardContent, EmptyState, Icons } from '~/components/ui'
import { Heatmap } from '~/components/charts'

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
        <EmptyState
          icon={<Icons.Users />}
          title="No cohort data yet"
          description="Once this store has non-cancelled orders linked to customers, retention cohorts will appear here."
        />
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Heatmap
              rowLabels={rows.map((row) => `${row.cohort} · ${formatNumber(row.cohortSize)}`)}
              colLabels={periodHeaders.map((i) => `M${i}`)}
              values={rows.map((row) => periodHeaders.map((i) => row.retention[i] ?? null))}
              max={1}
              valueFormatter={(v) => formatPct(v, 0)}
              ariaLabel="Cohort retention heatmap"
            />
          </CardContent>
        </Card>
      )}
    </AnalyticsPage>
  )
}
