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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  Badge,
  EmptyState,
  Icons,
} from '~/components/ui'
import { Sparkline } from '~/components/charts'

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
          {/* Alerts — state shown by icon + weight, never hue */}
          {kpis.alerts.length > 0 && (
            <div className="space-y-2">
              {kpis.alerts.map((a, i) => {
                const AlertIcon =
                  a.level === 'red'
                    ? Icons.AlertCircle
                    : a.level === 'amber'
                      ? Icons.AlertTriangle
                      : Icons.CheckCircle
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 shadow-xs"
                  >
                    <AlertIcon className="mt-0.5 size-4 shrink-0 text-neutral-700" />
                    <p className="text-sm font-medium text-neutral-900">{a.message}</p>
                  </div>
                )
              })}
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
              chart={
                <Sparkline
                  values={[kpis.revenue.sameDayLastWeek, kpis.revenue.yesterday, kpis.revenue.today]}
                  area
                  showLast
                  ariaLabel="Revenue trend"
                />
              }
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
          <Card>
            <CardHeader>
              <CardTitle>Revenue Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                {[
                  ['Today', kpis.revenue.today],
                  ['Yesterday', kpis.revenue.yesterday],
                  ['Same day last week', kpis.revenue.sameDayLastWeek],
                ].map(([label, val]) => (
                  <div key={label as string}>
                    <p className="tabular text-lg font-semibold text-neutral-950">{formatPkr(val as number)}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Active campaigns */}
          <Card>
            <CardHeader>
              <CardTitle>Active Campaigns</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {kpis.activeCampaigns.length === 0 ? (
                <EmptyState
                  icon={<Icons.Megaphone />}
                  title="No active campaigns right now"
                  description="Live campaigns will appear here with their delivery and revenue stats."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Recipients</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpis.activeCampaigns.length === 0 ? (
                      <TableEmpty colSpan={5}>No active campaigns.</TableEmpty>
                    ) : (
                      kpis.activeCampaigns.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium text-neutral-900">{c.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" dot>
                              {c.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular text-right">{formatNumber(c.recipientCount)}</TableCell>
                          <TableCell className="tabular text-right">{formatNumber(c.deliveredCount)}</TableCell>
                          <TableCell className="tabular text-right">{formatPkr(c.revenueAttributed)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AnalyticsPage>
  )
}
