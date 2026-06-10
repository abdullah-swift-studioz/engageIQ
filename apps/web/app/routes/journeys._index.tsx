import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Journeys — EngageIQ' }]

interface JourneyListItem {
  id: string
  name: string
  description: string | null
  triggerType: string
  status: string
  reEntryRule: string
  exitTrigger: string | null
  enrollmentCount: number
  completionCount: number
  createdAt: string
}

interface LoaderData {
  journeys: JourneyListItem[]
  total: number
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/journeys?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journeys: [], total: 0, error: 'Failed to load journeys' })
    const body = await res.json() as { data: JourneyListItem[]; meta: { total: number } }
    return json<LoaderData>({ journeys: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ journeys: [], total: 0, error: 'Network error' })
  }
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6b7280',
  ACTIVE: '#16a34a',
  PAUSED: '#d97706',
  ARCHIVED: '#9ca3af',
}

export default function JourneysPage() {
  const { journeys, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Journeys ({total})</h1>
        <Link to="/journeys/new" style={{ padding: '0.5rem 1rem', background: '#111', color: '#fff', textDecoration: 'none', borderRadius: '4px' }}>
          + New Journey
        </Link>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {journeys.length === 0 && !error && (
        <p style={{ color: '#6b7280' }}>No journeys yet. Create one to get started.</p>
      )}

      {journeys.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Name</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Trigger</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Status</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Enrolled</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Completed</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {journeys.map((j) => (
              <tr key={j.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.75rem 1rem 0.75rem 0' }}>
                  <Link to={`/journeys/${j.id}`} style={{ color: '#111', fontWeight: 600 }}>
                    {j.name}
                  </Link>
                  {j.description && <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{j.description}</div>}
                </td>
                <td style={{ padding: '0.75rem 1rem 0.75rem 0', color: '#374151' }}>{j.triggerType}</td>
                <td style={{ padding: '0.75rem 1rem 0.75rem 0' }}>
                  <span style={{ background: STATUS_COLORS[j.status] ?? '#6b7280', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>
                    {j.status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem 0.75rem 0' }}>{j.enrollmentCount}</td>
                <td style={{ padding: '0.75rem 1rem 0.75rem 0' }}>{j.completionCount}</td>
                <td style={{ padding: '0.75rem 1rem 0.75rem 0' }}>
                  <Link to={`/journeys/${j.id}`} style={{ color: '#2563eb', marginRight: '0.75rem' }}>Edit</Link>
                  <Link to={`/journeys/${j.id}/enrollments`} style={{ color: '#6b7280' }}>Enrollments</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
