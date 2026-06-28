import { Form, Link, useActionData, useLoaderData } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Campaign — EngageIQ' }]

interface CampaignDetail {
  id: string
  name: string
  channel: string
  status: string
  subject: string | null
  content: { body?: string } | null
  segmentId: string | null
  sendAt: string | null
  sentAt: string | null
  recipientCount: number
  deliveredCount: number
  openedCount: number
  clickedCount: number
  utmCampaign: string | null
  utmSource: string | null
  utmMedium: string | null
  createdAt: string
  segment: { id: string; name: string; memberCount: number } | null
  recipientBreakdown: Record<string, number>
}

interface LoaderData {
  campaign: CampaignDetail | null
  error: string | null
}

interface ActionData {
  error: string | null
}

function apiBase() {
  return {
    apiUrl: process.env['API_URL'] ?? 'http://localhost:3001',
    token: process.env['DEV_TOKEN'] ?? '',
  }
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { apiUrl, token } = apiBase()
  try {
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${params['id']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return json<LoaderData>({ campaign: null, error: 'Campaign not found' })
    if (!res.ok) return json<LoaderData>({ campaign: null, error: 'Failed to load campaign' })
    const body = (await res.json()) as { data: CampaignDetail }
    return json<LoaderData>({ campaign: body.data, error: null })
  } catch {
    return json<LoaderData>({ campaign: null, error: 'Network error' })
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { apiUrl, token } = apiBase()
  const formData = await request.formData()
  const intent = formData.get('intent') as string
  const id = params['id']
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  if (intent === 'delete') {
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${id}`, { method: 'DELETE', headers: authHeaders })
    if (!res.ok && res.status !== 204) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to delete' })
    }
    return redirect('/campaigns')
  }

  if (intent === 'cancel') {
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${id}/cancel`, { method: 'POST', headers: authHeaders })
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to cancel' })
    }
    return redirect(`/campaigns/${id}`)
  }

  if (intent === 'send' || intent === 'schedule') {
    const sendAtRaw = formData.get('sendAt') as string
    const payload =
      intent === 'schedule' && sendAtRaw
        ? { sendAt: new Date(sendAtRaw).toISOString() }
        : {}
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${id}/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to send' })
    }
    return redirect(`/campaigns/${id}`)
  }

  return json<ActionData>({ error: 'Unknown action' })
}

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '1rem',
  marginBottom: '1rem',
}

export default function CampaignDetailPage() {
  const { campaign, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()

  if (!campaign) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <p style={{ color: 'red' }}>{error ?? 'Campaign not found'}</p>
        <Link to="/campaigns">← Back to campaigns</Link>
      </div>
    )
  }

  const canSend = campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED'
  const canCancel = campaign.status === 'SCHEDULED' || campaign.status === 'PAUSED'
  const canDelete = campaign.status !== 'SENDING'

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '720px' }}>
      <Link to="/campaigns" style={{ color: '#6b7280' }}>← Back to campaigns</Link>
      <h1 style={{ marginTop: '0.5rem' }}>{campaign.name}</h1>
      <p style={{ color: '#6b7280' }}>
        {campaign.channel} · {campaign.status}
      </p>

      {actionData?.error && <p style={{ color: 'red' }}>{actionData.error}</p>}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Content</h3>
        {campaign.subject && <p><strong>Subject:</strong> {campaign.subject}</p>}
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f9fafb', padding: '0.75rem', borderRadius: '4px' }}>
          {campaign.content?.body ?? '(no body)'}
        </pre>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Target</h3>
        <p>
          Segment:{' '}
          {campaign.segment ? (
            <Link to={`/segments/${campaign.segment.id}`} style={{ color: '#2563eb' }}>
              {campaign.segment.name}
            </Link>
          ) : (
            <span style={{ color: '#b91c1c' }}>none (cannot send)</span>
          )}
          {campaign.segment && ` (${campaign.segment.memberCount.toLocaleString()} members)`}
        </p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Delivery</h3>
        <p>Recipients: {campaign.recipientCount.toLocaleString()}</p>
        <p>Delivered: {campaign.deliveredCount.toLocaleString()} · Opened: {campaign.openedCount.toLocaleString()} · Clicked: {campaign.clickedCount.toLocaleString()}</p>
        {Object.keys(campaign.recipientBreakdown).length > 0 && (
          <p style={{ color: '#6b7280' }}>
            {Object.entries(campaign.recipientBreakdown)
              .map(([s, n]) => `${s}: ${n}`)
              .join(' · ')}
          </p>
        )}
        {campaign.sentAt && <p>Sent at: {new Date(campaign.sentAt).toLocaleString()}</p>}
        {!campaign.sentAt && campaign.sendAt && <p>Scheduled for: {new Date(campaign.sendAt).toLocaleString()}</p>}
      </div>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h3 style={{ marginTop: 0 }}>Actions</h3>

        {canSend && (
          <Form method="post">
            <input type="hidden" name="intent" value="send" />
            <button type="submit" style={{ padding: '0.5rem 1.5rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Send Now
            </button>
          </Form>
        )}

        {canSend && (
          <Form method="post" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="hidden" name="intent" value="schedule" />
            <input type="datetime-local" name="sendAt" required style={{ padding: '0.4rem', border: '1px solid #d1d5db', borderRadius: '4px' }} />
            <button type="submit" style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Schedule
            </button>
          </Form>
        )}

        {canCancel && (
          <Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <button type="submit" style={{ padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Cancel Schedule
            </button>
          </Form>
        )}

        {canDelete && (
          <Form method="post" onSubmit={(e) => { if (!confirm('Delete this campaign?')) e.preventDefault() }}>
            <input type="hidden" name="intent" value="delete" />
            <button type="submit" style={{ padding: '0.5rem 1rem', background: '#fff', color: '#b91c1c', border: '1px solid #b91c1c', borderRadius: '4px', cursor: 'pointer' }}>
              Delete
            </button>
          </Form>
        )}
      </div>
    </div>
  )
}
