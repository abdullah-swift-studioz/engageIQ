import { Form, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { AnalyticsPeriodKey, FunnelResult } from '@engageiq/shared'
import { AnalyticsPage, ErrorBanner, fetchAnalytics, formatNumber, formatPct } from '../components/analytics/ui'

export const meta: MetaFunction = () => [{ title: 'Funnel Analysis — EngageIQ' }]

const DEFAULT_STEPS = ['page_view', 'product_view', 'add_to_cart', 'checkout_started', 'purchase']

const PERIOD_OPTIONS: Array<{ value: Exclude<AnalyticsPeriodKey, 'custom'>; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

interface ActionData {
  result: FunnelResult | null
  error: string | null
  steps: string[]
  period: AnalyticsPeriodKey
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const rawSteps = String(form.get('steps') ?? '')
  const period = (String(form.get('period') ?? '30d') || '30d') as AnalyticsPeriodKey

  const steps = rawSteps
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (steps.length < 2) {
    return json<ActionData>({
      result: null,
      error: 'Enter at least 2 comma-separated event steps.',
      steps: steps.length > 0 ? steps : DEFAULT_STEPS,
      period,
    })
  }

  const { data, error } = await fetchAnalytics<FunnelResult>('/api/v1/analytics/funnel', {
    method: 'POST',
    body: JSON.stringify({ steps, period }),
  })

  return json<ActionData>({ result: data, error, steps, period })
}

export default function AnalyticsFunnel() {
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const steps = actionData?.steps ?? DEFAULT_STEPS
  const period = actionData?.period ?? '30d'
  const result = actionData?.result ?? null
  const error = actionData?.error ?? null

  return (
    <AnalyticsPage
      title="Funnel Analysis"
      subtitle="Measure step-by-step conversion across your store events"
    >
      <ErrorBanner error={error} />

      <Form method="post" className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label htmlFor="steps" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Funnel steps (ordered, comma-separated event types)
            </label>
            <input
              id="steps"
              name="steps"
              type="text"
              defaultValue={steps.join(', ')}
              placeholder="page_view, product_view, add_to_cart, checkout_started, purchase"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="period" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Period
            </label>
            <select
              id="period"
              name="period"
              defaultValue={period}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Computing…' : 'Run funnel'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Common events: page_view, product_view, collection_view, add_to_cart, remove_from_cart,
          checkout_started, checkout_step, purchase
        </p>
      </Form>

      {!result && !error && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">Build a funnel to begin</p>
          <p className="mt-1 text-sm text-gray-500">
            Choose an ordered list of events and a period, then run the funnel.
          </p>
        </div>
      )}

      {result && (
        <FunnelChart result={result} />
      )}
    </AnalyticsPage>
  )
}

function FunnelChart({ result }: { result: FunnelResult }) {
  const totalEntered = result.totalEntered

  if (totalEntered === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
        <p className="text-sm font-medium text-gray-900">No visitors entered this funnel</p>
        <p className="mt-1 text-sm text-gray-500">
          No one performed the first step ({result.steps[0]?.step ?? '—'}) in the selected period.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Entered</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatNumber(totalEntered)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Overall conversion</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatPct(result.overallConversion)}</p>
        </div>
      </div>

      <div className="space-y-2">
        {result.steps.map((s, i) => {
          const widthPct = totalEntered > 0 ? (s.count / totalEntered) * 100 : 0
          return (
            <div key={`${s.step}-${i}`} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  <span className="mr-2 text-gray-400">{i + 1}.</span>
                  {s.step}
                </span>
                <span className="text-sm text-gray-600">
                  {formatNumber(s.count)}{' '}
                  <span className="text-gray-400">({formatPct(s.conversionFromFirst)} of entered)</span>
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              {i > 0 && s.dropOffFromPrev > 0 && (
                <p className="mt-1 text-xs text-rose-600">
                  ▼ {formatPct(s.dropOffFromPrev)} drop-off from previous step
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
