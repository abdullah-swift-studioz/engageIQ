import { useLoaderData, useActionData, Link, Form, useNavigation } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  Breadcrumb,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Avatar,
  Button,
  buttonVariants,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Verification — EngageIQ' }]

type VerificationStatus = 'UNVERIFIED' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'AUTO_CANCELLED'
type ChannelName = 'WHATSAPP' | 'SMS' | 'IVR'
type AttemptStatus = 'PENDING' | 'AWAITING' | 'CONFIRMED' | 'CANCELLED' | 'NO_RESPONSE' | 'FAILED'

interface Attempt {
  id: string
  attemptNumber: number
  channel: ChannelName
  status: AttemptStatus
  sentAt: string | null
  respondedAt: string | null
  response: string | null
}

interface Detail {
  codOrderId: string
  orderNumber: string
  amount: string
  city: string | null
  province: string | null
  courier: string | null
  status: string
  verificationStatus: VerificationStatus
  fakeScore: number | null
  placedAt: string
  verificationSentAt: string | null
  verificationRepliedAt: string | null
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null; email: string | null } | null
  attempts: Attempt[]
}

interface LoaderData {
  detail: Detail | null
  error: string | null
}

interface ActionData {
  ok: boolean
  message: string
}

const API_URL = () => process.env['API_URL'] ?? 'http://localhost:3001'
const authHeaders = () => ({ Authorization: `Bearer ${process.env['DEV_TOKEN'] ?? ''}` })

