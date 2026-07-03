import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  StatCard,
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  Badge,
  Avatar,
  buttonVariants,
  EmptyState,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Conversations — EngageIQ' }]

type ConversationState = 'OPEN' | 'AWAITING_REPLY' | 'CLOSED' | 'EXPIRED'

interface ConversationRow {
  id: string
  phone: string
  state: ConversationState
  contextType: string
  contextId: string | null
  awaitingReplyUntil: string | null
  lastInboundAt: string | null
  updatedAt: string
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null
  lastMessage: { body: string; direction: 'INBOUND' | 'OUTBOUND'; createdAt: string } | null
}

interface Stats {
  total: number
  byState: Record<ConversationState, number>
}

interface LoaderData {
  conversations: ConversationRow[]
  total: number
  stats: Stats | null
  state: ConversationState | 'ALL'
  error: string | null
}

const STATES: Array<ConversationState | 'ALL'> = ['ALL', 'OPEN', 'AWAITING_REPLY', 'CLOSED', 'EXPIRED']

const STATE_FILTER_LABEL: Record<ConversationState, string> = {
  OPEN: 'Open',
  AWAITING_REPLY: 'Awaiting reply',
  CLOSED: 'Closed',
  EXPIRED: 'Expired',
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const headers = { Authorization: `Bearer ${token}` }

  const url = new URL(request.url)
  const rawState = url.searchParams.get('state') ?? 'ALL'
  const state = (STATES.includes(rawState as ConversationState | 'ALL') ? rawState : 'ALL') as
    | ConversationState
    | 'ALL'
  const page = url.searchParams.get('page') ?? '1'

  const listQs = new URLSearchParams({ page, pageSize: '30' })
  if (state !== 'ALL') listQs.set('state', state)

  try {
    const [listRes, statsRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/conversations?${listQs.toString()}`, { headers }),
      fetch(`${apiUrl}/api/v1/conversations/stats`, { headers }),
    ])
    if (!listRes.ok) {
      return json<LoaderData>({ conversations: [], total: 0, stats: null, state, error: 'Failed to load conversations' })
    }
    const listBody = (await listRes.json()) as { data: ConversationRow[]; meta: { total: number } }
    const stats = statsRes.ok ? ((await statsRes.json()) as { data: Stats }).data : null
    return json<LoaderData>({ conversations: listBody.data, total: listBody.meta.total, stats, state, error: null })
  } catch {
    return json<LoaderData>({ conversations: [], total: 0, stats: null, state, error: 'Network error' })
  }
}

function customerName(c: ConversationRow['customer']): string {
  if (!c) return 'Unknown customer'
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
  return name || c.phone || 'Unknown customer'
}

// State shown with shade + border + icon, never hue (design system §1).
function StateBadge({ state }: { state: ConversationState }) {
  switch (state) {
    case 'OPEN':
      return <Badge variant="solid" dot>Open</Badge>
    case 'AWAITING_REPLY':
      return (
        <Badge variant="outline">
          <Icons.Bell className="size-3" /> Awaiting reply
        </Badge>
      )
    case 'CLOSED':
      return (
        <Badge variant="subtle">
          <Icons.Check className="size-3" /> Closed
        </Badge>
      )
    case 'EXPIRED':
      return (
        <Badge variant="subtle">
          <Icons.AlertTriangle className="size-3" /> Expired
        </Badge>
      )
  }
}

const CONTEXT_LABEL: Record<string, string> = {
  journey_reply: 'Journey reply',
  verification: 'COD verification',
  freeform: 'Free-form',
}

function ContextTag({ contextType }: { contextType: string }) {
  const Icon = contextType === 'journey_reply' ? Icons.Route : contextType === 'verification' ? Icons.CheckCircle : Icons.MessageCircle
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-neutral-600">
      <Icon className="size-3.5 text-neutral-400" />
      {CONTEXT_LABEL[contextType] ?? contextType}
    </span>
  )
}

function fmt(dt: string | null): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ConversationsInbox() {
  const { conversations, total, stats, state, error } = useLoaderData<LoaderData>()

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        eyebrow="Messaging"
        title="Conversations"
        description="Two-way WhatsApp threads. Inbound replies are matched to an open conversation and routed to the waiting journey or COD-verification step."
      />

      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="All" value={stats.total} />
          <StatCard label="Open" value={stats.byState.OPEN} />
          <StatCard label="Awaiting reply" value={stats.byState.AWAITING_REPLY} />
          <StatCard label="Closed" value={stats.byState.CLOSED} />
          <StatCard label="Expired" value={stats.byState.EXPIRED} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATES.map((s) => (
          <Link
            key={s}
            to={s === 'ALL' ? '/conversations' : `/conversations?state=${s}`}
            prefetch="intent"
            className={buttonVariants({ variant: state === s ? 'primary' : 'ghost', size: 'sm' })}
          >
            {s === 'ALL' ? 'All' : STATE_FILTER_LABEL[s]}
          </Link>
        ))}
      </div>

      {error && (
        <Card className="mt-6 border-neutral-300">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-neutral-700">
            <Icons.AlertCircle className="size-4" /> {error}
          </CardContent>
        </Card>
      )}

      {!error && conversations.length === 0 && (
        <Card className="mt-6">
          <CardContent className="py-12">
            <EmptyState
              icon={<Icons.MessageCircle />}
              title="No conversations yet"
              description="When a customer replies to a WhatsApp message, or a journey opens a “wait for reply” step, the thread appears here."
            />
          </CardContent>
        </Card>
      )}

      {!error && conversations.length > 0 && (
        <Card className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Last message</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversations.length === 0 ? (
                <TableEmpty colSpan={6}>No conversations.</TableEmpty>
              ) : (
                conversations.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar size="sm" name={customerName(c.customer)} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-neutral-950">{customerName(c.customer)}</div>
                          <div className="font-mono text-xs text-neutral-500">{c.phone}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><StateBadge state={c.state} /></TableCell>
                    <TableCell><ContextTag contextType={c.contextType} /></TableCell>
                    <TableCell className="max-w-[22ch]">
                      <span className="block truncate text-sm text-neutral-600">
                        {c.lastMessage ? (
                          <>
                            <span className="text-neutral-400">{c.lastMessage.direction === 'INBOUND' ? '↓ ' : '↑ '}</span>
                            {c.lastMessage.body || '—'}
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-neutral-500 tabular">{fmt(c.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/conversations/${c.id}`}
                        prefetch="intent"
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        Open <Icons.ArrowRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {total > conversations.length && (
        <p className="mt-4 text-sm text-neutral-500">
          Showing {conversations.length} of {total}.
        </p>
      )}
    </div>
  )
}
