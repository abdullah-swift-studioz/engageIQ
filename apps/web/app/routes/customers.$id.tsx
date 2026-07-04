import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { EnrichedCustomerProfile } from '@engageiq/shared'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardHeader,
  CardTitle,
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
  buttonVariants,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.customer) return [{ title: 'Customer Not Found — EngageIQ' }]
  const name =
    [data.customer.firstName, data.customer.lastName].filter(Boolean).join(' ') ||
    data.customer.email ||
    'Customer'
  return [{ title: `${name} — EngageIQ` }]
}

type GroupMemberItem = {
  customerId: string
  merchantId: string
  merchantName: string
  email: string | null
  phone: string | null
  firstName: string | null
  lastName: string | null
  totalOrders: number
  totalSpent: string
  createdAt: string
}

interface LoaderData {
  customer: EnrichedCustomerProfile | null
  error: string | null
  groupMembers: GroupMemberItem[]
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  try {
    const res = await fetch(`${apiUrl}/api/v1/customers/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (res.status === 404) {
      throw new Response('Customer not found', { status: 404 })
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return json<LoaderData>({
        customer: null,
        error: `API error ${res.status}: ${text}`,
        groupMembers: [],
      })
    }

    const body = (await res.json()) as {
      success: boolean
      data: EnrichedCustomerProfile
    }

    if (!body.success) {
      return json<LoaderData>({ customer: null, error: 'API returned an error.', groupMembers: [] })
    }

    let groupMembers: GroupMemberItem[] = []
    if (body.data.groupCustomerId) {
      try {
        const groupRes = await fetch(
          `${apiUrl}/api/v1/customers/${id}/group`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (groupRes.ok) {
          const groupJson = (await groupRes.json()) as { data: GroupMemberItem[] }
          groupMembers = groupJson.data
        }
      } catch {
        // best-effort — don't break profile page if group fetch fails
      }
    }

    return json<LoaderData>({ customer: body.data, error: null, groupMembers })
  } catch (err) {
    if (err instanceof Response) throw err
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json<LoaderData>({ customer: null, error: `Failed to reach API: ${message}`, groupMembers: [] })
  }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmt(value: string | null | undefined, fallback = '—'): string {
  return value?.trim() || fallback
}

function fmtPkr(value: string | null | undefined): string {
  if (!value) return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return '—'
  return `PKR ${num.toLocaleString('en-PK')}`
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-PK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(1)}%`
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-44 shrink-0 text-sm text-neutral-500">{label}</span>
      <span className="text-sm font-medium text-neutral-950">{value}</span>
    </div>
  )
}

// Opt-in shown with an icon + weight, never hue.
function OptinIcon({ value }: { value: boolean }) {
  return value ? (
    <Icons.CheckCircle className="size-5 text-neutral-950" aria-label="Subscribed" />
  ) : (
    <Icons.XCircle className="size-5 text-neutral-400" aria-label="Not subscribed" />
  )
}

// Score rendered as a filled/empty dot meter — magnitude by shade, never hue.
function ScoreDot({ score }: { score: number | null }) {
  if (score === null) return <span className="text-neutral-400">—</span>
  const filled = score
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`inline-block h-2.5 w-2.5 rounded-full ${i <= filled ? 'bg-neutral-900' : 'bg-neutral-200'}`}
        />
      ))}
      <span className="ml-1.5 text-sm font-medium text-neutral-700">{score}/5</span>
    </span>
  )
}

// Churn risk mapped to monochrome emphasis — HIGH/CRITICAL get solid fill + icon.
function ChurnRiskBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-neutral-400">—</span>
  const level = label.toUpperCase()
  const variant: 'solid' | 'outline' | 'subtle' =
    level === 'HIGH' || level === 'CRITICAL' ? 'solid' : level === 'MEDIUM' ? 'outline' : 'subtle'
  const withIcon = level === 'HIGH' || level === 'CRITICAL'
  return (
    <Badge variant={variant}>
      {withIcon && <Icons.AlertTriangle className="size-3" />}
      {label}
    </Badge>
  )
}

function JourneyStatusBadge({ status }: { status: string }) {
  const variant: 'solid' | 'outline' | 'subtle' =
    status === 'ACTIVE' ? 'solid' : status === 'COMPLETED' ? 'outline' : 'subtle'
  return (
    <Badge variant={variant} dot>
      {status}
    </Badge>
  )
}

function FinancialStatusBadge({ status }: { status: string }) {
  const variant: 'solid' | 'outline' | 'subtle' =
    status === 'paid' ? 'solid' : status === 'pending' ? 'outline' : 'subtle'
  return <Badge variant={variant}>{status}</Badge>
}

function FulfillmentStatusBadge({ status }: { status: string }) {
  const variant: 'solid' | 'outline' | 'subtle' =
    status === 'fulfilled' ? 'solid' : status === 'partial' ? 'outline' : 'subtle'
  return <Badge variant={variant}>{status}</Badge>
}

