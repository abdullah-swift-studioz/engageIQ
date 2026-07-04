import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  buttonVariants,
  Card,
  CardContent,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  Badge,
  EmptyState,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Campaigns — EngageIQ' }]

interface CampaignListItem {
  id: string
  name: string
  channel: string
  status: string
  segmentId: string | null
  sendAt: string | null
  sentAt: string | null
  recipientCount: number
  deliveredCount: number
  createdAt: string
}

interface LoaderData {
  campaigns: CampaignListItem[]
  total: number
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

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/campaigns?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      return json<LoaderData>({ campaigns: [], total: 0, error: 'Failed to load campaigns' })
    }
    const body = (await res.json()) as { data: CampaignListItem[]; meta: { total: number } }
    return json<LoaderData>({ campaigns: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ campaigns: [], total: 0, error: 'Network error' })
  }
}

export default function CampaignsPage() {
  const { campaigns, total, error } = useLoaderData<LoaderData>()
  const scheduled = campaigns.filter((c) => c.status === 'SCHEDULED').length
  const sent = campaigns.filter((c) => c.status === 'SENT').length

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Engage"
        title="Campaigns"
        description="One-time blasts to a segment across WhatsApp, SMS, email, and push."
        actions={
          <Link to="/campaigns/new" className={buttonVariants({ variant: 'primary' })}>
            <Icons.Plus className="size-4" />
            New campaign
          </Link>
        }
      />

      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total campaigns" value={total} />
        <StatCard label="Scheduled" value={scheduled} />
        <StatCard label="Sent" value={sent} />
      </div>

      <Card>
        <CardContent className="pt-6">
          {campaigns.length === 0 && !error ? (
            <EmptyState
              icon={<Icons.Megaphone className="size-6" />}
              title="No campaigns yet"
              description="Create a one-time blast to a segment."
              action={
                <Link to="/campaigns/new" className={buttonVariants({ variant: 'primary' })}>
                  New campaign
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Send / Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.length === 0 ? (
                  <TableEmpty colSpan={5}>No campaigns.</TableEmpty>
                ) : (
                  campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          to={`/campaigns/${c.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-neutral-600">{c.channel}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.status] ?? 'subtle'} dot>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular">{c.recipientCount.toLocaleString()}</TableCell>
                      <TableCell className="text-neutral-600">
                        {c.sentAt
                          ? `Sent ${new Date(c.sentAt).toLocaleString()}`
                          : c.sendAt
                            ? `Scheduled ${new Date(c.sendAt).toLocaleString()}`
                            : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
