import { useEffect, useState } from 'react'
import { useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction, LinksFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import reactFlowStyles from '@xyflow/react/dist/style.css?url'
import { JourneyCanvas } from '~/components/journey/JourneyCanvas'
import type { ApiJourney } from '~/components/journey/types'

export const meta: MetaFunction = () => [{ title: 'Journey Builder — EngageIQ' }]

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: reactFlowStyles }]

interface LoaderData {
  journey: ApiJourney | null
  error: string | null
}

function apiBase(): string {
  return process.env['API_URL'] ?? 'http://localhost:3001'
}

export async function loader({ params }: LoaderFunctionArgs) {
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiBase()}/api/v1/journeys/${params['id']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journey: null, error: 'Journey not found' })
    const body = (await res.json()) as { data: ApiJourney }
    return json<LoaderData>({ journey: body.data, error: null })
  } catch {
    return json<LoaderData>({ journey: null, error: 'Network error reaching the API' })
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const token = process.env['DEV_TOKEN'] ?? ''
  const id = params['id'] ?? ''
  const formData = await request.formData()
  const intent = formData.get('intent') as string
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  async function readError(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      return body.error?.message ?? fallback
    } catch {
      return fallback
    }
  }

  if (intent === 'save') {
    let nodes: unknown
    try {
      nodes = JSON.parse((formData.get('nodes') as string) ?? '[]')
    } catch {
      return json({ error: 'Could not serialise the canvas' }, { status: 400 })
    }
    const res = await fetch(`${apiBase()}/api/v1/journeys/${id}/graph`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ nodes }),
    })
    if (!res.ok) return json({ error: await readError(res, 'Failed to save') }, { status: res.status })
    return json({ ok: true, message: 'Saved' })
  }

  if (intent === 'activate' || intent === 'pause' || intent === 'archive') {
    const res = await fetch(`${apiBase()}/api/v1/journeys/${id}/${intent}`, { method: 'POST', headers })
    if (!res.ok) return json({ error: await readError(res, `Failed to ${intent}`) }, { status: res.status })
    return json({ ok: true, message: `${intent[0]!.toUpperCase()}${intent.slice(1)}d` })
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

export default function JourneyBuilderPage(): JSX.Element {
  const { journey, error } = useLoaderData<LoaderData>()

  // React Flow measures the DOM and uses ResizeObserver, so it must run client-side only.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (error || !journey) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <p style={{ color: '#dc2626' }}>{error ?? 'Journey not found'}</p>
        <a href="/journeys" style={{ color: '#4f46e5' }}>← Back to journeys</a>
      </div>
    )
  }

  if (!mounted) {
    return (
      <div style={{ padding: '2rem', color: '#9ca3af', fontFamily: 'Inter, system-ui, sans-serif' }}>
        Loading builder…
      </div>
    )
  }

  return <JourneyCanvas journey={journey} />
}