// ─── Main page component ─────────────────────────────────────────────────────

export default function CustomerDetail() {
  const { customer, error, groupMembers } = useLoaderData<typeof loader>()

  if (error && !customer) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error}
        </p>
        <Link to="/customers" className={buttonVariants({ variant: 'secondary' })}>
          Back to Customers
        </Link>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-6 text-center text-neutral-500">Customer not found.</div>
    )
  }

  const fullName =
    [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '—'

  const location = [customer.city, customer.province, customer.country]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: 'Customers', href: '/customers' }, { label: fullName }]} />

      {/* ── Merged-status notice ─────────────────────────────────── */}
      {customer.mergedIntoId && (
        <div className="flex items-start gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
          <Icons.AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm font-medium text-neutral-950">
            This profile has been merged into another profile.{' '}
            <Link
              to={`/customers/${customer.mergedIntoId}`}
              className="underline underline-offset-2 hover:no-underline"
            >
              View canonical profile ({customer.mergedIntoId})
            </Link>
          </p>
        </div>
      )}

      {/* ── Section 1: Header ────────────────────────────────────── */}
      <PageHeader
        eyebrow="Customer"
        title={
          <span className="flex items-center gap-3">
            {fullName}
            {customer.isBlocked && (
              <Badge variant="solid">
                <Icons.AlertTriangle className="size-3" />
                Blocked
              </Badge>
            )}
            {customer.mergedIntoId && <Badge variant="outline">Merged</Badge>}
          </span>
        }
        description={
          <span className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {customer.email && <span>{customer.email}</span>}
              {customer.phone && <span>{customer.phone}</span>}
              {location && <span>{location}</span>}
              {customer.languagePreference && <span>Lang: {customer.languagePreference}</span>}
            </span>
            {customer.tags.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <Badge key={tag} variant="subtle" size="sm">
                    {tag}
                  </Badge>
                ))}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex flex-col items-end gap-3">
            <div className="text-right text-xs text-neutral-400">
              <p>Created {fmtDate(customer.createdAt)}</p>
              <p className="mt-0.5">Updated {fmtDate(customer.updatedAt)}</p>
            </div>
            {!customer.mergedIntoId && (
              <Link
                to={`/customers/${customer.id}/merge`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Merge with another profile
              </Link>
            )}
          </div>
        }
      />

      {/* ── Section 2: Shopify Stats ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Orders" value={customer.totalOrders} />
        <StatCard label="Total Spent" value={fmtPkr(customer.totalSpent)} />
        <StatCard label="Avg Order Value" value={fmtPkr(customer.avgOrderValue)} />
        <StatCard label="First Order" value={fmtDate(customer.firstOrderAt)} />
      </div>

      {/* ── Section 3: Behavioral ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Behavioral Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <InfoRow label="Last Seen" value={fmtDate(customer.lastSeenAt)} />
            <InfoRow label="Session Count" value={customer.sessionCount} />
            <InfoRow label="Page Views" value={customer.eventStats?.pageViewCount ?? 0} />
            <InfoRow label="Add to Carts" value={customer.eventStats?.addToCartCount ?? 0} />
            <InfoRow label="Checkout Started" value={customer.eventStats?.checkoutStartedCount ?? 0} />
            <InfoRow label="Last Order" value={fmtDate(customer.lastOrderAt)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 4: RFM Scores ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>RFM Scores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <InfoRow
              label="RFM Segment"
              value={customer.rfmSegment ? <Badge variant="outline">{customer.rfmSegment}</Badge> : '—'}
            />
            <InfoRow label="Recency Score" value={<ScoreDot score={customer.rfmRecencyScore} />} />
            <InfoRow label="Frequency Score" value={<ScoreDot score={customer.rfmFrequencyScore} />} />
            <InfoRow label="Monetary Score" value={<ScoreDot score={customer.rfmMonetaryScore} />} />
            <InfoRow label="Scored At" value={fmtDate(customer.rfmScoredAt)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 5: AI Scores ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>AI Scores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <InfoRow
              label="Churn Score"
              value={
                customer.churnScore !== null ? `${(customer.churnScore * 100).toFixed(1)}%` : '—'
              }
            />
            <InfoRow label="Churn Risk" value={<ChurnRiskBadge label={customer.churnRiskLabel} />} />
            <InfoRow label="Churn Scored At" value={fmtDate(customer.churnScoredAt)} />
            <InfoRow label="LTV 90d" value={fmtPkr(customer.ltv90d)} />
            <InfoRow label="LTV 180d" value={fmtPkr(customer.ltv180d)} />
            <InfoRow label="LTV 365d" value={fmtPkr(customer.ltv365d)} />
            <InfoRow label="LTV Scored At" value={fmtDate(customer.ltvScoredAt)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 6: COD Profile ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>COD Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <InfoRow label="COD Orders" value={customer.codOrderCount} />
            <InfoRow label="Acceptance Rate" value={fmtPct(customer.codAcceptanceRate)} />
            <InfoRow label="Rejection Rate" value={fmtPct(customer.codRejectionRate)} />
            <InfoRow
              label="Fake Order Score"
              value={customer.fakeOrderScore !== null ? customer.fakeOrderScore.toFixed(2) : '—'}
            />
            <InfoRow
              label="Verification Status"
              value={
                customer.isBlocked ? (
                  <span className="inline-flex items-center gap-1 font-medium text-neutral-950">
                    <Icons.AlertTriangle className="size-4" />
                    Blocked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-neutral-950">
                    <Icons.CheckCircle className="size-4" />
                    Active
                  </span>
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 7: Channel Opt-ins ───────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Channel Opt-ins</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-8">
            <div className="flex items-center gap-2">
              <OptinIcon value={customer.isSubscribedEmail} />
              <span className="text-sm text-neutral-700">Email</span>
            </div>
            <div className="flex items-center gap-2">
              <OptinIcon value={customer.isSubscribedSms} />
              <span className="text-sm text-neutral-700">SMS</span>
            </div>
            <div className="flex items-center gap-2">
              <OptinIcon value={customer.isSubscribedWhatsapp} />
              <span className="text-sm text-neutral-700">WhatsApp</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 8: Segment Memberships ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Segment Memberships</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Segment</TableHead>
                <TableHead>Entered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.segmentMemberships.length === 0 ? (
                <TableEmpty colSpan={2}>Not in any segments yet.</TableEmpty>
              ) : (
                customer.segmentMemberships.map((seg) => (
                  <TableRow key={seg.segmentId}>
                    <TableCell className="font-medium">{seg.segmentName}</TableCell>
                    <TableCell className="text-neutral-500">{fmtDate(seg.enteredAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Section 9: Journey Enrollments ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Active Journey Enrollments</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Journey</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enrolled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.journeyEnrollments.length === 0 ? (
                <TableEmpty colSpan={3}>Not enrolled in any journeys.</TableEmpty>
              ) : (
                customer.journeyEnrollments.map((j) => (
                  <TableRow key={j.journeyId}>
                    <TableCell className="font-medium">{j.journeyName}</TableCell>
                    <TableCell>
                      <JourneyStatusBadge status={j.status} />
                    </TableCell>
                    <TableCell className="text-neutral-500">{fmtDate(j.enrolledAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Section 10: Recent Orders ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Orders</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Fulfillment</TableHead>
                <TableHead>COD</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.recentOrders.length === 0 ? (
                <TableEmpty colSpan={6}>No orders yet.</TableEmpty>
              ) : (
                customer.recentOrders.slice(0, 10).map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{fmt(order.orderNumber)}</TableCell>
                    <TableCell className="tabular text-neutral-700">{fmtPkr(order.totalPrice)}</TableCell>
                    <TableCell>
                      {order.financialStatus ? (
                        <FinancialStatusBadge status={order.financialStatus} />
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.fulfillmentStatus ? (
                        <FulfillmentStatusBadge status={order.fulfillmentStatus} />
                      ) : (
                        <span className="text-neutral-400">Unfulfilled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.isCod ? (
                        <Badge variant="outline">COD</Badge>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-neutral-500">{fmtDate(order.placedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Section 11: Abandoned Checkouts ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Abandoned Checkouts</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.recentAbandonedCheckouts.length === 0 ? (
                <TableEmpty colSpan={3}>No abandoned checkouts.</TableEmpty>
              ) : (
                customer.recentAbandonedCheckouts.slice(0, 5).map((checkout) => (
                  <TableRow key={checkout.id}>
                    <TableCell className="tabular text-neutral-700">{fmtPkr(checkout.totalPrice)}</TableCell>
                    <TableCell>
                      {checkout.recoveredAt ? (
                        <Badge variant="outline">
                          <Icons.CheckCircle className="size-3" />
                          Recovered
                        </Badge>
                      ) : (
                        <Badge variant="subtle">Abandoned</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-neutral-500">{fmtDate(checkout.abandonedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Section 12: Cross-Store Presence ────────────────────── */}
      {groupMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cross-Store Presence ({groupMembers.length} stores)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {groupMembers.map((member) => (
                <div
                  key={member.customerId}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm"
                >
                  <div>
                    <span className="font-medium text-neutral-950">{member.merchantName}</span>
                    {member.firstName && (
                      <span className="ml-2 text-neutral-600">
                        {member.firstName} {member.lastName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-6 text-neutral-600">
                    <span className="tabular">{member.totalOrders} orders</span>
                    <span className="tabular">PKR {member.totalSpent}</span>
                    {member.customerId !== customer.id && (
                      <a
                        href={`/customers/${member.customerId}`}
                        className="inline-flex items-center gap-1 font-medium text-neutral-950 underline-offset-2 hover:underline"
                      >
                        View profile
                        <Icons.ArrowRight className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
