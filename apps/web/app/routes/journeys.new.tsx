import { Form, useActionData } from '@remix-run/react'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'New Journey — EngageIQ' }]

interface ActionData {
  error: string | null
}

export async function action({ request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const formData = await request.formData()

  const triggerType = formData.get('triggerType') as string
  const triggerConfigRaw = formData.get('triggerConfig') as string
  let triggerConfig: unknown = {}
  try {
    triggerConfig = triggerConfigRaw ? JSON.parse(triggerConfigRaw) : {}
  } catch {
    return json<ActionData>({ error: 'triggerConfig must be valid JSON' })
  }

  const body = {
    name: formData.get('name'),
    description: formData.get('description') || null,
    triggerType,
    triggerConfig,
    reEntryRule: formData.get('reEntryRule') || 'DISALLOW',
    exitTrigger: formData.get('exitTrigger') || null,
  }

  const res = await fetch(`${apiUrl}/api/v1/journeys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json() as { error: { message: string } }
    return json<ActionData>({ error: err.error?.message ?? 'Failed to create journey' })
  }

  const created = await res.json() as { data: { id: string } }
  return redirect(`/journeys/${created.data.id}`)
}

export default function NewJourneyPage() {
  const actionData = useActionData<ActionData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '600px' }}>
      <h1>New Journey</h1>
      {actionData?.error && <p style={{ color: 'red' }}>{actionData.error}</p>}
      <Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label>
          Name *
          <input name="name" required style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }} />
        </label>
        <label>
          Description
          <textarea name="description" rows={2} style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }} />
        </label>
        <label>
          Trigger Type *
          <select name="triggerType" required style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}>
            <option value="order_placed">order_placed</option>
            <option value="segment_entered">segment_entered</option>
            <option value="custom_event">custom_event</option>
            <option value="scheduled">scheduled</option>
          </select>
        </label>
        <label>
          Trigger Config (JSON)
          <textarea name="triggerConfig" rows={3} placeholder='{}'
            style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'monospace' }} />
        </label>
        <label>
          Re-Entry Rule
          <select name="reEntryRule" style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}>
            <option value="DISALLOW">DISALLOW (once only)</option>
            <option value="ALLOW">ALLOW (re-enter any time)</option>
            <option value="RE_ENROLL_AFTER_EXIT">RE_ENROLL_AFTER_EXIT</option>
          </select>
        </label>
        <label>
          Exit Trigger (optional)
          <select name="exitTrigger" style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px' }}>
            <option value="">None</option>
            <option value="order_placed">order_placed</option>
            <option value="segment_entered">segment_entered</option>
            <option value="custom_event">custom_event</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <button type="submit" style={{ padding: '0.5rem 1.5rem', background: '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Create Journey
          </button>
          <a href="/journeys" style={{ padding: '0.5rem 1rem', color: '#6b7280', textDecoration: 'none' }}>Cancel</a>
        </div>
      </Form>
    </div>
  )
}
