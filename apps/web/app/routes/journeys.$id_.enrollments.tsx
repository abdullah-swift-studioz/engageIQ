import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Enrollments — EngageIQ' }]

interface Enrollment {
  id: string
  customerId: string
  status: string
  enrolledAt: string
  completedAt: string | null
  exitedAt: string | null
  lastStepAt: string | null
  currentStepId: string | null
}

interface LoaderData {
  journeyId: string
  enrollments: Enrollment[]
  total: number
  error: string | null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'
  const status = url.searchParams.get('status') ?? ''
  const journeyId = params['id'] ?? ''

  try {
    const qs = new URLSearchParams({ page, pageSize: '20' })
    if (status) qs.set('status', status)
    const res = await fetch(`${apiUrl}/api/v1/journeys/${journeyId}/enrollments?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journeyId, enrollments: [], total: 0, error: 'Failed to load enrollments' })
    const body = await res.json() as { data: Enrollment[]; meta: { total: number } }
    return json<LoaderData>({ journeyId, enrollments: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ journeyId, enrollments: [], total: 0, error: 'Network error' })
  }
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#2563eb',
  COMPLETED: '#16a34a',
  EXITED: '#d97706',
  FAILED: '#dc2626',
}

export default function EnrollmentsPage() {
  const { journeyId, enrollments, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: '1rem' }}>
        <a href={`/journeys/${journeyId}`} style={{ color: '#2563eb', textDecoration: 'none', fontSize: '0.9rem' }}>
          ← Back to Journey
        </a>
      </div>
      <h1 style={{ marginBottom: '1.5rem' }}>Enrollments ({total})</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {enrollments.length === 0 && !error && (
        <p style={{ color: '#6b7280' }}>No enrollments yet.</p>
      )}

      {enrollments.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Customer ID</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Status</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Enrolled At</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Last Step At</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Completed / Exited</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Current Step</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0' }}>
                  <a href={`/customers/${e.customerId}`} style={{ color: '#2563eb' }}>{e.customerId.slice(0, 12)}…</a>
                </td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0' }}>
                  <span style={{ background: STATUS_COLORS[e.status] ?? '#6b7280', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>
                    {e.status}
                  </span>
                </td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0' }}>{new Date(e.enrolledAt).toLocaleString()}</td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0' }}>{e.lastStepAt ? new Date(e.lastStepAt).toLocaleString() : '—'}</td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0' }}>
                  {e.completedAt ? new Date(e.completedAt).toLocaleString() : e.exitedAt ? new Date(e.exitedAt).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0', color: '#6b7280', fontSize: '0.8rem' }}>
                  {e.currentStepId ? e.currentStepId.slice(0, 12) + '…' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
