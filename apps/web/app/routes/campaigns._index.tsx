import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Campaigns — EngageIQ' }]

interface CampaignListItem {
  id: string
  name: string
  channel: string
  status: string
  segmentId: string | null
  sendAt: string | null
  sentAt: string | null
  recipientCount: number
  deliveredCount: number
  createdAt: string
}

interface LoaderData {
  campaigns: CampaignListItem[]
  total: number
  error: string | null
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  DRAFT: { bg: '#f3f4f6', fg: '#374151' },
  SCHEDULED: { bg: '#fef3c7', fg: '#92400e' },
  SENDING: { bg: '#dbeafe', fg: '#1d4ed8' },
  SENT: { bg: '#dcfce7', fg: '#166534' },
  PAUSED: { bg: '#fee2e2', fg: '#991b1b' },
  CANCELLED: { bg: '#e5e7eb', fg: '#6b7280' },
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/campaigns?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      return json<LoaderData>({ campaigns: [], total: 0, error: 'Failed to load campaigns' })
    }
    const body = (await res.json()) as { data: CampaignListItem[]; meta: { total: number } }
    return json<LoaderData>({ campaigns: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ campaigns: [], total: 0, error: 'Network error' })
  }
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: '#f3f4f6', fg: '#374151' }
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
      }}
    >
      {status}
    </span>
  )
}

export default function CampaignsPage() {
  const { campaigns, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Campaigns ({total})</h1>
        <Link
          to="/campaigns/new"
          style={{ background: '#2563eb', color: '#fff', padding: '0.5rem 1rem', borderRadius: '4px', textDecoration: 'none' }}
        >
          + New Campaign
        </Link>
      </div>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>}

      {campaigns.length === 0 && !error && (
        <p style={{ color: '#666' }}>No campaigns yet. Create a one-time blast to a segment.</p>
      )}

      {campaigns.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Name</th>
              <th style={{ padding: '0.75rem 1rem' }}>Channel</th>
              <th style={{ padding: '0.75rem 1rem' }}>Status</th>
              <th style={{ padding: '0.75rem 1rem' }}>Recipients</th>
              <th style={{ padding: '0.75rem 1rem' }}>Send / Sent</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <Link to={`/campaigns/${c.id}`} style={{ color: '#2563eb' }}>
                    {c.name}
                  </Link>
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{c.channel}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <StatusBadge status={c.status} />
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{c.recipientCount.toLocaleString()}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  {c.sentAt
                    ? `Sent ${new Date(c.sentAt).toLocaleString()}`
                    : c.sendAt
                      ? `Scheduled ${new Date(c.sendAt).toLocaleString()}`
                      : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