export async function loader({ params }: LoaderFunctionArgs) {
  try {
    const res = await fetch(`${API_URL()}/api/v1/verifications/${params['id']}`, { headers: authHeaders() })
    if (res.status === 404) {
      return json<LoaderData>({ detail: null, error: 'Verification order not found' }, { status: 404 })
    }
    if (!res.ok) return json<LoaderData>({ detail: null, error: 'Failed to load verification' })
    const body = (await res.json()) as { data: Detail }
    return json<LoaderData>({ detail: body.data, error: null })
  } catch {
    return json<LoaderData>({ detail: null, error: 'Network error' })
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const path =
    intent === 'confirm' ? 'confirm' : intent === 'cancel' ? 'cancel' : intent === 'start' ? 'start' : null
  if (!path) return json<ActionData>({ ok: false, message: 'Unknown action' }, { status: 400 })

  try {
    const res = await fetch(`${API_URL()}/api/v1/verifications/${params['id']}/${path}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: '{}',
    })
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (!res.ok) {
      return json<ActionData>(
        { ok: false, message: body.error?.message ?? `Action failed (${res.status})` },
        { status: res.status },
      )
    }
    const verb = intent === 'start' ? 'Verification flow started' : `Order marked ${intent}ed`
    return json<ActionData>({ ok: true, message: verb })
  } catch {
    return json<ActionData>({ ok: false, message: 'Network error' }, { status: 502 })
  }
}

function customerName(c: Detail['customer'], fallback: string): string {
  if (!c) return fallback
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
  return name || c.phone || fallback
}

function pkr(amount: string): string {
  const n = Number(amount)
  return Number.isFinite(n) ? `Rs. ${Math.round(n).toLocaleString('en-US')}` : `Rs. ${amount}`
}

function fmt(dt: string | null): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function VerificationBadge({ status }: { status: VerificationStatus }) {
  switch (status) {
    case 'VERIFIED':
      return <Badge variant="solid"><Icons.CheckCircle className="size-3" /> Verified</Badge>
    case 'AUTO_CANCELLED':
      return <Badge variant="subtle"><Icons.XCircle className="size-3" /> Cancelled</Badge>
    case 'PENDING_VERIFICATION':
      return <Badge variant="outline"><Icons.Bell className="size-3" /> Pending</Badge>
    default:
      return <Badge variant="subtle">Unverified</Badge>
  }
}

// Each attempt outcome shown by icon + weight + shade, never hue (design system §1).
function AttemptIcon({ status }: { status: AttemptStatus }) {
  switch (status) {
    case 'CONFIRMED':
      return <Icons.CheckCircle className="size-4 text-neutral-950" />
    case 'CANCELLED':
      return <Icons.XCircle className="size-4 text-neutral-950" />
    case 'NO_RESPONSE':
      return <Icons.AlertTriangle className="size-4 text-neutral-500" />
    case 'FAILED':
      return <Icons.AlertCircle className="size-4 text-neutral-500" />
    case 'AWAITING':
      return <Icons.Bell className="size-4 text-neutral-500" />
    default:
      return <Icons.Info className="size-4 text-neutral-400" />
  }
}

const ATTEMPT_LABEL: Record<AttemptStatus, string> = {
  PENDING: 'Queued',
  AWAITING: 'Awaiting reply',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  NO_RESPONSE: 'No response',
  FAILED: 'Send failed',
}

export default function VerificationDetail() {
  const { detail, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<ActionData>()
  const navigation = useNavigation()
  const busy = navigation.state === 'submitting'

  if (!detail) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Breadcrumb items={[{ label: 'COD Verification', href: '/verifications' }, { label: 'Not found' }]} />
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-neutral-700">
            <Icons.AlertCircle className="size-4" /> {error ?? 'Not found'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const name = customerName(detail.customer, `Order #${detail.orderNumber}`)
  const isPending = detail.verificationStatus === 'PENDING_VERIFICATION'

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Breadcrumb items={[{ label: 'COD Verification', href: '/verifications' }, { label: `#${detail.orderNumber}` }]} />

      {/* Header */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar size="md" name={name} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-950">Order #{detail.orderNumber}</h1>
            <div className="text-sm text-neutral-500">{name}</div>
          </div>
        </div>
        <VerificationBadge status={detail.verificationStatus} />
      </div>

      {actionData && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
          {actionData.ok ? <Icons.CheckCircle className="size-4" /> : <Icons.AlertCircle className="size-4" />}
          {actionData.message}
        </div>
      )}

      {/* Order facts */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Order</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            <Fact label="Amount" value={pkr(detail.amount)} />
            <Fact label="Fake-order risk" value={detail.fakeScore === null ? '—' : String(Math.round(detail.fakeScore))} />
            <Fact label="Order status" value={detail.status} />
            <Fact label="City" value={detail.city ?? '—'} />
            <Fact label="Courier" value={detail.courier ?? '—'} />
            <Fact label="Placed" value={fmt(detail.placedAt)} />
            <Fact label="First contacted" value={fmt(detail.verificationSentAt)} />
            <Fact label="Replied" value={fmt(detail.verificationRepliedAt)} />
            {detail.customer?.phone && <Fact label="Phone" value={detail.customer.phone} mono />}
          </dl>
          {detail.customer && (
            <div className="mt-4">
              <Link
                to={`/customers/${detail.customer.id}`}
                prefetch="intent"
                className="inline-flex items-center gap-1.5 text-sm text-neutral-600 underline-offset-2 hover:underline"
              >
                <Icons.Users className="size-3.5 text-neutral-400" /> Customer profile
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attempt timeline */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Verification attempts</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.attempts.length === 0 ? (
            <p className="py-4 text-sm text-neutral-500">No attempts yet — the flow has not contacted this customer.</p>
          ) : (
            <ol className="space-y-4">
              {detail.attempts.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <div className="mt-0.5"><AttemptIcon status={a.status} /></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900">
                        Attempt {a.attemptNumber} · {a.channel}
                      </span>
                      <Badge variant="subtle">{ATTEMPT_LABEL[a.status]}</Badge>
                    </div>
                    <div className="mt-0.5 text-2xs text-neutral-400">
                      Sent {fmt(a.sentAt)}
                      {a.respondedAt ? ` · responded ${fmt(a.respondedAt)}` : ''}
                      {a.response ? ` · “${a.response}”` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Manual agent actions — only meaningful while pending */}
      {isPending && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Manual review</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Form method="post">
              <input type="hidden" name="intent" value="confirm" />
              <Button type="submit" variant="primary" size="sm" isLoading={busy} leftIcon={<Icons.CheckCircle className="size-4" />}>
                Confirm order
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <Button type="submit" variant="destructive" size="sm" isLoading={busy} leftIcon={<Icons.XCircle className="size-4" />}>
                Cancel order
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="start" />
              <Button type="submit" variant="secondary" size="sm" isLoading={busy} leftIcon={<Icons.Bell className="size-4" />}>
                Re-send verification
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <Link to="/verifications" prefetch="intent" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <Icons.ChevronLeft className="size-4" /> Back to queue
        </Link>
      </div>
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className={`mt-0.5 text-neutral-900 ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
    </div>
  )
}
