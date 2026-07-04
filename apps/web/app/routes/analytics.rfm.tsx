import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { RfmDashboard } from '@engageiq/shared'
import { AnalyticsPage, ErrorBanner, fetchAnalytics, formatNumber, formatPct } from '../components/analytics/ui'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Icons,
} from '~/components/ui'
import { BarChart } from '~/components/charts'

export const meta: MetaFunction = () => [{ title: 'RFM Segments — EngageIQ' }]

interface LoaderData {
  dashboard: RfmDashboard | null
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<RfmDashboard>('/api/v1/analytics/rfm')
  return json<LoaderData>({ dashboard: data, error })
}

// Human label per RFM segment. State/emphasis is monochrome — no per-segment hue.
const SEGMENT_LABEL: Record<string, string> = {
  CHAMPION: 'Champions',
  LOYAL: 'Loyal',
  POTENTIAL_LOYALIST: 'Potential Loyalist',
  NEW_CUSTOMER: 'New Customers',
  PROMISING: 'Promising',
  NEED_ATTENTION: 'Need Attention',
  ABOUT_TO_SLEEP: 'About to Sleep',
  AT_RISK: 'At Risk',
  CANNOT_LOSE_THEM: 'Cannot Lose Them',
  HIBERNATING: 'Hibernating',
  LOST: 'Lost',
}

export default function AnalyticsRfm() {
  const { dashboard, error } = useLoaderData<typeof loader>()

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
        <EmptyState
          icon={<Icons.Users />}
          title="No RFM scores yet"
          description="The RFM scoring job (ML service) has not run for this store yet."
        />
      )}

      {dashboard && dashboard.totalScored > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Customers by segment</CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                data={dashboard.segments.map((s) => ({
                  label: SEGMENT_LABEL[s.segment] ?? s.segment,
                  value: s.count,
                }))}
                height={280}
                valueFormatter={formatNumber}
                ariaLabel="Customer count by RFM segment"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Segment</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">% of base</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.segments.map((s) => (
                    <TableRow key={s.segment}>
                      <TableCell className="font-medium text-neutral-900">
                        {SEGMENT_LABEL[s.segment] ?? s.segment}
                      </TableCell>
                      <TableCell className="tabular text-right">{formatNumber(s.count)}</TableCell>
                      <TableCell className="tabular text-right text-neutral-600">{formatPct(s.pctOfBase)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </AnalyticsPage>
  )
}
