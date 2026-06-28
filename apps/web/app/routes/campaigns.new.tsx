import { Form, useActionData, useLoaderData } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'New Campaign — EngageIQ' }]

interface SegmentOption {
  id: string
  name: string
  memberCount: number
}

interface LoaderData {
  segments: SegmentOption[]
}

interface ActionData {
  error: string | null
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.5rem',
  marginTop: '0.25rem',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
}

export async function loader({}: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiUrl}/api/v1/segments?page=1&pageSize=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ segments: [] })
    const body = (await res.json()) as { data: SegmentOption[] }
    return json<LoaderData>({ segments: body.data })
  } catch {
    return json<LoaderData>({ segments: [] })
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const formData = await request.formData()

  const segmentId = (formData.get('segmentId') as string) || undefined
  const body = {
    name: formData.get('name'),
    channel: formData.get('channel'),
    segmentId,
    subject: (formData.get('subject') as string) || undefined,
    body: formData.get('body'),
    utmCampaign: (formData.get('utmCampaign') as string) || undefined,
    utmSource: (formData.get('utmSource') as string) || undefined,
    utmMedium: (formData.get('utmMedium') as string) || undefined,
  }

  const res = await fetch(`${apiUrl}/api/v1/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } }
    return json<ActionData>({ error: err.error?.message ?? 'Failed to create campaign' })
  }

  const created = (await res.json()) as { data: { id: string } }
  return redirect(`/campaigns/${created.data.id}`)
}

export default function NewCampaignPage() {
  const { segments } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '640px' }}>
      <h1>New Campaign</h1>
      {actionData?.error && <p style={{ color: 'red' }}>{actionData.error}</p>}
      <Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label>
          Name *<input name="name" required style={inputStyle} />
        </label>
        <label>
          Channel *
          <select name="channel" required style={inputStyle} defaultValue="WHATSAPP">
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
            <option value="PUSH">Push</option>
          </select>
        </label>
        <label>
          Target Segment *
          <select name="segmentId" required style={inputStyle}>
            <option value="">— select a segment —</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.memberCount.toLocaleString()} members)
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject (email only)
          <input name="subject" style={inputStyle} />
        </label>
        <label>
          Message Body *
          <textarea name="body" required rows={5} style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </label>
        <details>
          <summary style={{ cursor: 'pointer', color: '#6b7280' }}>UTM tracking (optional)</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input name="utmCampaign" placeholder="utm_campaign" style={inputStyle} />
            <input name="utmSource" placeholder="utm_source" style={inputStyle} />
            <input name="utmMedium" placeholder="utm_medium" style={inputStyle} />
          </div>
        </details>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <button type="submit" style={{ padding: '0.5rem 1.5rem', background: '#111', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Create Draft
          </button>
          <a href="/campaigns" style={{ padding: '0.5rem 1rem', color: '#6b7280', textDecoration: 'none' }}>
            Cancel
          </a>
        </div>
      </Form>
    </div>
  )
}
