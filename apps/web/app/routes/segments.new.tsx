import { useNavigate } from '@remix-run/react'
import type { MetaFunction } from '@remix-run/node'
import { PageHeader, Breadcrumb } from '~/components/ui'
import { SegmentBuilder } from '../components/SegmentBuilder.js'
import type { SegmentGroup } from '@engageiq/shared'

export const meta: MetaFunction = () => [{ title: 'New Segment — EngageIQ' }]

export default function NewSegmentPage() {
  const navigate = useNavigate()

  const apiUrl = typeof window !== 'undefined' ? '' : (process.env['API_URL'] ?? 'http://localhost:3001')
  const token = typeof window !== 'undefined' ? '' : (process.env['DEV_TOKEN'] ?? '')

  async function handleSave(name: string, description: string, conditions: SegmentGroup) {
    const res = await fetch(`${apiUrl}/api/v1/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, conditions }),
    })
    if (res.ok) {
      const body = await res.json() as { data: { id: string } }
      navigate(`/segments/${body.data.id}`)
    } else {
      const body = await res.json() as { error?: { message?: string } }
      throw new Error(body.error?.message ?? 'Failed to create segment')
    }
  }

  return (
    <div className="mx-auto max-w-[820px] px-6 py-6">
      <Breadcrumb items={[{ label: 'Segments', href: '/segments' }, { label: 'New' }]} />
      <PageHeader
        eyebrow="Audience"
        title="New segment"
        description="Define conditions to target the right customers."
      />
      <SegmentBuilder onSave={handleSave} />
    </div>
  )
}
