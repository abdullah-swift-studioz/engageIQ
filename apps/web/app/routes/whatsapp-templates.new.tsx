import { useState } from 'react'
import { Form, Link, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardContent,
  FormField,
  Input,
  Textarea,
  Select,
  Button,
  buttonVariants,
  Icons,
} from '~/components/ui'

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
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: 'WhatsApp Templates', href: '/whatsapp-templates' }, { label: 'New' }]} />
      <PageHeader
        eyebrow="Channels"
        title="New WhatsApp template"
        description="Compose the body, map variables to profile fields, and preview before saving."
      />

      {actionData?.error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {actionData.error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <Form method="post" className="space-y-4">
              <FormField label="Name" hint="lowercase_with_underscores">
                <Input name="name" defaultValue="order_confirmation" required />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Language code" hint="en, ur, ar_AE…">
                  <Input
                    name="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    required
                  />
                </FormField>
                <FormField label="Category">
                  <Select name="category" defaultValue="UTILITY">
                    <option value="UTILITY">UTILITY</option>
                    <option value="MARKETING">MARKETING</option>
                  </Select>
                </FormField>
              </div>

              <FormField label="Body" hint="Use {{1}}, {{2}} … for variables">
                <Textarea
                  name="bodyText"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={5}
                  required
                />
              </FormField>

              <FormField label="Variables" hint="In {{n}} order.">
                <div className="flex flex-col gap-2">
                  {rows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 font-mono text-xs text-neutral-500">{`{{${i + 1}}}`}</span>
                      <Input
                        placeholder="profile field (e.g. firstName)"
                        value={row.field}
                        onChange={(e) =>
                          setRows(rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))
                        }
                      />
                      <Input
                        placeholder="default (optional)"
                        value={row.default}
                        onChange={(e) =>
                          setRows(rows.map((r, j) => (j === i ? { ...r, default: e.target.value } : r)))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove variable"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        <Icons.X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRows([...rows, { field: '', default: '' }])}
                    >
                      <Icons.Plus className="size-4" />
                      Add variable
                    </Button>
                  </div>
                </div>
              </FormField>

              <input type="hidden" name="variableMap" value={JSON.stringify(variableMap)} />
              <div className="flex justify-end gap-2">
                <Link to="/whatsapp-templates" className={buttonVariants({ variant: 'secondary' })}>
                  Cancel
                </Link>
                <Button type="submit" isLoading={navigation.state === 'submitting'}>
                  Save as Draft
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>

        <div>
          <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-neutral-500">
            Preview {isRtl(language) ? '(RTL)' : ''}
          </p>
          <div
            dir={isRtl(language) ? 'rtl' : 'ltr'}
            className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-950"
            style={{ fontFamily: isRtl(language) ? "'Noto Naskh Arabic', serif" : 'inherit' }}
          >
            {preview}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            Variables resolve from the customer profile at send time; the default shown here is the fallback.
          </p>
        </div>
      </div>
    </div>
  )
}
