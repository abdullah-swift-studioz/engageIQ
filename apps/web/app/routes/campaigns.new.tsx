import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Textarea,
  FormField,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'New Campaign — EngageIQ' }]

interface SegmentOption {
  id: string
  name: string
  memberCount: number
}

interface LoaderData {
  segments: SegmentOption[]
}

interface ActionData {
  error: string | null
}

export async function loader({}: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiUrl}/api/v1/segments?page=1&pageSize=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ segments: [] })
    const body = (await res.json()) as { data: SegmentOption[] }
    return json<LoaderData>({ segments: body.data })
  } catch {
    return json<LoaderData>({ segments: [] })
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const formData = await request.formData()

  const segmentId = (formData.get('segmentId') as string) || undefined
  const body = {
    name: formData.get('name'),
    channel: formData.get('channel'),
    segmentId,
    subject: (formData.get('subject') as string) || undefined,
    body: formData.get('body'),
    utmCampaign: (formData.get('utmCampaign') as string) || undefined,
    utmSource: (formData.get('utmSource') as string) || undefined,
    utmMedium: (formData.get('utmMedium') as string) || undefined,
  }

  const res = await fetch(`${apiUrl}/api/v1/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } }
    return json<ActionData>({ error: err.error?.message ?? 'Failed to create campaign' })
  }

  const created = (await res.json()) as { data: { id: string } }
  return redirect(`/campaigns/${created.data.id}`)
}

export default function NewCampaignPage() {
  const { segments } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()
  const nav = useNavigation()
  const saving = nav.state === 'submitting'

  return (
    <div className="mx-auto max-w-[720px] px-6 py-6">
      <Breadcrumb items={[{ label: 'Campaigns', href: '/campaigns' }, { label: 'New' }]} />
      <PageHeader
        eyebrow="Engage"
        title="New campaign"
        description="Compose a one-time blast and target it to a segment."
      />

      {actionData?.error && (
        <p className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {actionData.error}
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <Form method="post" className="space-y-4">
            <FormField label="Name">
              <Input name="name" required placeholder="Spring sale blast" autoFocus />
            </FormField>

            <FormField label="Channel">
              <Select name="channel" required defaultValue="WHATSAPP">
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
                <option value="PUSH">Push</option>
              </Select>
            </FormField>

            <FormField label="Target segment">
              <Select name="segmentId" required defaultValue="">
                <option value="">— select a segment —</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.memberCount.toLocaleString()} members)
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Subject" hint="Email only.">
              <Input name="subject" placeholder="Your spring picks are here" />
            </FormField>

            <FormField label="Message body">
              <Textarea name="body" required rows={5} placeholder="Write your message…" />
            </FormField>

            <details className="rounded-lg border border-neutral-200 p-4">
              <summary className="cursor-pointer text-sm font-medium text-neutral-600">
                UTM tracking (optional)
              </summary>
              <div className="mt-3 space-y-3">
                <FormField label="utm_campaign">
                  <Input name="utmCampaign" placeholder="utm_campaign" />
                </FormField>
                <FormField label="utm_source">
                  <Input name="utmSource" placeholder="utm_source" />
                </FormField>
                <FormField label="utm_medium">
                  <Input name="utmMedium" placeholder="utm_medium" />
                </FormField>
              </div>
            </details>

            <div className="flex justify-end gap-2">
              <Link to="/campaigns">
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" isLoading={saving}>
                Create draft
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
