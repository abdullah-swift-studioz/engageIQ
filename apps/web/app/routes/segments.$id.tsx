import { useLoaderData, useNavigate } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { SegmentGroup } from '@engageiq/shared'
import { SegmentBuilder } from '../components/SegmentBuilder.js'

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.segment?.name ?? 'Segment'} — EngageIQ` },
]

interface SegmentDetail {
  id: string
  name: string
  description: string | null
  conditions: SegmentGroup
  memberCount: number
  lastEvaluatedAt: string | null
  isDynamic: boolean
  preview: { id: string; email: string | null; firstName: string | null; lastName: string | null }[]
}

interface LoaderData {
  segment: SegmentDetail | null
  error: string | null
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  try {
    const res = await fetch(`${apiUrl}/api/v1/segments/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return json<LoaderData>({ segment: null, error: 'Segment not found' })
    if (!res.ok) return json<LoaderData>({ segment: null, error: 'Failed to load segment' })
    const body = await res.json() as { data: SegmentDetail }
    return json<LoaderData>({ segment: body.data, error: null })
  } catch {
    return json<LoaderData>({ segment: null, error: 'Network error' })
  }
}

export default function SegmentDetailPage() {
  const { segment, error } = useLoaderData<LoaderData>()
  const navigate = useNavigate()
  const apiUrl = typeof window !== 'undefined' ? '' : (process.env['API_URL'] ?? 'http://localhost:3001')
  const token = typeof window !== 'undefined' ? '' : (process.env['DEV_TOKEN'] ?? '')

  if (error || !segment) {
    return <div style={{ padding: '2rem', color: 'red' }}>{error ?? 'Segment not found'}</div>
  }

  async function handleSave(name: string, description: string, conditions: SegmentGroup) {
    const res = await fetch(`/api/v1/segments/${segment!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, conditions }),
    })
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'Failed to update segment')
    }
    navigate(0)
  }

  async function handleReEvaluate() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/segments/${segment!.id}/evaluate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        throw new Error(`Server responded with status ${res.status}`)
      }
      alert('Evaluation queued. Refresh in a few seconds to see updated member count.')
    } catch (err) {
      alert(`Re-evaluate failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1>{segment.name}</h1>
          <p style={{ color: '#6b7280', margin: 0 }}>
            {segment.memberCount.toLocaleString()} members
            {segment.lastEvaluatedAt
              ? ` · Last evaluated: ${new Date(segment.lastEvaluatedAt).toLocaleString()}`
              : ' · Never evaluated'}
          </p>
        </div>
        <button
          onClick={() => { void handleReEvaluate() }}
          style={{
            padding: '0.5rem 1rem',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Re-evaluate
        </button>
      </div>

      {segment.preview.length > 0 && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f9fafb', borderRadius: '4px' }}>
          <strong>Preview (first {segment.preview.length} matches):</strong>
          <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
            {segment.preview.map((c) => (
              <li key={c.id} style={{ marginBottom: '0.25rem' }}>
                {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.id}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SegmentBuilder
        initialName={segment.name}
        initialDescription={segment.description ?? ''}
        initialConditions={segment.conditions as SegmentGroup}
        onSave={handleSave}
      />
    </div>
  )
}
