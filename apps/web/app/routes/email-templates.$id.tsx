import { json, redirect } from '@remix-run/node'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import type { EmailBlock } from '@engageiq/shared'
import { PageHeader, Breadcrumb } from '~/components/ui'
import { EmailBuilder, type EmailTemplateData } from '~/components/email/EmailBuilder'
import { apiFetch, apiFetchList } from '~/lib/email-api.server'

export const meta: MetaFunction = () => [{ title: 'Edit email template — EngageIQ' }]

interface ApiTemplate {
  id: string
  name: string
  subject: string | null
  preheader: string | null
  blocks: EmailBlock[]
  status: string
  isTransactional: boolean
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params['id'] as string
  const [tpl, segments] = await Promise.all([
    apiFetch<ApiTemplate>(`/api/v1/email-templates/${id}`),
    apiFetchList<{ id: string; name: string }>('/api/v1/segments?pageSize=100'),
  ])
  if (!tpl.ok || !tpl.data) throw new Response('Template not found', { status: 404 })
  return json({
    template: tpl.data,
    segments: segments.data.map((s) => ({ id: s.id, name: s.name })),
  })
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = params['id'] as string
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  if (intent === 'preview' || intent === 'save') {
    const payload = JSON.parse(String(form.get('payload') ?? '{}')) as Partial<EmailTemplateData>
    const saveRes = await apiFetch(`/api/v1/email-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: payload.name,
        subject: payload.subject ?? null,
        preheader: payload.preheader ?? null,
        blocks: payload.blocks ?? [],
        isTransactional: payload.isTransactional ?? false,
      }),
    })
    if (!saveRes.ok) return json({ error: saveRes.error })
    if (intent === 'save') return json({ saved: true })

    const [preview, spam] = await Promise.all([
      apiFetch<{ html: string; subject: string }>(`/api/v1/email-templates/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      apiFetch<{ score: number; rating: string; issues: unknown[]; subject: string }>(
        `/api/v1/email-templates/${id}/spam-check`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    ])
    return json({
      html: preview.data?.html ?? '',
      subject: preview.data?.subject ?? '',
      spam: spam.data ?? null,
    })
  }

  if (intent === 'send') {
    const segmentId = String(form.get('segmentId') ?? '')
    const res = await apiFetch<{ enqueued: number }>(`/api/v1/email-templates/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({ segmentId }),
    })
    return json({ sent: res.ok ? res.data : { enqueued: 0 }, error: res.error })
  }

  if (intent === 'test') {
    const toEmail = String(form.get('toEmail') ?? '')
    const res = await apiFetch<{ ok: boolean; error?: string }>(`/api/v1/email-templates/${id}/test-send`, {
      method: 'POST',
      body: JSON.stringify({ toEmail }),
    })
    return json({ sent: res.data ?? { ok: false, error: res.error } })
  }

  if (intent === 'delete') {
    await apiFetch(`/api/v1/email-templates/${id}`, { method: 'DELETE' })
    return redirect('/email-templates')
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

export default function EmailTemplateBuilderPage() {
  const { template, segments } = useLoaderData<typeof loader>()
  const data: EmailTemplateData = {
    id: template.id,
    name: template.name,
    subject: template.subject,
    preheader: template.preheader,
    blocks: template.blocks ?? [],
    status: template.status,
    isTransactional: template.isTransactional,
  }
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Breadcrumb items={[{ label: 'Email Templates', href: '/email-templates' }, { label: template.name }]} />
      <PageHeader eyebrow="Email" title={template.name} description="Design, preview, and send your email." />
      <EmailBuilder template={data} segments={segments} />
    </div>
  )
}
