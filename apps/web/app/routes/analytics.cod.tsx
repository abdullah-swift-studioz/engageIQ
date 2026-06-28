import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { CodAnalytics, CodBreakdownRow } from '@engageiq/shared'
import {
  AnalyticsPage,
  ErrorBanner,
  KpiCard,
  fetchAnalytics,
  formatNumber,
  formatPct,
  formatPkr,
} from '../components/analytics/ui'

export const meta: MetaFunction = () => [{ title: 'COD Analytics — EngageIQ' }]

interface LoaderData {
  cod: CodAnalytics | null
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<CodAnalytics>('/api/v1/analytics/cod?period=90d')
  return json<LoaderData>({ cod: data, error })
}

function BreakdownTable({
  title,
  keyLabel,
  rows,
}: {
  title: string
  keyLabel: string
  rows: CodBreakdownRow[]
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-900">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">{keyLabel}</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Total</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Accepted</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Acceptance Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No COD orders in this period.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2 text-gray-900">{r.key}</td>
                <td className="px-4 py-2 text-right text-gray-600">{formatNumber(r.total)}</td>
                <td className="px-4 py-2 text-right text-gray-600">{formatNumber(r.accepted)}</td>
                <td className="px-4 py-2 text-right text-gray-900">{formatPct(r.acceptanceRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function AnalyticsCod() {
  const { cod, error } = useLoaderData<typeof loader>()

  return (
    <AnalyticsPage
      title="COD Analytics"
      subtitle={
        cod ? `${formatNumber(cod.totalCodOrders)} cash-on-delivery orders (last 90 days)` : undefined
      }
    >
      <ErrorBanner error={error} />

      {cod && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              label="Acceptance Rate"
              value={formatPct(cod.acceptanceRate)}
              status={cod.acceptanceRate >= 0.7 ? 'green' : cod.acceptanceRate >= 0.5 ? 'amber' : 'red'}
            />
            <KpiCard
              label="Rejection Rate"
              value={formatPct(cod.rejectionRate)}
              status={cod.rejectionRate <= 0.2 ? 'green' : cod.rejectionRate <= 0.4 ? 'amber' : 'red'}
            />
            <KpiCard
              label="Fake-Order Rate"
              value={formatPct(cod.fakeOrderRate)}
              status={cod.fakeOrderRate <= 0.1 ? 'green' : cod.fakeOrderRate <= 0.25 ? 'amber' : 'red'}
            />
            <KpiCard label="Net COD Revenue" value={formatPkr(cod.netRevenueCod)} sub="delivered only" />
            <KpiCard
              label="Avg Days to Collect"
              value={cod.avgDaysToCollect == null ? '—' : cod.avgDaysToCollect.toFixed(1)}
              sub="placed → delivered"
            />
          </div>

          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiCard label="Net Prepaid Revenue" value={formatPkr(cod.netRevenuePrepaid)} />
            <KpiCard
              label="COD → Prepaid Conversion"
              value={cod.codToPrepaidConversion == null ? '—' : formatPct(cod.codToPrepaidConversion)}
              sub="COD customers who later paid upfront"
            />
          </div>

          <div className="space-y-8">
            <BreakdownTable title="By City" keyLabel="City" rows={cod.byCity} />
            <BreakdownTable title="By Courier" keyLabel="Courier" rows={cod.byCourier} />
            <BreakdownTable title="By Value Band" keyLabel="Order Value" rows={cod.byValueBand} />
          </div>
        </>
      )}
    </AnalyticsPage>
  )
}
