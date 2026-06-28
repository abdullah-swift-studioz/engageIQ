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
      <div className="mb-6 flex flex-wrap gap-1">
        {MODELS.map((m) => {
          const active = m.value === model
          return (
            <Link
              key={m.value}
              to={`?model=${m.value}`}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                active
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:text-gray-900'
              }`}
            >
              {m.label}
            </Link>
          )
        })}
      </div>

      {result && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="Total Attributed Revenue"
              value={formatPkr(result.totalAttributed)}
              sub={`${MODELS.find((m) => m.value === result.model)?.label ?? result.model} model`}
            />
            <KpiCard label="Channels" value={formatNumber(result.byChannel.length)} />
            <KpiCard label="Campaigns" value={formatNumber(result.byCampaign.length)} />
          </div>

          {/* By channel */}
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">By Channel</h2>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Channel</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Revenue</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Orders Touched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.byChannel.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                        No attributed revenue in this period.
                      </td>
                    </tr>
                  )}
                  {result.byChannel.map((c) => (
                    <tr key={c.channel}>
                      <td className="px-4 py-2 text-gray-900">{c.channel}</td>
                      <td className="px-4 py-2 text-right text-gray-900">{formatPkr(c.revenue)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{formatNumber(c.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* By campaign */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">By Campaign</h2>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Campaign</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Channel</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Revenue</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Recipients</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">ROI / Recipient</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.byCampaign.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                        No campaign-attributed revenue in this period.
                      </td>
                    </tr>
                  )}
                  {result.byCampaign.map((c) => (
                    <tr key={c.campaignId}>
                      <td className="px-4 py-2 text-gray-900">{c.name}</td>
                      <td className="px-4 py-2 text-gray-600">{c.channel || '—'}</td>
                      <td className="px-4 py-2 text-right text-gray-900">{formatPkr(c.revenue)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {formatNumber(c.recipientCount)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {c.roi == null ? '—' : formatPkr(c.roi)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </AnalyticsPage>
  )
}
