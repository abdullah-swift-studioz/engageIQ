import { useLoaderData, useNavigate } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { SegmentGroup } from '@engageiq/shared'
import { SegmentBuilder } from '../components/SegmentBuilder.js'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  EmptyState,
  Icons,
} from '~/components/ui'

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
    return (
      <div className="flex flex-col gap-6 p-6">
        <Breadcrumb items={[{ label: 'Segments', href: '/segments' }, { label: 'Not found' }]} />
        <EmptyState
          icon={<Icons.AlertCircle className="size-6" />}
          title="Segment not found"
          description={error ?? 'This segment could not be loaded.'}
        />
      </div>
    )
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
    <div className="mx-auto flex max-w-[820px] flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: 'Segments', href: '/segments' }, { label: segment.name }]} />
      <PageHeader
        eyebrow="Audience"
        title={segment.name}
        description={`${segment.memberCount.toLocaleString()} members${
          segment.lastEvaluatedAt
            ? ` · Last evaluated ${new Date(segment.lastEvaluatedAt).toLocaleString()}`
            : ' · Never evaluated'
        }`}
        actions={
          <Button variant="secondary" onClick={() => { void handleReEvaluate() }}>
            Re-evaluate
          </Button>
        }
      />

      {segment.preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview (first {segment.preview.length} matches)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-neutral-700">
              {segment.preview.map((c) => (
                <li key={c.id}>
                  {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.id}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
