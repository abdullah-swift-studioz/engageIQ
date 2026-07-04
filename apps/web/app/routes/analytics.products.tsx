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
import {
  Card,
  CardContent,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Icons,
} from '~/components/ui'

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

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-neutral-500">{formatComputedAt(result?.computedAt ?? null)}</p>
        <Form method="post">
          <Button type="submit" isLoading={isRecomputing} leftIcon={<Icons.Sparkles />}>
            {isRecomputing ? 'Recomputing…' : 'Recompute'}
          </Button>
        </Form>
      </div>

      {actionData?.enqueued && (
        <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-xs">
          <Icons.CheckCircle className="mt-0.5 size-4 shrink-0 text-neutral-700" />
          <p className="text-sm font-medium text-neutral-900">
            Recompute queued. Refresh in a moment to see updated metrics.
          </p>
        </div>
      )}
      {actionData?.error && (
        <div className="flex items-start gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
          <Icons.AlertCircle className="mt-0.5 size-4 shrink-0 text-neutral-700" />
          <p className="text-sm font-medium text-neutral-900">{actionData.error}</p>
        </div>
      )}

      {products.length === 0 && !error && (
        <EmptyState
          icon={<Icons.Inbox />}
          title="No product metrics yet"
          description="Either this store has no products, or the analytics job has not run yet. Click “Recompute” to queue it."
        />
      )}

      {products.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Repurchase 90d</TableHead>
                  <TableHead className="text-right">Cross-sell</TableHead>
                  <TableHead className="text-right">Return rate</TableHead>
                  <TableHead className="text-right">Avg buyer LTV</TableHead>
                  <TableHead className="text-right">Days to 2nd</TableHead>
                  <TableHead className="text-right">Retention value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p, i) => (
                  <TableRow key={p.productId}>
                    <TableCell className="text-neutral-400">{i + 1}</TableCell>
                    <TableCell className="font-medium text-neutral-900">{p.title}</TableCell>
                    <TableCell className="tabular text-right text-neutral-700">{formatPct(p.repurchaseRate90d)}</TableCell>
                    <TableCell className="tabular text-right text-neutral-700">{formatPct(p.crossSellRate)}</TableCell>
                    <TableCell className="tabular text-right text-neutral-700">{formatPct(p.returnRate)}</TableCell>
                    <TableCell className="tabular text-right text-neutral-700">{formatPkr(p.avgBuyerLtv)}</TableCell>
                    <TableCell className="tabular text-right text-neutral-700">
                      {formatDays(p.avgDaysToSecondPurchase)}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold text-neutral-950">
                      {p.retentionValue == null ? '—' : formatNumber(Math.round(p.retentionValue))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AnalyticsPage>
  )
}
