import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'AI Clusters — EngageIQ' }]

interface ClusterView {
  index: number
  label: string
  size: number
  avgLtv: number
  avgRecencyDays: number
  avgFrequency: number
  avgMonetary: number
  description: string
  recommendedAction: string
  customerCount: number
}

interface LoaderData {
  runId: string | null
  runAt: string | null
  silhouette: number | null
  clusters: ClusterView[]
  error: string | null
}

interface ActionData {
  ok?: boolean
  segmentId?: string
  name?: string
  memberCount?: number
  error?: string
}

const apiBase = () => process.env['API_URL'] ?? 'http://localhost:3001'
const devToken = () => process.env['DEV_TOKEN'] ?? ''

export async function loader(_args: LoaderFunctionArgs) {
  try {
    const res = await fetch(`${apiBase()}/api/v1/clusters`, {
      headers: { Authorization: `Bearer ${devToken()}` },
    })
    if (!res.ok) {
      return json<LoaderData>({
        runId: null,
        runAt: null,
        silhouette: null,
        clusters: [],
        error: 'Failed to load clusters',
      })
    }
    const body = (await res.json()) as { data: Omit<LoaderData, 'error'> }
    return json<LoaderData>({ ...body.data, error: null })
  } catch {
    return json<LoaderData>({
      runId: null,
      runAt: null,
      silhouette: null,
      clusters: [],
      error: 'Network error',
    })
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const runId = String(form.get('runId') ?? '')
  const clusterIndex = Number(form.get('clusterIndex') ?? NaN)
  const name = String(form.get('name') ?? '').trim()

  if (!runId || Number.isNaN(clusterIndex)) {
    return json<ActionData>({ error: 'Missing run or cluster' }, { status: 400 })
  }

  try {
    const res = await fetch(`${apiBase()}/api/v1/clusters/${runId}/promote`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${devToken()}`,
      },
      body: JSON.stringify({ clusterIndex, ...(name ? { name } : {}) }),
    })
    const body = (await res.json()) as {
      success: boolean
      data?: { segmentId: string; name: string; memberCount: number }
      error?: { message: string }
    }
    if (!res.ok || !body.success) {
      return json<ActionData>(
        { error: body.error?.message ?? 'Promotion failed' },
        { status: res.status },
      )
    }
    return json<ActionData>({ ok: true, ...body.data })
  } catch {
    return json<ActionData>({ error: 'Network error' }, { status: 502 })
  }
}

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`

export default function ClustersPage() {
  const { runId, runAt, silhouette, clusters, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()
  const nav = useNavigation()
  const submitting = nav.state === 'submitting'

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h1>AI-Discovered Clusters</h1>
        <Link to="/segments" style={{ color: '#2563eb' }}>
          ← Segments
        </Link>
      </div>
      <p style={{ color: '#6b7280', marginTop: 0, marginBottom: '1.5rem' }}>
        Clusters found by the weekly AI segment-discovery run. Promote one to a static Segment
        you can target.
        {runAt && ` Last run: ${new Date(runAt).toLocaleString()}.`}
        {typeof silhouette === 'number' && ` Silhouette: ${silhouette.toFixed(3)}.`}
      </p>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>}

      {actionData?.ok && (
        <div style={{ background: '#ecfdf5', color: '#065f46', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem' }}>
          ✓ Created segment “{actionData.name}” with {actionData.memberCount} member(s).{' '}
          <Link to={`/segments/${actionData.segmentId}`} style={{ color: '#065f46', textDecoration: 'underline' }}>
            View
          </Link>
        </div>
      )}
      {actionData?.error && (
        <div style={{ background: '#fef2f2', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem' }}>
          {actionData.error}
        </div>
      )}

      {clusters.length === 0 && !error && (
        <p style={{ color: '#666' }}>
          No clusters yet. They appear after the AI segment-discovery scoring run completes
          (needs at least 3 customers with orders).
        </p>
      )}

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {clusters.map((c) => (
          <div key={c.index} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{c.label}</strong>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{c.customerCount} customers</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#374151', margin: '0.5rem 0' }}>{c.description}</p>
            <dl style={{ fontSize: '0.75rem', color: '#6b7280', margin: 0 }}>
              <div>Avg LTV (365d): {pkr(c.avgLtv)}</div>
              <div>Avg recency: {Math.round(c.avgRecencyDays)}d · Avg orders: {c.avgFrequency.toFixed(1)}</div>
              <div>Avg spend: {pkr(c.avgMonetary)}</div>
            </dl>
            {c.recommendedAction && (
              <p style={{ fontSize: '0.75rem', color: '#1d4ed8', margin: '0.5rem 0' }}>
                → {c.recommendedAction}
              </p>
            )}
            <Form method="post" style={{ marginTop: '0.75rem' }}>
              <input type="hidden" name="runId" value={runId ?? ''} />
              <input type="hidden" name="clusterIndex" value={c.index} />
              <input
                type="text"
                name="name"
                placeholder={c.label}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.5rem',
                  marginBottom: '0.5rem',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontFamily: 'inherit',
                  fontSize: '0.8rem',
                }}
              />
              <button
                type="submit"
                disabled={submitting || c.customerCount === 0}
                style={{
                  background: c.customerCount === 0 ? '#9ca3af' : '#2563eb',
                  color: '#fff',
                  padding: '0.4rem 0.9rem',
                  border: 'none',
                  borderRadius: 4,
                  cursor: c.customerCount === 0 ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.8rem',
                }}
              >
                {submitting ? 'Creating…' : 'Create official Segment'}
              </button>
            </Form>
          </div>
        ))}
      </div>
    </div>
  )
}
