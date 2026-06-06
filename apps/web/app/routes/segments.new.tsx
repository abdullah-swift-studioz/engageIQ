import { useNavigate } from '@remix-run/react'
import type { MetaFunction } from '@remix-run/node'
import { SegmentBuilder } from '../components/SegmentBuilder.js'
import type { SegmentGroup } from '@engageiq/shared'

export const meta: MetaFunction = () => [{ title: 'New Segment — EngageIQ' }]

export default function NewSegmentPage() {
  const navigate = useNavigate()

  async function handleSave(name: string, description: string, conditions: SegmentGroup) {
    const apiUrl = '/api'
    const res = await fetch(`${apiUrl}/v1/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1>New Segment</h1>
      <SegmentBuilder onSave={handleSave} />
    </div>
  )
}
