import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  StatCard,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

export const meta: MetaFunction = () => [{ title: 'COD Verification — EngageIQ' }]

type VerificationStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'AUTO_CANCELLED'
type ChannelName = 'WHATSAPP' | 'SMS' | 'IVR'

interface VerificationRow {
  codOrderId: string
  orderNumber: string
  amount: string
  city: string | null
  verificationStatus: VerificationStatus
  fakeScore: number | null
  attemptCount: number
  lastChannel: ChannelName | null
  lastAttemptAt: string | null
  placedAt: string
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null
}

interface ChannelStats {
  channel: ChannelName
  attempts: number
  confirmed: number
  cancelled: number
  noResponse: number
  failed: number
}

interface Stats {
  totalInVerification: number
  pending: number
  verified: number
  autoCancelled: number
  confirmRate: number
  cancelRate: number
  noResponseRate: number
  responseRate: number
  revenueSaved: string
  byChannel: ChannelStats[]
}

interface LoaderData {
  rows: VerificationRow[]
  total: number
  stats: Stats | null
  status: VerificationStatus | 'ALL'
  error: string | null
}

const STATUSES: Array<VerificationStatus | 'ALL'> = ['ALL', 'PENDING_VERIFICATION', 'VERIFIED', 'AUTO_CANCELLED']

const STATUS_FILTER_LABEL: Record<VerificationStatus | 'ALL', string> = {
  ALL: 'All',
  PENDING_VERIFICATION: 'Pending',
  VERIFIED: 'Verified',
  AUTO_CANCELLED: 'Cancelled',
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const headers = { Authorization: `Bearer ${token}` }

  const url = new URL(request.url)
  const rawStatus = url.searchParams.get('status') ?? 'ALL'
  const status = (STATUSES.includes(rawStatus as VerificationStatus | 'ALL') ? rawStatus : 'ALL') as
    | VerificationStatus
    | 'ALL'
  const page = url.searchParams.get('page') ?? '1'

  const listQs = new URLSearchParams({ page, pageSize: '30' })
  if (status !== 'ALL') listQs.set('status', status)

  try {
    const [listRes, statsRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/verifications?${listQs.toString()}`, { headers }),
      fetch(`${apiUrl}/api/v1/verifications/stats`, { headers }),
    ])
    if (!listRes.ok) {
      return json<LoaderData>({ rows: [], total: 0, stats: null, status, error: 'Failed to load verifications' })
    }
    const listBody = (await listRes.json()) as { data: VerificationRow[]; meta: { total: number } }
    const stats = statsRes.ok ? ((await statsRes.json()) as { data: Stats }).data : null
    return json<LoaderData>({ rows: listBody.data, total: listBody.meta.total, stats, status, error: null })
  } catch {
    return json<LoaderData>({ rows: [], total: 0, stats: null, status, error: 'Network error' })
  }
}

function customerName(c: VerificationRow['customer']): string {
  if (!c) return 'Unknown customer'
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
  return name || c.phone || 'Unknown customer'
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`
}

function pkr(amount: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `Rs. ${amount}`
  return `Rs. ${Math.round(n).toLocaleString('en-US')}`
}

function fmt(dt: string | null): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// State shown with shade + border + icon, never hue (design system §1).
function StatusBadge({ status }: { status: VerificationStatus }) {
  switch (status) {
    case 'PENDING_VERIFICATION':
      return (
        <Badge variant="outline">
          <Icons.Bell className="size-3" /> Pending
        </Badge>
      )
    case 'VERIFIED':
      return (
        <Badge variant="solid">
          <Icons.CheckCircle className="size-3" /> Verified
        </Badge>
      )
    case 'AUTO_CANCELLED':
      return (
        <Badge variant="subtle">
          <Icons.XCircle className="size-3" /> Cancelled
        </Badge>
      )
  }
}

export default function VerificationsIndex() {
  const { rows, total, stats, status, error } = useLoaderData<LoaderData>()

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        eyebrow="COD Intelligence"
        title="COD Verification"
        description="Automated WhatsApp / SMS / IVR confirmation for COD orders flagged as high-risk — confirm intent before you ship."
      />

      {error && (
        <Card className="mt-6">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-neutral-700">
            <Icons.AlertCircle className="size-4" /> {error}
          </CardContent>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="In Verification" value={String(stats?.totalInVerification ?? 0)} />
        <StatCard label="Confirm Rate" value={stats ? pct(stats.confirmRate) : '—'} />
        <StatCard label="No-Response Rate" value={stats ? pct(stats.noResponseRate) : '—'} />
        <StatCard label="Revenue Saved" value={stats ? pkr(stats.revenueSaved) : '—'} />
      </div>

      {/* Secondary rate row */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pending" value={String(stats?.pending ?? 0)} />
        <StatCard label="Verified" value={String(stats?.verified ?? 0)} />
        <StatCard label="Auto-Cancelled" value={String(stats?.autoCancelled ?? 0)} />
        <StatCard label="Response Rate" value={stats ? pct(stats.responseRate) : '—'} />
      </div>

      {/* Per-channel breakdown */}
      {stats && stats.byChannel.some((c) => c.attempts > 0) && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Per-channel performance</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">No response</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.byChannel.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="font-medium">{c.channel}</TableCell>
                    <TableCell className="tabular text-right">{c.attempts}</TableCell>
                    <TableCell className="tabular text-right">{c.confirmed}</TableCell>
                    <TableCell className="tabular text-right">{c.cancelled}</TableCell>
                    <TableCell className="tabular text-right">{c.noResponse}</TableCell>
                    <TableCell className="tabular text-right">{c.failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Status filter */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => {
          const active = s === status
          return (
            <Link
              key={s}
              to={s === 'ALL' ? '/verifications' : `/verifications?status=${s}`}
              prefetch="intent"
              className={buttonVariants({ variant: active ? 'primary' : 'secondary', size: 'sm' })}
            >
              {STATUS_FILTER_LABEL[s]}
            </Link>
          )
        })}
        <span className="ml-auto text-sm text-neutral-500">{total} order{total === 1 ? '' : 's'}</span>
      </div>

      {/* Orders table */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Icons.CheckCircle />}
                title="No orders in verification"
                description="COD orders flagged as high-risk by the fake-order gate will appear here for confirmation."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Last contact</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={7}>No orders.</TableEmpty>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.codOrderId}>
                      <TableCell>
                        <Link
                          to={`/verifications/${r.codOrderId}`}
                          prefetch="intent"
                          className="font-medium text-neutral-950 underline-offset-2 hover:underline"
                        >
                          #{r.orderNumber}
                        </Link>
                        {r.city && <div className="text-2xs text-neutral-400">{r.city}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar size="sm" name={customerName(r.customer)} />
                          <div>
                            <div className="text-neutral-900">{customerName(r.customer)}</div>
                            {r.customer?.phone && (
                              <div className="font-mono text-2xs text-neutral-400">{r.customer.phone}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-right">{pkr(r.amount)}</TableCell>
                      <TableCell className="tabular text-right">
                        {r.fakeScore === null ? '—' : Math.round(r.fakeScore)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {r.attemptCount}
                        {r.lastChannel && <span className="ml-1 text-2xs text-neutral-400">{r.lastChannel}</span>}
                      </TableCell>
                      <TableCell className="text-sm text-neutral-600">{fmt(r.lastAttemptAt)}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.verificationStatus} />
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
