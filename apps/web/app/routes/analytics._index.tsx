import { useEffect } from 'react'
import { useLoaderData, useRevalidator } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { RealtimeKpis, KpiStatus } from '@engageiq/shared'
import {
  AnalyticsPage,
  ErrorBanner,
  KpiCard,
  fetchAnalytics,
  formatPkr,
  formatNumber,
} from '../components/analytics/ui'

export const meta: MetaFunction = () => [{ title: 'Real-Time Dashboard — EngageIQ' }]

interface LoaderData {
  kpis: RealtimeKpis | null
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<RealtimeKpis>('/api/v1/analytics/realtime')
  return json<LoaderData>({ kpis: data, error })
}

function deltaPct(current: number, base: number): { value: string; positive: boolean } | null {
  if (base <= 0) return null
  const pct = Math.round(((current - base) / base) * 100)
  return { value: `${Math.abs(pct)}% vs last wk`, positive: pct >= 0 }
}

function revenueStatus(today: number, target: number): KpiStatus {
  if (target <= 0) return today > 0 ? 'green' : 'amber'
  const r = today / target
  return r >= 1 ? 'green' : r >= 0.7 ? 'amber' : 'red'
}

export default function AnalyticsRealtime() {
  const { kpis, error } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()

  // Poll every 30s (roadmap 4.1).
  useEffect(() => {
    const id = setInterval(() => revalidator.revalidate(), 30_000)
    return () => clearInterval(id)
  }, [revalidator])

  return (
    <AnalyticsPage
      title="Real-Time Dashboard"
      subtitle={kpis ? `Updated ${new Date(kpis.generatedAt).toLocaleTimeString('en-PK')} · auto-refresh 30s` : undefined}
    >
      <ErrorBanner error={error} />

      {kpis && (
        <>
          {/* Alerts */}
          {kpis.alerts.length > 0 && (
            <div className="mb-6 space-y-2">
              {kpis.alerts.map((a, i) => (
                <div
                  key={i}
                  className={`rounded-md border px-4 py-2 text-sm font-medium ${
                    a.level === 'red'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : a.level === 'amber'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-green-200 bg-green-50 text-green-700'
                  }`}
                >
                  {a.message}
                </div>
              ))}
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Active Visitors" value={formatNumber(kpis.activeVisitors)} sub="last 30 min" status="green" />
            <KpiCard
              label="Revenue Today"
              value={formatPkr(kpis.revenue.today)}
              sub={`Yesterday ${formatPkr(kpis.revenue.yesterday)}`}
              status={revenueStatus(kpis.revenue.today, kpis.revenue.sameDayLastWeek)}
              delta={deltaPct(kpis.revenue.today, kpis.revenue.sameDayLastWeek)}
            />
            <KpiCard
              label="Orders Today"
              value={formatNumber(kpis.orders.today)}
              sub={`COD ${kpis.orders.codToday} · Prepaid ${kpis.orders.prepaidToday}`}
            />
            <KpiCard
              label="Customers Today"
              value={formatNumber(kpis.customers.newToday + kpis.customers.returningToday)}
              sub={`New ${kpis.customers.newToday} · Returning ${kpis.customers.returningToday}`}
            />
          </div>

          {/* Revenue comparison */}
          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Revenue Comparison</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                ['Today', kpis.revenue.today],
                ['Yesterday', kpis.revenue.yesterday],
                ['Same day last week', kpis.revenue.sameDayLastWeek],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <p className="text-lg font-semibold text-gray-900">{formatPkr(val as number)}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Active campaigns */}
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Active Campaigns</h2>
            {kpis.activeCampaigns.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
                No active campaigns right now.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Campaign', 'Status', 'Recipients', 'Delivered', 'Revenue'].map((c) => (
                        <th key={c} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {kpis.activeCampaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{c.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{c.status}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{formatNumber(c.recipientCount)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{formatNumber(c.deliveredCount)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{formatPkr(c.revenueAttributed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AnalyticsPage>
  )
}
