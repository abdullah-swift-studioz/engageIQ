import { useLoaderData, Link } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  Breadcrumb,
  Card,
  CardContent,
  Badge,
  Avatar,
  buttonVariants,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Conversation — EngageIQ' }]

type ConversationState = 'OPEN' | 'AWAITING_REPLY' | 'CLOSED' | 'EXPIRED'

interface Conversation {
  id: string
  phone: string
  state: ConversationState
  contextType: string
  contextId: string | null
  awaitingReplyUntil: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  journeyEnrollmentId: string | null
  createdAt: string
  updatedAt: string
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null; email: string | null } | null
}

interface ThreadMessage {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  status: string
  body: string
  fromPhone: string | null
  toPhone: string
  errorTitle: string | null
  createdAt: string
}

interface LoaderData {
  conversation: Conversation | null
  messages: ThreadMessage[]
  error: string | null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const headers = { Authorization: `Bearer ${token}` }

  try {
    const res = await fetch(`${apiUrl}/api/v1/conversations/${params['id']}`, { headers })
    if (res.status === 404) {
      return json<LoaderData>({ conversation: null, messages: [], error: 'Conversation not found' }, { status: 404 })
    }
    if (!res.ok) {
      return json<LoaderData>({ conversation: null, messages: [], error: 'Failed to load conversation' })
    }
    const body = (await res.json()) as { data: { conversation: Conversation; messages: ThreadMessage[] } }
    return json<LoaderData>({ conversation: body.data.conversation, messages: body.data.messages, error: null })
  } catch {
    return json<LoaderData>({ conversation: null, messages: [], error: 'Network error' })
  }
}

function customerName(c: Conversation['customer'], phone: string): string {
  if (!c) return phone
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
  return name || c.phone || phone
}

const CONTEXT_LABEL: Record<string, string> = {
  journey_reply: 'Journey reply',
  verification: 'COD verification',
  freeform: 'Free-form',
}

function StateBadge({ state }: { state: ConversationState }) {
  if (state === 'OPEN') return <Badge variant="solid" dot>Open</Badge>
  if (state === 'AWAITING_REPLY') return <Badge variant="outline"><Icons.Bell className="size-3" /> Awaiting reply</Badge>
  if (state === 'CLOSED') return <Badge variant="subtle"><Icons.Check className="size-3" /> Closed</Badge>
  return <Badge variant="subtle"><Icons.AlertTriangle className="size-3" /> Expired</Badge>
}

function fmt(dt: string | null): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ConversationDetail() {
  const { conversation, messages, error } = useLoaderData<LoaderData>()

  if (!conversation) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Breadcrumb items={[{ label: 'Conversations', href: '/conversations' }, { label: 'Not found' }]} />
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-neutral-700">
            <Icons.AlertCircle className="size-4" /> {error ?? 'Conversation not found'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const name = customerName(conversation.customer, conversation.phone)

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Breadcrumb items={[{ label: 'Conversations', href: '/conversations' }, { label: name }]} />

      {/* Header */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar size="md" name={name} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-950">{name}</h1>
            <div className="font-mono text-sm text-neutral-500">{conversation.phone}</div>
          </div>
        </div>
        <StateBadge state={conversation.state} />
      </div>

      {/* Meta strip */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <Icons.Route className="size-3.5 text-neutral-400" />
          {CONTEXT_LABEL[conversation.contextType] ?? conversation.contextType}
        </span>
        {conversation.state === 'AWAITING_REPLY' && conversation.awaitingReplyUntil && (
          <span className="inline-flex items-center gap-1.5">
            <Icons.Bell className="size-3.5 text-neutral-400" />
            Awaiting reply until {fmt(conversation.awaitingReplyUntil)}
          </span>
        )}
        {conversation.customer && (
          <Link
            to={`/customers/${conversation.customer.id}`}
            prefetch="intent"
            className="inline-flex items-center gap-1.5 text-neutral-600 underline-offset-2 hover:underline"
          >
            <Icons.Users className="size-3.5 text-neutral-400" /> Customer profile
          </Link>
        )}
      </div>

      {/* Thread */}
      <Card className="mt-6">
        <CardContent className="space-y-3 py-5">
          {messages.length === 0 && (
            <p className="py-6 text-center text-sm text-neutral-500">No WhatsApp messages in this thread yet.</p>
          )}
          {messages.map((m) => {
            const inbound = m.direction === 'INBOUND'
            return (
              <div key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                <div className="max-w-[75%]">
                  <div
                    className={
                      inbound
                        ? 'rounded-lg rounded-tl-sm border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-900'
                        : 'rounded-lg rounded-tr-sm bg-neutral-950 px-3 py-2 text-sm text-white'
                    }
                  >
                    {m.body || <span className="opacity-60">(no text)</span>}
                  </div>
                  <div className={`mt-1 flex items-center gap-2 text-2xs text-neutral-400 ${inbound ? '' : 'justify-end'}`}>
                    <span>{fmt(m.createdAt)}</span>
                    <span className="uppercase tracking-wide">{inbound ? 'received' : m.status.toLowerCase()}</span>
                    {m.errorTitle && (
                      <span className="inline-flex items-center gap-1 text-neutral-500">
                        <Icons.AlertTriangle className="size-3" /> {m.errorTitle}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="mt-6">
        <Link to="/conversations" prefetch="intent" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <Icons.ChevronLeft className="size-4" /> Back to inbox
        </Link>
      </div>
    </div>
  )
}
