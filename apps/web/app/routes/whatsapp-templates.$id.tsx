import { Form, Link, useLoaderData, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Icons,
} from '~/components/ui'

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

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  DRAFT: 'subtle',
  PENDING: 'outline',
  APPROVED: 'solid',
  REJECTED: 'outline',
}

function statusIcon(status: string) {
  if (status === 'APPROVED') return <Icons.CheckCircle className="size-3.5" />
  if (status === 'REJECTED') return <Icons.AlertCircle className="size-3.5" />
  return null
}

function isRtl(language: string): boolean {
  return /^(ur|ar|fa|ps|sd)/i.test(language.trim())
}

export default function TemplateDetailPage() {
  const { template, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<{ error: string | null }>()
  const navigation = useNavigation()

  if (error || !template) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Breadcrumb items={[{ label: 'WhatsApp Templates', href: '/whatsapp-templates' }, { label: 'Not found' }]} />
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error ?? 'Not found'}
        </p>
      </div>
    )
  }

  const canSubmit = template.status === 'DRAFT' || template.status === 'REJECTED'
  const rtl = isRtl(template.language)

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: 'WhatsApp Templates', href: '/whatsapp-templates' }, { label: template.name }]} />
      <PageHeader
        eyebrow="Channels"
        title={template.name}
        actions={
          <Badge variant={STATUS_VARIANT[template.status] ?? 'subtle'} dot>
            {statusIcon(template.status)}
            {template.status}
          </Badge>
        }
      />

      {actionData?.error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {actionData.error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-neutral-500">Language</dt>
            <dd className="text-neutral-950">{template.language}</dd>
            <dt className="text-neutral-500">Category</dt>
            <dd className="text-neutral-950">{template.category}</dd>
            {template.metaTemplateId && (
              <>
                <dt className="text-neutral-500">Meta ID</dt>
                <dd className="font-mono text-neutral-950">{template.metaTemplateId}</dd>
              </>
            )}
            {template.rejectionReason && (
              <>
                <dt className="text-neutral-500">Rejection</dt>
                <dd className="flex items-center gap-1.5 font-medium text-neutral-950">
                  <Icons.AlertCircle className="size-4" />
                  {template.rejectionReason}
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Body</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            dir={rtl ? 'rtl' : 'ltr'}
            className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-100 p-4 text-sm text-neutral-950"
            style={{ fontFamily: rtl ? "'Noto Naskh Arabic', serif" : 'inherit' }}
          >
            {template.bodyText}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
        </CardHeader>
        <CardContent>
          {template.variableMap.length === 0 ? (
            <p className="text-sm text-neutral-500">None</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-neutral-950">
              {template.variableMap.map((v) => (
                <li key={v.index}>
                  <span className="font-mono text-neutral-600">{`{{${v.index}}}`}</span> → {v.field}
                  {v.default ? ` (default: "${v.default}")` : ' (no default → required)'}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        {canSubmit && (
          <Form method="post">
            <input type="hidden" name="_action" value="submit" />
            <Button type="submit" isLoading={navigation.state === 'submitting'}>
              Submit to Meta
            </Button>
          </Form>
        )}
        <Form method="post" onSubmit={(e) => { if (!confirm('Delete this template?')) e.preventDefault() }}>
          <input type="hidden" name="_action" value="delete" />
          <Button type="submit" variant="destructive">
            Delete
          </Button>
        </Form>
      </div>
    </div>
  )
}
