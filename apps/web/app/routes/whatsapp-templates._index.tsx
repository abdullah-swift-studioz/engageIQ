import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'WhatsApp Templates — EngageIQ' }]

interface TemplateListItem {
  id: string
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING'
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
}

interface LoaderData {
  templates: TemplateListItem[]
  total: number
  error: string | null
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  DRAFT: { bg: '#f3f4f6', fg: '#374151' },
  PENDING: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dcfce7', fg: '#166534' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const page = new URL(request.url).searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/whatsapp-templates?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ templates: [], total: 0, error: 'Failed to load templates' })
    const body = (await res.json()) as { data: TemplateListItem[]; meta: { total: number } }
    return json<LoaderData>({ templates: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ templates: [], total: 0, error: 'Network error' })
  }
}

export default function WhatsAppTemplatesPage() {
  const { templates, total, error } = useLoaderData<LoaderData>()

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>WhatsApp Templates ({total})</h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link to="/messages" style={{ color: '#2563eb', alignSelf: 'center' }}>
            Message log →
          </Link>
          <Link
            to="/whatsapp-templates/new"
            style={{ background: '#2563eb', color: '#fff', padding: '0.5rem 1rem', borderRadius: '4px', textDecoration: 'none' }}
          >
            + New Template
          </Link>
        </div>
      </div>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>}
      {templates.length === 0 && !error && (
        <p style={{ color: '#666' }}>No templates yet. Create one and submit it to Meta for approval.</p>
      )}

      {templates.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Name</th>
              <th style={{ padding: '0.75rem 1rem' }}>Language</th>
              <th style={{ padding: '0.75rem 1rem' }}>Category</th>
              <th style={{ padding: '0.75rem 1rem' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const c = STATUS_COLORS[t.status] ?? STATUS_COLORS.DRAFT
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link to={`/whatsapp-templates/${t.id}`} style={{ color: '#2563eb' }}>
                      {t.name}
                    </Link>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>{t.language}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>{t.category}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ background: c!.bg, color: c!.fg, padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem' }}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
