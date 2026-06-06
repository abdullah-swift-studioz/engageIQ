import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Segments — EngageIQ' }]

interface SegmentListItem {
  id: string
  name: string
  description: string | null
  memberCount: number
  lastEvaluatedAt: string | null
  isDynamic: boolean
  createdAt: string
}

interface LoaderData {
  segments: SegmentListItem[]
  total: number
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/segments?page=${page}&pageSize=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      return json<LoaderData>({ segments: [], total: 0, error: 'Failed to load segments' })
    }
    const body = await res.json() as { data: SegmentListItem[]; meta: { total: number } }
    return json<LoaderData>({ segments: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ segments: [], total: 0, error: 'Network error' })
  }
}

export default function SegmentsPage() {
  const { segments, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Segments ({total})</h1>
        <Link
          to="/segments/new"
          style={{
            background: '#2563eb',
            color: '#fff',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            textDecoration: 'none',
          }}
        >
          + New Segment
        </Link>
      </div>

      {error && (
        <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>
      )}

      {segments.length === 0 && !error && (
        <p style={{ color: '#666' }}>No segments yet. Create your first segment to start targeting customers.</p>
      )}

      {segments.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Name</th>
              <th style={{ padding: '0.75rem 1rem' }}>Members</th>
              <th style={{ padding: '0.75rem 1rem' }}>Last Evaluated</th>
              <th style={{ padding: '0.75rem 1rem' }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => (
              <tr
                key={seg.id}
                style={{ borderBottom: '1px solid #e5e7eb' }}
              >
                <td style={{ padding: '0.75rem 1rem' }}>
                  <Link to={`/segments/${seg.id}`} style={{ color: '#2563eb' }}>
                    {seg.name}
                  </Link>
                  {seg.description && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px' }}>
                      {seg.description}
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{seg.memberCount.toLocaleString()}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  {seg.lastEvaluatedAt
                    ? new Date(seg.lastEvaluatedAt).toLocaleString()
                    : 'Never'}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span
                    style={{
                      background: seg.isDynamic ? '#dbeafe' : '#f3f4f6',
                      color: seg.isDynamic ? '#1d4ed8' : '#374151',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {seg.isDynamic ? 'Dynamic' : 'Static'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
