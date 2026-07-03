import { json, redirect } from '@remix-run/node'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import {
  PageHeader,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  SectionHeader,
  StatCard,
  FormField,
  Input,
  Select,
  Badge,
  Icons,
} from '~/components/ui'
import { ElementForm } from '~/components/onsite/ElementForm'
import {
  apiGet,
  apiSend,
  parseElementForm,
  listSegmentOptions,
  type ElementDetail,
  type ElementStats,
  type SegmentOption,
} from '~/components/onsite/api.server'
import type { OnSiteElementConfig, OnSiteVariant } from '@engageiq/shared'

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.element?.name ?? 'Element'} — On-Site — EngageIQ` },
]

interface LoaderData {
  element: ElementDetail | null
  stats: ElementStats | null
  segments: SegmentOption[]
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params['id'] as string
  const element = await apiGet<ElementDetail>(`/api/v1/onsite/${id}`)
  if (!element) return json<LoaderData>({ element: null, stats: null, segments: [] }, { status: 404 })
  const [stats, segments] = await Promise.all([
    apiGet<ElementStats>(`/api/v1/onsite/${id}/stats`),
    listSegmentOptions(),
  ])
  return json<LoaderData>({ element, stats, segments })
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = params['id'] as string
  const fd = await request.formData()
  const intent = fd.get('intent')

  if (intent === 'delete') {
    await apiSend(`/api/v1/onsite/${id}`, 'DELETE')
    return redirect('/on-site')
  }

  if (intent === 'save') {
    const result = await apiSend(`/api/v1/onsite/${id}`, 'PUT', parseElementForm(fd))
    return json({ error: result.ok ? null : result.error, ok: result.ok })
  }

  if (intent === 'ab_create') {
    const base = (name: string) => (fd.get(name) as string | null)?.trim() || undefined
    const buildVariant = (i: number): { name: string; allocationPct: number; config: OnSiteElementConfig } => ({
      name: base(`v${i}_name`) ?? `Variant ${String.fromCharCode(65 + i)}`,
      allocationPct: Number(fd.get(`v${i}_alloc`) ?? 50),
      config: {
        headline: base(`v${i}_headline`),
        body: base(`v${i}_body`),
        ctaText: base(`v${i}_cta`),
      },
    })
    const result = await apiSend(`/api/v1/onsite/${id}/ab-test`, 'POST', {
      name: base('ab_name') ?? 'On-site A/B test',
      winnerMetric: 'conversion_rate',
      variants: [buildVariant(0), buildVariant(1)],
    })
    return json({ error: result.ok ? null : result.error, ok: result.ok })
  }

  if (intent === 'ab_stop') {
    const testId = fd.get('testId') as string
    const result = await apiSend(`/api/v1/onsite/${id}/ab-test/${testId}/stop`, 'POST')
    return json({ error: result.ok ? null : result.error, ok: result.ok })
  }

  if (intent === 'ab_decide') {
    const testId = fd.get('testId') as string
    const result = await apiSend(`/api/v1/onsite/${id}/ab-test/${testId}/decide`, 'POST', {
      winnerVariantId: fd.get('winnerVariantId'),
    })
    return json({ error: result.ok ? null : result.error, ok: result.ok })
  }

  return json({ error: 'Unknown action', ok: false }, { status: 400 })
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export default function OnSiteElementDetail() {
  const { element, stats, segments } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state === 'submitting'

  if (!element) {
    return (
      <div className="p-6">
        <PageHeader title="Element not found" description="This on-site element no longer exists." />
        <Link to="/on-site" className={buttonVariants({ variant: 'secondary' })}>
          Back to On-Site
        </Link>
      </div>
    )
  }

  const test = element.abTest
  const statByVariant = new Map((stats?.variants ?? []).map((v) => [v.variantId, v]))

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="On-Site"
        title={element.name}
        description={element.segment ? `Audience: ${element.segment.name}` : 'Audience: all visitors'}
        actions={
          <div className="flex items-center gap-3">
            <Badge variant={element.status === 'ACTIVE' ? 'solid' : 'subtle'} dot>
              {element.status}
            </Badge>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <Button type="submit" variant="destructive">
                Delete
              </Button>
            </Form>
          </div>
        }
      />

      {actionData?.error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {actionData.error}
        </p>
      )}

      {/* Performance */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Impressions" value={stats?.available ? stats.impressions.toLocaleString() : '—'} />
        <StatCard label="Conversions" value={stats?.available ? stats.conversions.toLocaleString() : '—'} />
        <StatCard
          label="Conversion rate"
          value={stats?.available ? pct(stats.conversionRate) : '—'}
          sub={stats && !stats.available ? 'Analytics unavailable' : undefined}
        />
      </div>

      {/* Edit form */}
      <Form method="post" className="flex flex-col gap-6">
        <input type="hidden" name="intent" value="save" />
        <ElementForm element={element} segments={segments} />
        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={busy}>
            Save changes
          </Button>
          <Link to="/on-site" className={buttonVariants({ variant: 'secondary' })}>
            Back
          </Link>
        </div>
      </Form>

      {/* A/B testing */}
      <Card>
        <CardHeader>
          <CardTitle>A/B test</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {test ? (
            <AbTestPanel test={test} statByVariant={statByVariant} busy={busy} />
          ) : (
            <AbTestCreate busy={busy} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AbTestPanel({
  test,
  statByVariant,
  busy,
}: {
  test: NonNullable<ElementDetail['abTest']>
  statByVariant: Map<string, { impressions: number; conversions: number; conversionRate: number }>
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <SectionHeader title={test.name} />
        <Badge variant={test.status === 'RUNNING' ? 'solid' : 'outline'} dot>
          {test.status}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        {test.variants.map((v: OnSiteVariant) => {
          const s = statByVariant.get(v.id)
          const isWinner = test.winnerVariantId === v.id
          return (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                {isWinner && <Icons.CheckCircle className="size-4" />}
                <span className="font-medium">{v.name}</span>
                <span className="text-2xs uppercase tracking-wider text-neutral-500">{v.allocationPct}%</span>
              </div>
              <div className="tabular text-sm text-neutral-600">
                {s ? `${s.impressions} imp · ${s.conversions} conv · ${(s.conversionRate * 100).toFixed(1)}%` : 'No data yet'}
              </div>
            </div>
          )
        })}
      </div>

      {test.status === 'RUNNING' && (
        <div className="flex flex-wrap items-end gap-3">
          <Form method="post" className="flex items-end gap-2">
            <input type="hidden" name="intent" value="ab_decide" />
            <input type="hidden" name="testId" value={test.id} />
            <FormField label="Declare winner">
              <Select name="winnerVariantId" defaultValue={test.variants[0]?.id}>
                {test.variants.map((v: OnSiteVariant) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button type="submit" variant="secondary" isLoading={busy}>
              Roll out winner
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="ab_stop" />
            <input type="hidden" name="testId" value={test.id} />
            <Button type="submit" variant="ghost">
              Stop test
            </Button>
          </Form>
        </div>
      )}
    </div>
  )
}

function AbTestCreate({ busy }: { busy: boolean }) {
  return (
    <Form method="post" className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="ab_create" />
      <p className="text-sm text-neutral-600">
        Split traffic between two variants. Each visitor is assigned deterministically and stays in the same
        variant, so results stay clean.
      </p>
      <FormField label="Test name">
        <Input name="ab_name" placeholder="Headline test" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
            <SectionHeader title={`Variant ${String.fromCharCode(65 + i)}`} />
            <FormField label="Name">
              <Input name={`v${i}_name`} defaultValue={`Variant ${String.fromCharCode(65 + i)}`} />
            </FormField>
            <FormField label="Traffic %">
              <Input name={`v${i}_alloc`} type="number" defaultValue={50} />
            </FormField>
            <FormField label="Headline override">
              <Input name={`v${i}_headline`} />
            </FormField>
            <FormField label="Button text override">
              <Input name={`v${i}_cta`} />
            </FormField>
          </div>
        ))}
      </div>
      <div>
        <Button type="submit" isLoading={busy}>
          Start A/B test
        </Button>
      </div>
    </Form>
  )
}
