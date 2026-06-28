import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Messages — EngageIQ' }]

interface MessageRow {
  id: string
  channel: string
  direction: 'OUTBOUND' | 'INBOUND'
  status: string
  body: string
  toPhone: string
  fromPhone: string | null
  errorTitle: string | null
  createdAt: string
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null
  template: { id: string; name: string } | null
}

interface Stats {
  totalOutbound: number
  totalInbound: number
  sent: number
  delivered: number
  read: number
  failed: number
  deliveryRate: number
  readRate: number
  optOutCount: number
}

interface LoaderData {
  messages: MessageRow[]
  total: number
  stats: Stats | null
  error: string | null
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  QUEUED: { bg: '#f3f4f6', fg: '#374151' },
  SENT: { bg: '#e0f2fe', fg: '#075985' },
  DELIVERED: { bg: '#ddd6fe', fg: '#5b21b6' },
  READ: { bg: '#dcfce7', fg: '#166534' },
  FAILED: { bg: '#fee2e2', fg: '#991b1b' },
  RECEIVED: { bg: '#fef9c3', fg: '#854d0e' },
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const page = new URL(request.url).searchParams.get('page') ?? '1'
  const headers = { Authorization: `Bearer ${token}` }

  try {
    const [listRes, statsRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/messages?page=${page}&pageSize=30`, { headers }),
      fetch(`${apiUrl}/api/v1/messages/stats`, { headers }),
    ])
    if (!listRes.ok) return json<LoaderData>({ messages: [], total: 0, stats: null, error: 'Failed to load messages' })
    const listBody = (await listRes.json()) as { data: MessageRow[]; meta: { total: number } }
    const stats = statsRes.ok ? ((await statsRes.json()) as { data: Stats }).data : null
    return json<LoaderData>({ messages: listBody.data, total: listBody.meta.total, stats, error: null })
  } catch {
    return json<LoaderData>({ messages: [], total: 0, stats: null, error: 'Network error' })
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.75rem 1rem', minWidth: 110 }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>{label}</div>
    </div>
  )
}

export default function MessagesPage() {
  const { messages, total, stats, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Messages ({total})</h1>
        <Link to="/whatsapp-templates" style={{ color: '#2563eb' }}>WhatsApp templates →</Link>
      </div>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>}

      {stats && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <Stat label="Outbound" value={stats.totalOutbound} />
          <Stat label="Delivery rate" value={pct(stats.deliveryRate)} />
          <Stat label="Read rate" value={pct(stats.readRate)} />
          <Stat label="Failed" value={stats.failed} />
          <Stat label="Inbound" value={stats.totalInbound} />
          <Stat label="Opted out" value={stats.optOutCount} />
        </div>
      )}

      {messages.length === 0 && !error && <p style={{ color: '#666' }}>No messages yet.</p>}

      {messages.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0.75rem' }}>When</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>Dir</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>Status</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>To / From</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>Body</th>
              <th style={{ padding: '0.5rem 0.75rem' }}>Template</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => {
              const c = STATUS_COLORS[m.status] ?? STATUS_COLORS.QUEUED
              return (
                <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{new Date(m.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{m.direction === 'OUTBOUND' ? '↑' : '↓'}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ background: c!.bg, color: c!.fg, padding: '2px 8px', borderRadius: '9999px', fontSize: '0.7rem' }}>{m.status}</span>
                    {m.errorTitle && <div style={{ color: '#991b1b', fontSize: '0.65rem' }}>{m.errorTitle}</div>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>{m.direction === 'OUTBOUND' ? m.toPhone : m.fromPhone}</td>
                  <td style={{ padding: '0.5rem 0.75rem', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.body}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', color: '#6b7280' }}>{m.template?.name ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
