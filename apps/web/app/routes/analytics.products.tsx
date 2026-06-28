import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { ProductRetentionResult } from '@engageiq/shared'
import {
  AnalyticsPage,
  ErrorBanner,
  fetchAnalytics,
  formatNumber,
  formatPct,
  formatPkr,
} from '../components/analytics/ui'

export const meta: MetaFunction = () => [{ title: 'Product Retention — EngageIQ' }]

interface LoaderData {
  result: ProductRetentionResult | null
  error: string | null
}

interface ActionData {
  enqueued: boolean
  error: string | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const { data, error } = await fetchAnalytics<ProductRetentionResult>('/api/v1/analytics/products')
  return json<LoaderData>({ result: data, error })
}

export async function action(_args: LoaderFunctionArgs) {
  const { error } = await fetchAnalytics<{ enqueued: boolean }>(
    '/api/v1/analytics/products/recompute',
    { method: 'POST' },
  )
  return json<ActionData>({ enqueued: error == null, error })
}

function formatDays(value: number | null): string {
  if (value == null || isNaN(value)) return '—'
  return `${value.toFixed(1)} d`
}

function formatComputedAt(iso: string | null): string {
  if (iso == null) return 'Never computed'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Never computed'
  return `Last computed ${d.toLocaleString('en-PK')}`
}

export default function AnalyticsProducts() {
  const { result, error } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isRecomputing = navigation.state !== 'idle' && navigation.formMethod === 'POST'

  const products = result?.products ?? []

  return (
    <AnalyticsPage
      title="Product Retention"
      subtitle="Per-product repurchase, cross-sell and return metrics, ranked by retention value"
    >
      <ErrorBanner error={error} />

      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">{formatComputedAt(result?.computedAt ?? null)}</p>
        <Form method="post">
          <button
            type="submit"
            disabled={isRecomputing}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRecomputing ? 'Recomputing…' : 'Recompute'}
          </button>
        </Form>
      </div>

      {actionData?.enqueued && (
        <div className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-700">
            Recompute queued. Refresh in a moment to see updated metrics.
          </p>
        </div>
      )}
      {actionData?.error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">{actionData.error}</p>
        </div>
      )}

      {products.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No product metrics yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Either this store has no products, or the analytics job has not run yet. Click
            “Recompute” to queue it.
          </p>
        </div>
      )}

      {products.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">#</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Repurchase 90d</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Cross-sell</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Return rate</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Avg buyer LTV</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Days to 2nd</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Retention value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p, i) => (
                <tr key={p.productId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.title}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPct(p.repurchaseRate90d)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPct(p.crossSellRate)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPct(p.returnRate)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPkr(p.avgBuyerLtv)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {formatDays(p.avgDaysToSecondPurchase)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {p.retentionValue == null ? '—' : formatNumber(Math.round(p.retentionValue))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsPage>
  )
}
