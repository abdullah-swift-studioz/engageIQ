import { useState } from 'react'
import { Form, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'

export const meta: MetaFunction = () => [{ title: 'New WhatsApp Template — EngageIQ' }]

interface ActionData {
  error: string
}

function isRtl(language: string): boolean {
  return /^(ur|ar|fa|ps|sd)/i.test(language.trim())
}

export async function action({ request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const form = await request.formData()

  let variableMap: Array<{ index: number; field: string; default?: string }> = []
  try {
    variableMap = JSON.parse((form.get('variableMap') as string) || '[]')
  } catch {
    return json<ActionData>({ error: 'Invalid variableMap JSON' }, { status: 400 })
  }

  const res = await fetch(`${apiUrl}/api/v1/whatsapp-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: form.get('name'),
      language: form.get('language'),
      category: form.get('category'),
      bodyText: form.get('bodyText'),
      variableMap,
    }),
  })

  if (res.ok) {
    const body = (await res.json()) as { data: { id: string } }
    return redirect(`/whatsapp-templates/${body.data.id}`)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  return json<ActionData>({ error: body.error?.message ?? 'Failed to create template' }, { status: 400 })
}

interface VarRow {
  field: string
  default: string
}

const label: React.CSSProperties = { display: 'block', fontSize: '0.8rem', color: '#374151', marginBottom: '0.25rem' }
const input: React.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'monospace', boxSizing: 'border-box' }

export default function NewTemplatePage() {
  const actionData = useActionData<ActionData>()
  const navigation = useNavigation()
  const [language, setLanguage] = useState('en')
  const [bodyText, setBodyText] = useState('Hi {{1}}, your order is confirmed.')
  const [rows, setRows] = useState<VarRow[]>([{ field: 'firstName', default: 'there' }])

  const variableMap = rows.map((r, i) => ({
    index: i + 1,
    field: r.field,
    ...(r.default ? { default: r.default } : {}),
  }))

  // Live preview: substitute {{n}} with the row default (or a placeholder) and apply RTL.
  const preview = bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
    const row = rows[parseInt(n, 10) - 1]
    return row?.default || `‹${row?.field ?? `var${n}`}›`
  })

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: 900 }}>
      <h1>New WhatsApp Template</h1>
      {actionData?.error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {actionData.error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <Form method="post">
          <div style={{ marginBottom: '1rem' }}>
            <label style={label}>Name (lowercase_with_underscores)</label>
            <input style={input} name="name" defaultValue="order_confirmation" required />
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Language code (en, ur, ar_AE…)</label>
              <input style={input} name="language" value={language} onChange={(e) => setLanguage(e.target.value)} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Category</label>
              <select style={input} name="category" defaultValue="UTILITY">
                <option value="UTILITY">UTILITY</option>
                <option value="MARKETING">MARKETING</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={label}>Body (use {'{{1}}'}, {'{{2}}'} … for variables)</label>
            <textarea style={{ ...input, minHeight: 100 }} name="bodyText" value={bodyText} onChange={(e) => setBodyText(e.target.value)} required />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={label}>Variables (in {'{{n}}'} order)</label>
            {rows.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <span style={{ color: '#6b7280' }}>{`{{${i + 1}}}`}</span>
                <input
                  style={input}
                  placeholder="profile field (e.g. firstName)"
                  value={row.field}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))}
                />
                <input
                  style={input}
                  placeholder="default (optional)"
                  value={row.default}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, default: e.target.value } : r)))}
                />
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} style={{ cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setRows([...rows, { field: '', default: '' }])} style={{ cursor: 'pointer' }}>
              + Add variable
            </button>
          </div>

          <input type="hidden" name="variableMap" value={JSON.stringify(variableMap)} />
          <button
            type="submit"
            disabled={navigation.state === 'submitting'}
            style={{ background: '#2563eb', color: '#fff', padding: '0.5rem 1.25rem', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
          >
            {navigation.state === 'submitting' ? 'Saving…' : 'Save as Draft'}
          </button>
        </Form>

        <div>
          <label style={label}>Preview {isRtl(language) ? '(RTL)' : ''}</label>
          <div
            dir={isRtl(language) ? 'rtl' : 'ltr'}
            style={{
              background: '#dcf8c6',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              whiteSpace: 'pre-wrap',
              fontFamily: isRtl(language) ? "'Noto Naskh Arabic', serif" : 'inherit',
              minHeight: 80,
            }}
          >
            {preview}
          </div>
          <p style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            Variables resolve from the customer profile at send time; the default shown here is the fallback.
          </p>
        </div>
      </div>
    </div>
  )
}
