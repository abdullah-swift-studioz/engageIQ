import { Form, useLoaderData, useActionData } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'

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

export default function JourneyDetailPage() {
  const { journey, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()

  if (error || !journey) {
    return <div style={{ padding: '2rem', fontFamily: 'monospace' }}><p style={{ color: 'red' }}>{error ?? 'Journey not found'}</p></div>
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '700px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>{journey.name}</h1>
        <span style={{ fontSize: '0.85rem', background: journey.status === 'ACTIVE' ? '#16a34a' : '#6b7280', color: '#fff', padding: '2px 10px', borderRadius: '12px' }}>
          {journey.status}
        </span>
      </div>

      {actionData?.error && <p style={{ color: 'red' }}>{actionData.error}</p>}
      {actionData?.success && <p style={{ color: 'green' }}>{actionData.success}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        {journey.status === 'DRAFT' && (
          <Form method="post">
            <input type="hidden" name="intent" value="activate" />
            <button type="submit" style={{ padding: '0.4rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Activate
            </button>
          </Form>
        )}
        {journey.status === 'ACTIVE' && (
          <Form method="post">
            <input type="hidden" name="intent" value="pause" />
            <button type="submit" style={{ padding: '0.4rem 1rem', background: '#d97706', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Pause
            </button>
          </Form>
        )}
        <a href={`/journeys/${journey.id}/enrollments`} style={{ padding: '0.4rem 1rem', background: '#f3f4f6', color: '#111', textDecoration: 'none', borderRadius: '4px' }}>
          View Enrollments ({journey.enrollmentCount})
        </a>
        {/* lane:journey START — entry point to the visual builder (canonical 6.1) */}
        <a href={`/journeys/builder/${journey.id}`} style={{ padding: '0.4rem 1rem', background: '#4f46e5', color: '#fff', textDecoration: 'none', borderRadius: '4px' }}>
          Open Visual Builder
        </a>
        {/* lane:journey END */}
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Details</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '0.4rem 0', fontSize: '0.9rem' }}>
          <dt style={{ color: '#6b7280' }}>Trigger</dt><dd>{journey.triggerType}</dd>
          <dt style={{ color: '#6b7280' }}>Trigger Config</dt><dd><code>{JSON.stringify(journey.triggerConfig)}</code></dd>
          <dt style={{ color: '#6b7280' }}>Re-Entry Rule</dt><dd>{journey.reEntryRule}</dd>
          <dt style={{ color: '#6b7280' }}>Exit Trigger</dt><dd>{journey.exitTrigger ?? '—'}</dd>
          <dt style={{ color: '#6b7280' }}>Enrolled</dt><dd>{journey.enrollmentCount}</dd>
          <dt style={{ color: '#6b7280' }}>Completed</dt><dd>{journey.completionCount}</dd>
        </dl>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Steps ({journey.steps.length})</h2>
        {journey.steps.length === 0 && <p style={{ color: '#6b7280' }}>No steps yet.</p>}
        {journey.steps.map((step, i) => (
          <div key={step.id} style={{ border: '1px solid #e5e7eb', borderRadius: '4px', padding: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <strong>{i + 1}. {step.stepType}</strong>
              {step.label && <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>label: {step.label}</span>}
            </div>
            <code style={{ fontSize: '0.8rem', color: '#374151' }}>{JSON.stringify(step.config)}</code>
            {step.parentStepId && <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>parent: {step.parentStepId}</div>}
          </div>
        ))}
      </section>

      {journey.status === 'DRAFT' && (
        <section>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Edit Journey</h2>
          <Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="hidden" name="intent" value="update" />
            <label>
              Name
              <input name="name" defaultValue={journey.name} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }} />
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={journey.description ?? ''} rows={2} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }} />
            </label>
            <label>
              Trigger Type
              <select name="triggerType" defaultValue={journey.triggerType} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}>
                <option value="order_placed">order_placed</option>
                <option value="segment_entered">segment_entered</option>
                <option value="custom_event">custom_event</option>
                <option value="scheduled">scheduled</option>
              </select>
            </label>
            <label>
              Trigger Config (JSON)
              <textarea name="triggerConfig" defaultValue={JSON.stringify(journey.triggerConfig)} rows={2} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.85rem' }} />
            </label>
            <label>
              Re-Entry Rule
              <select name="reEntryRule" defaultValue={journey.reEntryRule} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}>
                <option value="DISALLOW">DISALLOW</option>
                <option value="ALLOW">ALLOW</option>
                <option value="RE_ENROLL_AFTER_EXIT">RE_ENROLL_AFTER_EXIT</option>
              </select>
            </label>
            <label>
              Exit Trigger
              <select name="exitTrigger" defaultValue={journey.exitTrigger ?? ''} style={{ display: 'block', width: '100%', padding: '0.4rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}>
                <option value="">None</option>
                <option value="order_placed">order_placed</option>
                <option value="segment_entered">segment_entered</option>
                <option value="custom_event">custom_event</option>
              </select>
            </label>
            <button type="submit" style={{ padding: '0.4rem 1.5rem', background: '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', alignSelf: 'flex-start' }}>
              Save Changes
            </button>
          </Form>
        </section>
      )}
    </div>
  )
}
