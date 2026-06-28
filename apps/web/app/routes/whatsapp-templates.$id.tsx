import { Form, Link, useLoaderData, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'Template — EngageIQ' }]

interface VariableMapEntry {
  index: number
  field: string
  default?: string
}

interface TemplateDetail {
  id: string
  name: string
  language: string
  category: string
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'
  bodyText: string
  variableMap: VariableMapEntry[]
  metaTemplateId: string | null
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

interface LoaderData {
  template: TemplateDetail | null
  error: string | null
}

function apiCreds() {
  return {
    apiUrl: process.env['API_URL'] ?? 'http://localhost:3001',
    token: process.env['DEV_TOKEN'] ?? '',
  }
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { apiUrl, token } = apiCreds()
  try {
    const res = await fetch(`${apiUrl}/api/v1/whatsapp-templates/${params['id']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ template: null, error: 'Template not found' })
    const body = (await res.json()) as { data: TemplateDetail }
    return json<LoaderData>({ template: body.data, error: null })
  } catch {
    return json<LoaderData>({ template: null, error: 'Network error' })
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { apiUrl, token } = apiCreds()
  const form = await request.formData()
  const intent = form.get('_action')

  if (intent === 'delete') {
    await fetch(`${apiUrl}/api/v1/whatsapp-templates/${params['id']}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return redirect('/whatsapp-templates')
  }

  if (intent === 'submit') {
    const res = await fetch(`${apiUrl}/api/v1/whatsapp-templates/${params['id']}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return json({ error: body.error?.message ?? 'Submit failed' }, { status: 400 })
    }
    return json({ error: null })
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  DRAFT: { bg: '#f3f4f6', fg: '#374151' },
  PENDING: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dcfce7', fg: '#166534' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
}

export default function TemplateDetailPage() {
  const { template, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<{ error: string | null }>()
  const navigation = useNavigation()

  if (error || !template) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <Link to="/whatsapp-templates" style={{ color: '#2563eb' }}>← Templates</Link>
        <p style={{ color: 'red', marginTop: '1rem' }}>{error ?? 'Not found'}</p>
      </div>
    )
  }

  const c = STATUS_COLORS[template.status] ?? STATUS_COLORS.DRAFT
  const canSubmit = template.status === 'DRAFT' || template.status === 'REJECTED'

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: 800 }}>
      <Link to="/whatsapp-templates" style={{ color: '#2563eb' }}>← Templates</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0' }}>
        <h1 style={{ margin: 0 }}>{template.name}</h1>
        <span style={{ background: c!.bg, color: c!.fg, padding: '4px 12px', borderRadius: '9999px', fontSize: '0.8rem' }}>
          {template.status}
        </span>
      </div>

      {actionData?.error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {actionData.error}</div>}

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.5rem 1rem', marginBottom: '1.5rem' }}>
        <dt style={{ color: '#6b7280' }}>Language</dt><dd>{template.language}</dd>
        <dt style={{ color: '#6b7280' }}>Category</dt><dd>{template.category}</dd>
        {template.metaTemplateId && (<><dt style={{ color: '#6b7280' }}>Meta ID</dt><dd>{template.metaTemplateId}</dd></>)}
        {template.rejectionReason && (
          <><dt style={{ color: '#6b7280' }}>Rejection</dt><dd style={{ color: '#991b1b' }}>{template.rejectionReason}</dd></>
        )}
      </dl>

      <h3>Body</h3>
      <pre style={{ background: '#f9fafb', padding: '1rem', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>{template.bodyText}</pre>

      <h3>Variables</h3>
      {template.variableMap.length === 0 ? (
        <p style={{ color: '#6b7280' }}>None</p>
      ) : (
        <ul>
          {template.variableMap.map((v) => (
            <li key={v.index}>{`{{${v.index}}}`} → {v.field}{v.default ? ` (default: "${v.default}")` : ' (no default → required)'}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
        {canSubmit && (
          <Form method="post">
            <input type="hidden" name="_action" value="submit" />
            <button
              type="submit"
              disabled={navigation.state === 'submitting'}
              style={{ background: '#2563eb', color: '#fff', padding: '0.5rem 1.25rem', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
            >
              {navigation.state === 'submitting' ? 'Submitting…' : 'Submit to Meta'}
            </button>
          </Form>
        )}
        <Form method="post" onSubmit={(e) => { if (!confirm('Delete this template?')) e.preventDefault() }}>
          <input type="hidden" name="_action" value="delete" />
          <button type="submit" style={{ background: '#fff', color: '#991b1b', padding: '0.5rem 1.25rem', borderRadius: '4px', border: '1px solid #fca5a5', cursor: 'pointer' }}>
            Delete
          </button>
        </Form>
      </div>
    </div>
  )
}
