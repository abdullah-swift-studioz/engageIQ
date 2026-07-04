import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { RealtimeKpis } from '@engageiq/shared'
import { KpiCard, fetchAnalytics, formatPkr, formatNumber } from '../components/analytics/ui'
import { PageHeader, buttonVariants, Icons } from '~/components/ui'

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
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Today at a glance."
        actions={
          <Link to="/analytics" className={buttonVariants({ variant: 'primary' })}>
            Open Analytics
            <Icons.ArrowRight className="size-4" />
          </Link>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
          <Icons.AlertCircle className="size-4 text-neutral-950" />
          <p className="text-sm font-medium text-neutral-950">Live KPIs unavailable: {error}</p>
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
            className="group flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 shadow-xs transition-colors hover:border-neutral-300 hover:text-neutral-950"
          >
            {label}
            <Icons.ArrowRight className="size-4 text-neutral-400 transition-colors group-hover:text-neutral-950" />
          </Link>
        ))}
      </div>
    </div>
  )
}
