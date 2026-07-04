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

export const meta: MetaFunction = () => [{ title: 'Messages — EngageIQ' }]

interface MessageRow {
  id: string
  channel: string
  direction: 'OUTBOUND' | 'INBOUND'
  status: string
  body: string
  toPhone: string
  fromPhone: string | null
  errorTitle: string | null
  createdAt: string
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null
  template: { id: string; name: string } | null
}

interface Stats {
  totalOutbound: number
  totalInbound: number
  sent: number
  delivered: number
  read: number
  failed: number
  deliveryRate: number
  readRate: number
  optOutCount: number
}

interface LoaderData {
  messages: MessageRow[]
  total: number
  stats: Stats | null
  error: string | null
}

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  QUEUED: 'subtle',
  SENT: 'outline',
  DELIVERED: 'solid',
  READ: 'solid',
  FAILED: 'outline',
  RECEIVED: 'subtle',
}

function statusIcon(status: string) {
  if (status === 'READ') return <Icons.CheckCircle className="size-3.5" />
  if (status === 'FAILED') return <Icons.AlertCircle className="size-3.5" />
  return null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const page = new URL(request.url).searchParams.get('page') ?? '1'
  const headers = { Authorization: `Bearer ${token}` }

  try {
    const [listRes, statsRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/messages?page=${page}&pageSize=30`, { headers }),
      fetch(`${apiUrl}/api/v1/messages/stats`, { headers }),
    ])
    if (!listRes.ok) return json<LoaderData>({ messages: [], total: 0, stats: null, error: 'Failed to load messages' })
    const listBody = (await listRes.json()) as { data: MessageRow[]; meta: { total: number } }
    const stats = statsRes.ok ? ((await statsRes.json()) as { data: Stats }).data : null
    return json<LoaderData>({ messages: listBody.data, total: listBody.meta.total, stats, error: null })
  } catch {
    return json<LoaderData>({ messages: [], total: 0, stats: null, error: 'Network error' })
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export default function MessagesPage() {
  const { messages, total, stats, error } = useLoaderData<LoaderData>()

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Channels"
        title="Messages"
        description="Delivery log of every outbound and inbound message across channels."
        actions={
          <Link to="/whatsapp-templates" className={buttonVariants({ variant: 'secondary' })}>
            WhatsApp templates
            <Icons.ArrowRight className="size-4" />
          </Link>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
          <Icons.AlertCircle className="size-4 text-neutral-950" />
          <p className="text-sm font-medium text-neutral-950">{error}</p>
        </div>
      )}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Outbound" value={stats.totalOutbound} />
          <StatCard label="Delivery rate" value={pct(stats.deliveryRate)} />
          <StatCard label="Read rate" value={pct(stats.readRate)} />
          <StatCard label="Failed" value={stats.failed} />
          <StatCard label="Inbound" value={stats.totalInbound} />
          <StatCard label="Opted out" value={stats.optOutCount} />
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {messages.length === 0 && !error ? (
            <EmptyState
              icon={<Icons.Inbox className="size-6" />}
              title="No messages yet"
              description="Sent and received messages will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>To / From</TableHead>
                  <TableHead>Body</TableHead>
                  <TableHead>Template</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.length === 0 ? (
                  <TableEmpty colSpan={6}>No messages.</TableEmpty>
                ) : (
                  messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-neutral-600">
                        {new Date(m.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell aria-label={m.direction === 'OUTBOUND' ? 'Outbound' : 'Inbound'}>
                        {m.direction === 'OUTBOUND' ? (
                          <Icons.ArrowUpRight className="size-4 text-neutral-600" />
                        ) : (
                          <Icons.ArrowDownRight className="size-4 text-neutral-600" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[m.status] ?? 'subtle'} dot>
                          {statusIcon(m.status)}
                          {m.status}
                        </Badge>
                        {m.errorTitle && (
                          <div className="mt-0.5 flex items-center gap-1 text-2xs text-neutral-500">
                            <Icons.AlertCircle className="size-3" />
                            {m.errorTitle}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-neutral-600">
                        {m.direction === 'OUTBOUND' ? m.toPhone : m.fromPhone}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate">{m.body}</TableCell>
                      <TableCell className="text-xs text-neutral-500">{m.template?.name ?? '—'}</TableCell>
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
