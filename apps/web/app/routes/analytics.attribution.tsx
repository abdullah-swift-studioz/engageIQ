import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { AttributionModel, AttributionResult } from '@engageiq/shared'
import {
  AnalyticsPage,
  ErrorBanner,
  KpiCard,
  fetchAnalytics,
  formatNumber,
  formatPkr,
} from '../components/analytics/ui'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  SectionHeader,
  buttonVariants,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from '~/components/ui'
import { BarChart } from '~/components/charts'

export const meta: MetaFunction = () => [{ title: 'Revenue Attribution — EngageIQ' }]

const MODELS: Array<{ value: AttributionModel; label: string }> = [
  { value: 'last_touch', label: 'Last Touch' },
  { value: 'first_touch', label: 'First Touch' },
  { value: 'linear', label: 'Linear' },
  { value: 'time_decay', label: 'Time Decay' },
]

const VALID_MODELS = new Set<AttributionModel>(MODELS.map((m) => m.value))

interface LoaderData {
  result: AttributionResult | null
  error: string | null
  model: AttributionModel
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('model') ?? 'last_touch'
  const model = (VALID_MODELS.has(raw as AttributionModel) ? raw : 'last_touch') as AttributionModel
  const { data, error } = await fetchAnalytics<AttributionResult>(
    `/api/v1/analytics/attribution?period=30d&model=${model}`,
  )
  return json<LoaderData>({ result: data, error, model })
}

export default function AnalyticsAttribution() {
  const { result, error, model } = useLoaderData<typeof loader>()

  return (
    <AnalyticsPage
      title="Revenue Attribution"
      subtitle="Multi-touch attribution of order revenue to campaign messages (last 30 days)"
    >
      <ErrorBanner error={error} />

      {/* Model selector */}
      <div className="flex flex-wrap gap-1.5">
        {MODELS.map((m) => {
          const active = m.value === model
          return (
            <Link
              key={m.value}
              to={`?model=${m.value}`}
              className={buttonVariants({ variant: active ? 'primary' : 'secondary', size: 'sm' })}
            >
              {m.label}
            </Link>
          )
        })}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Total Attributed Revenue"
              value={formatPkr(result.totalAttributed)}
              sub={`${MODELS.find((m) => m.value === result.model)?.label ?? result.model} model`}
            />
            <KpiCard label="Channels" value={formatNumber(result.byChannel.length)} />
            <KpiCard label="Campaigns" value={formatNumber(result.byCampaign.length)} />
          </div>

          {/* By channel */}
          {result.byChannel.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue by channel</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={result.byChannel.map((c) => ({ label: c.channel, value: c.revenue }))}
                  height={240}
                  ariaLabel="Attributed revenue by channel"
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 pt-6">
              <SectionHeader title="By Channel" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Orders Touched</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.byChannel.length === 0 ? (
                    <TableEmpty colSpan={3}>No attributed revenue in this period.</TableEmpty>
                  ) : (
                    result.byChannel.map((c) => (
                      <TableRow key={c.channel}>
                        <TableCell className="text-neutral-900">{c.channel}</TableCell>
                        <TableCell className="tabular text-right text-neutral-900">{formatPkr(c.revenue)}</TableCell>
                        <TableCell className="tabular text-right text-neutral-600">{formatNumber(c.orders)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* By campaign */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <SectionHeader title="By Campaign" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">ROI / Recipient</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.byCampaign.length === 0 ? (
                    <TableEmpty colSpan={5}>No campaign-attributed revenue in this period.</TableEmpty>
                  ) : (
                    result.byCampaign.map((c) => (
                      <TableRow key={c.campaignId}>
                        <TableCell className="text-neutral-900">{c.name}</TableCell>
                        <TableCell className="text-neutral-600">{c.channel || '—'}</TableCell>
                        <TableCell className="tabular text-right text-neutral-900">{formatPkr(c.revenue)}</TableCell>
                        <TableCell className="tabular text-right text-neutral-600">
                          {formatNumber(c.recipientCount)}
                        </TableCell>
                        <TableCell className="tabular text-right text-neutral-600">
                          {c.roi == null ? '—' : formatPkr(c.roi)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </AnalyticsPage>
  )
}
