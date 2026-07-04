import { Form, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { AnalyticsPeriodKey, FunnelResult } from '@engageiq/shared'
import { AnalyticsPage, ErrorBanner, fetchAnalytics, formatNumber, formatPct } from '../components/analytics/ui'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
  Button,
  Input,
  Select,
  Label,
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

      <Card>
        <CardContent className="pt-6">
          <Form method="post">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div>
                <Label htmlFor="steps" className="mb-1 block">
                  Funnel steps (ordered, comma-separated event types)
                </Label>
                <Input
                  id="steps"
                  name="steps"
                  type="text"
                  defaultValue={steps.join(', ')}
                  placeholder="page_view, product_view, add_to_cart, checkout_started, purchase"
                />
              </div>
              <div>
                <Label htmlFor="period" className="mb-1 block">
                  Period
                </Label>
                <Select id="period" name="period" defaultValue={period}>
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" isLoading={isSubmitting}>
                {isSubmitting ? 'Computing…' : 'Run funnel'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              Common events: page_view, product_view, collection_view, add_to_cart, remove_from_cart,
              checkout_started, checkout_step, purchase
            </p>
          </Form>
        </CardContent>
      </Card>

      {!result && !error && (
        <EmptyState
          icon={<Icons.BarChart />}
          title="Build a funnel to begin"
          description="Choose an ordered list of events and a period, then run the funnel."
        />
      )}

      {result && <FunnelChart result={result} />}
    </AnalyticsPage>
  )
}

function FunnelChart({ result }: { result: FunnelResult }) {
  const totalEntered = result.totalEntered

  if (totalEntered === 0) {
    return (
      <EmptyState
        icon={<Icons.AlertCircle />}
        title="No visitors entered this funnel"
        description={`No one performed the first step (${result.steps[0]?.step ?? '—'}) in the selected period.`}
      />
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Entered" value={formatNumber(totalEntered)} />
        <StatCard label="Overall conversion" value={formatPct(result.overallConversion)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step conversion</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart
            data={result.steps.map((s) => ({ label: s.step, value: s.count }))}
            height={260}
            valueFormatter={formatNumber}
            ariaLabel="Visitors reaching each funnel step"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Step</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">% of entered</TableHead>
                <TableHead className="text-right">Drop-off from prev</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.steps.map((s, i) => (
                <TableRow key={`${s.step}-${i}`}>
                  <TableCell className="text-neutral-400">{i + 1}</TableCell>
                  <TableCell className="font-medium text-neutral-900">{s.step}</TableCell>
                  <TableCell className="tabular text-right">{formatNumber(s.count)}</TableCell>
                  <TableCell className="tabular text-right text-neutral-600">
                    {formatPct(s.conversionFromFirst)}
                  </TableCell>
                  <TableCell className="text-right">
                    {i > 0 && s.dropOffFromPrev > 0 ? (
                      <span className="inline-flex items-center justify-end gap-1 font-medium text-neutral-900 [&_svg]:size-3.5">
                        <Icons.ArrowDownRight />
                        <span className="tabular">{formatPct(s.dropOffFromPrev)}</span>
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
