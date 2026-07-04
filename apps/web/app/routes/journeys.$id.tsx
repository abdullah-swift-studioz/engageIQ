import { Form, Link, useLoaderData, useActionData, useNavigation } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  buttonVariants,
  FormField,
  Input,
  Textarea,
  Select,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Journey — EngageIQ' }]

interface JourneyStep {
  id: string
  stepType: string
  label: string | null
  config: unknown
  parentStepId: string | null
}

interface Journey {
  id: string
  name: string
  description: string | null
  triggerType: string
  triggerConfig: unknown
  status: string
  reEntryRule: string
  exitTrigger: string | null
  enrollmentCount: number
  completionCount: number
  steps: JourneyStep[]
}

interface LoaderData {
  journey: Journey | null
  error: string | null
}

interface ActionData {
  error: string | null
  success: string | null
}

export async function loader({ params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  try {
    const res = await fetch(`${apiUrl}/api/v1/journeys/${params['id']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journey: null, error: 'Journey not found' })
    const body = await res.json() as { data: Journey }
    return json<LoaderData>({ journey: body.data, error: null })
  } catch {
    return json<LoaderData>({ journey: null, error: 'Network error' })
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'activate') {
    const res = await fetch(`${apiUrl}/api/v1/journeys/${params['id']}/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json() as { error: { message: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to activate', success: null })
    }
    return redirect(`/journeys/${params['id'] ?? ''}`)
  }

  if (intent === 'pause') {
    const res = await fetch(`${apiUrl}/api/v1/journeys/${params['id']}/pause`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json() as { error: { message: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to pause', success: null })
    }
    return redirect(`/journeys/${params['id'] ?? ''}`)
  }

  if (intent === 'update') {
    const triggerConfigRaw = formData.get('triggerConfig') as string
    let triggerConfig: unknown = {}
    try {
      triggerConfig = triggerConfigRaw ? JSON.parse(triggerConfigRaw) : {}
    } catch {
      return json<ActionData>({ error: 'triggerConfig must be valid JSON', success: null })
    }

    const body = {
      name: formData.get('name'),
      description: formData.get('description') || null,
      triggerType: formData.get('triggerType'),
      triggerConfig,
      reEntryRule: formData.get('reEntryRule'),
      exitTrigger: formData.get('exitTrigger') || null,
    }

    const res = await fetch(`${apiUrl}/api/v1/journeys/${params['id']}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json() as { error: { message: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to update', success: null })
    }
    return json<ActionData>({ error: null, success: 'Journey updated' })
  }

  return json<ActionData>({ error: 'Unknown intent', success: null })
}

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  ACTIVE: 'solid',
  DRAFT: 'subtle',
  PAUSED: 'outline',
  ARCHIVED: 'subtle',
}

export default function JourneyDetailPage() {
  const { journey, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()
  const nav = useNavigation()

  if (error || !journey) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Breadcrumb items={[{ label: 'Journeys', href: '/journeys' }, { label: 'Not found' }]} />
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error ?? 'Journey not found'}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: 'Journeys', href: '/journeys' }, { label: journey.name }]} />
      <PageHeader
        eyebrow="Journey"
        title={journey.name}
        description={journey.description ?? undefined}
        actions={
          <Badge variant={STATUS_VARIANT[journey.status] ?? 'subtle'} dot>
            {journey.status}
          </Badge>
        }
      />

      {actionData?.error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {actionData.error}
        </p>
      )}
      {actionData?.success && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.CheckCircle className="size-4" />
          {actionData.success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {journey.status === 'DRAFT' && (
          <Form method="post">
            <input type="hidden" name="intent" value="activate" />
            <Button type="submit" size="sm">
              Activate
            </Button>
          </Form>
        )}
        {journey.status === 'ACTIVE' && (
          <Form method="post">
            <input type="hidden" name="intent" value="pause" />
            <Button type="submit" size="sm" variant="secondary">
              Pause
            </Button>
          </Form>
        )}
        <Link
          to={`/journeys/${journey.id}/enrollments`}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          View Enrollments ({journey.enrollmentCount})
        </Link>
        {/* lane:journey START — entry point to the visual builder (canonical 6.1) */}
        <Link
          to={`/journeys/builder/${journey.id}`}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          <Icons.Workflow className="size-4" />
          Open Visual Builder
        </Link>
        {/* lane:journey END */}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
            <dt className="text-neutral-500">Trigger</dt>
            <dd className="text-neutral-950">{journey.triggerType}</dd>
            <dt className="text-neutral-500">Trigger Config</dt>
            <dd className="font-mono text-neutral-950">{JSON.stringify(journey.triggerConfig)}</dd>
            <dt className="text-neutral-500">Re-Entry Rule</dt>
            <dd className="text-neutral-950">{journey.reEntryRule}</dd>
            <dt className="text-neutral-500">Exit Trigger</dt>
            <dd className="text-neutral-950">{journey.exitTrigger ?? '—'}</dd>
            <dt className="text-neutral-500">Enrolled</dt>
            <dd className="tabular text-neutral-950">{journey.enrollmentCount}</dd>
            <dt className="text-neutral-500">Completed</dt>
            <dd className="tabular text-neutral-950">{journey.completionCount}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Steps ({journey.steps.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {journey.steps.length === 0 && <p className="text-sm text-neutral-500">No steps yet.</p>}
          {journey.steps.map((step, i) => (
            <div key={step.id} className="rounded-lg border border-neutral-200 p-3">
              <div className="mb-1 flex items-center justify-between">
                <strong className="text-sm text-neutral-950">
                  {i + 1}. {step.stepType}
                </strong>
                {step.label && <span className="text-xs text-neutral-500">label: {step.label}</span>}
              </div>
              <code className="font-mono text-xs text-neutral-600">{JSON.stringify(step.config)}</code>
              {step.parentStepId && (
                <div className="text-2xs text-neutral-400">parent: {step.parentStepId}</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {journey.status === 'DRAFT' && (
        <Card>
          <CardHeader>
            <CardTitle>Edit Journey</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="update" />
              <FormField label="Name">
                <Input name="name" defaultValue={journey.name} />
              </FormField>
              <FormField label="Description">
                <Textarea name="description" defaultValue={journey.description ?? ''} rows={2} />
              </FormField>
              <FormField label="Trigger type">
                <Select name="triggerType" defaultValue={journey.triggerType}>
                  <option value="order_placed">order_placed</option>
                  <option value="segment_entered">segment_entered</option>
                  <option value="custom_event">custom_event</option>
                  <option value="scheduled">scheduled</option>
                </Select>
              </FormField>
              <FormField label="Trigger config (JSON)">
                <Textarea
                  name="triggerConfig"
                  defaultValue={JSON.stringify(journey.triggerConfig)}
                  rows={2}
                  className="font-mono"
                />
              </FormField>
              <FormField label="Re-entry rule">
                <Select name="reEntryRule" defaultValue={journey.reEntryRule}>
                  <option value="DISALLOW">DISALLOW</option>
                  <option value="ALLOW">ALLOW</option>
                  <option value="RE_ENROLL_AFTER_EXIT">RE_ENROLL_AFTER_EXIT</option>
                </Select>
              </FormField>
              <FormField label="Exit trigger">
                <Select name="exitTrigger" defaultValue={journey.exitTrigger ?? ''}>
                  <option value="">None</option>
                  <option value="order_placed">order_placed</option>
                  <option value="segment_entered">segment_entered</option>
                  <option value="custom_event">custom_event</option>
                </Select>
              </FormField>
              <Button type="submit" isLoading={nav.state === 'submitting'}>
                Save Changes
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
