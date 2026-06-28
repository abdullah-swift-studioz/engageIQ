import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { RealtimeKpis } from '@engageiq/shared'
import { KpiCard, fetchAnalytics, formatPkr, formatNumber } from '../components/analytics/ui'

export const meta: MetaFunction = () => [
  { title: 'EngageIQ — Customer Engagement Platform' },
  { name: 'description', content: 'WhatsApp-first, COD-native customer engagement for South Asian Shopify brands.' },
]

interface LoaderData {
  kpis: RealtimeKpis | null
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<RealtimeKpis>('/api/v1/analytics/realtime')
  return json<LoaderData>({ kpis: data, error })
}

export default function Index() {
  const { kpis, error } = useLoaderData<typeof loader>()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Today at a glance.</p>
        </div>
        <Link
          to="/analytics"
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Open Analytics →
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-700">Live KPIs unavailable: {error}</p>
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Active Visitors" value={formatNumber(kpis.activeVisitors)} sub="last 30 min" status="green" />
          <KpiCard label="Revenue Today" value={formatPkr(kpis.revenue.today)} sub={`vs ${formatPkr(kpis.revenue.sameDayLastWeek)} last wk`} />
          <KpiCard label="Orders Today" value={formatNumber(kpis.orders.today)} sub={`COD ${kpis.orders.codToday} · Prepaid ${kpis.orders.prepaidToday}`} />
          <KpiCard label="New Customers" value={formatNumber(kpis.customers.newToday)} sub={`${kpis.customers.returningToday} returning`} />
        </div>
      )}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {([
          ['Real-Time', '/analytics'],
          ['RFM Segments', '/analytics/rfm'],
          ['Funnels', '/analytics/funnel'],
          ['Cohorts', '/analytics/cohort'],
          ['Attribution', '/analytics/attribution'],
          ['Products', '/analytics/products'],
          ['COD Analytics', '/analytics/cod'],
          ['Customers', '/customers'],
        ] as Array<[string, string]>).map(([label, to]) => (
          <Link
            key={to}
            to={to}
            className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm hover:border-brand-300 hover:text-brand-700"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
