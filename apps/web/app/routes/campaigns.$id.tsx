import { Form, Link, useActionData, useLoaderData } from '@remix-run/react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  StatCard,
  Button,
  Input,
  Badge,
  EmptyState,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Campaign — EngageIQ' }]

interface CampaignDetail {
  id: string
  name: string
  channel: string
  status: string
  subject: string | null
  content: { body?: string } | null
  segmentId: string | null
  sendAt: string | null
  sentAt: string | null
  recipientCount: number
  deliveredCount: number
  openedCount: number
  clickedCount: number
  utmCampaign: string | null
  utmSource: string | null
  utmMedium: string | null
  createdAt: string
  segment: { id: string; name: string; memberCount: number } | null
  recipientBreakdown: Record<string, number>
}

interface LoaderData {
  campaign: CampaignDetail | null
  error: string | null
}

interface ActionData {
  error: string | null
}

// Monochrome badge variants — state via emphasis (solid = active/sent), never hue.
const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  DRAFT: 'subtle',
  SCHEDULED: 'outline',
  SENDING: 'solid',
  SENT: 'solid',
  PAUSED: 'outline',
  CANCELLED: 'subtle',
}

function apiBase() {
  return {
    apiUrl: process.env['API_URL'] ?? 'http://localhost:3001',
    token: process.env['DEV_TOKEN'] ?? '',
  }
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { apiUrl, token } = apiBase()
  try {
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${params['id']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return json<LoaderData>({ campaign: null, error: 'Campaign not found' })
    if (!res.ok) return json<LoaderData>({ campaign: null, error: 'Failed to load campaign' })
    const body = (await res.json()) as { data: CampaignDetail }
    return json<LoaderData>({ campaign: body.data, error: null })
  } catch {
    return json<LoaderData>({ campaign: null, error: 'Network error' })
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { apiUrl, token } = apiBase()
  const formData = await request.formData()
  const intent = formData.get('intent') as string
  const id = params['id']
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  if (intent === 'delete') {
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${id}`, { method: 'DELETE', headers: authHeaders })
    if (!res.ok && res.status !== 204) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to delete' })
    }
    return redirect('/campaigns')
  }

  if (intent === 'cancel') {
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${id}/cancel`, { method: 'POST', headers: authHeaders })
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to cancel' })
    }
    return redirect(`/campaigns/${id}`)
  }

  if (intent === 'send' || intent === 'schedule') {
    const sendAtRaw = formData.get('sendAt') as string
    const payload =
      intent === 'schedule' && sendAtRaw
        ? { sendAt: new Date(sendAtRaw).toISOString() }
        : {}
    const res = await fetch(`${apiUrl}/api/v1/campaigns/${id}/send`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } }
      return json<ActionData>({ error: err.error?.message ?? 'Failed to send' })
    }
    return redirect(`/campaigns/${id}`)
  }

  return json<ActionData>({ error: 'Unknown action' })
}

export default function CampaignDetailPage() {
  const { campaign, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()

  if (!campaign) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Breadcrumb items={[{ label: 'Campaigns', href: '/campaigns' }, { label: 'Not found' }]} />
        <EmptyState
          icon={<Icons.AlertCircle className="size-6" />}
          title="Campaign not found"
          description={error ?? 'This campaign could not be loaded.'}
          action={
            <Link to="/campaigns">
              <Button variant="secondary">Back to campaigns</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const canSend = campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED'
  const canCancel = campaign.status === 'SCHEDULED' || campaign.status === 'PAUSED'
  const canDelete = campaign.status !== 'SENDING'

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: 'Campaigns', href: '/campaigns' }, { label: campaign.name }]} />
      <PageHeader
        eyebrow="Engage"
        title={campaign.name}
        description={campaign.channel}
        actions={
          <Badge variant={STATUS_VARIANT[campaign.status] ?? 'subtle'} dot>
            {campaign.status}
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
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {campaign.subject && (
            <p className="text-sm">
              <span className="font-medium text-neutral-950">Subject:</span>{' '}
              <span className="text-neutral-600">{campaign.subject}</span>
            </p>
          )}
          <pre className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
            {campaign.content?.body ?? '(no body)'}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Target</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <span className="font-medium text-neutral-950">Segment:</span>{' '}
            {campaign.segment ? (
              <>
                <Link
                  to={`/segments/${campaign.segment.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {campaign.segment.name}
                </Link>
                <span className="text-neutral-600">
                  {' '}({campaign.segment.memberCount.toLocaleString()} members)
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-neutral-950">
                <Icons.AlertTriangle className="size-4" />
                none (cannot send)
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Recipients" value={campaign.recipientCount.toLocaleString()} />
            <StatCard label="Delivered" value={campaign.deliveredCount.toLocaleString()} />
            <StatCard label="Opened" value={campaign.openedCount.toLocaleString()} />
            <StatCard label="Clicked" value={campaign.clickedCount.toLocaleString()} />
          </div>
          {Object.keys(campaign.recipientBreakdown).length > 0 && (
            <p className="text-xs text-neutral-500">
              {Object.entries(campaign.recipientBreakdown)
                .map(([s, n]) => `${s}: ${n}`)
                .join(' · ')}
            </p>
          )}
          {campaign.sentAt && (
            <p className="text-sm text-neutral-600">
              Sent at: {new Date(campaign.sentAt).toLocaleString()}
            </p>
          )}
          {!campaign.sentAt && campaign.sendAt && (
            <p className="text-sm text-neutral-600">
              Scheduled for: {new Date(campaign.sendAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canSend && (
            <Form method="post">
              <input type="hidden" name="intent" value="send" />
              <Button type="submit" leftIcon={<Icons.ArrowRight className="size-4" />}>
                Send now
              </Button>
            </Form>
          )}

          {canSend && (
            <Form method="post" className="flex items-center gap-2">
              <input type="hidden" name="intent" value="schedule" />
              <Input type="datetime-local" name="sendAt" required className="w-auto" />
              <Button type="submit" variant="secondary">
                Schedule
              </Button>
            </Form>
          )}

          {canCancel && (
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <Button type="submit" variant="secondary">
                Cancel schedule
              </Button>
            </Form>
          )}

          {canDelete && (
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm('Delete this campaign?')) e.preventDefault()
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <Button type="submit" variant="destructive" leftIcon={<Icons.X className="size-4" />}>
                Delete
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
