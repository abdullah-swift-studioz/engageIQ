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
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  SectionHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from '~/components/ui'
import { BarChart } from '~/components/charts'

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
    <Card>
      <CardContent className="space-y-3 pt-6">
        <SectionHeader title={title} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{keyLabel}</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Acceptance Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={4}>No COD orders in this period.</TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="text-neutral-900">{r.key}</TableCell>
                  <TableCell className="tabular text-right text-neutral-600">{formatNumber(r.total)}</TableCell>
                  <TableCell className="tabular text-right text-neutral-600">{formatNumber(r.accepted)}</TableCell>
                  <TableCell className="tabular text-right text-neutral-900">{formatPct(r.acceptanceRate)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiCard label="Net Prepaid Revenue" value={formatPkr(cod.netRevenuePrepaid)} />
            <KpiCard
              label="COD → Prepaid Conversion"
              value={cod.codToPrepaidConversion == null ? '—' : formatPct(cod.codToPrepaidConversion)}
              sub="COD customers who later paid upfront"
            />
          </div>

          {cod.byCity.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Acceptance rate by city</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={cod.byCity.map((r) => ({ label: r.key, value: r.acceptanceRate }))}
                  height={240}
                  valueFormatter={(v) => formatPct(v, 0)}
                  ariaLabel="COD acceptance rate by city"
                />
              </CardContent>
            </Card>
          )}

          <BreakdownTable title="By City" keyLabel="City" rows={cod.byCity} />
          <BreakdownTable title="By Courier" keyLabel="Courier" rows={cod.byCourier} />
          <BreakdownTable title="By Value Band" keyLabel="Order Value" rows={cod.byValueBand} />
        </>
      )}
    </AnalyticsPage>
  )
}
