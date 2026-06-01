import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { EnrichedCustomerProfile } from '@engageiq/shared'

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
      {children}
    </h2>
  )
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-44 shrink-0 text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

function OptinIcon({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  ) : (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-500">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  )
}

function ScoreDot({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400">—</span>
  const filled = score
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`inline-block h-2.5 w-2.5 rounded-full ${i <= filled ? 'bg-brand-500' : 'bg-gray-200'}`}
        />
      ))}
      <span className="ml-1.5 text-sm font-medium text-gray-700">{score}/5</span>
    </span>
  )
}

function ChurnRiskBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-gray-400">—</span>
  const colours: Record<string, string> = {
    LOW: 'bg-green-100 text-green-800',
    MEDIUM: 'bg-yellow-100 text-yellow-800',
    HIGH: 'bg-orange-100 text-orange-800',
    CRITICAL: 'bg-red-100 text-red-800',
  }
  const cls = colours[label.toUpperCase()] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-sm text-gray-400">
        {message}
      </td>
    </tr>
  )
}

// ─── Main page component ─────────────────────────────────────────────────────

export default function CustomerDetail() {
  const { customer, error, groupMembers } = useLoaderData<typeof loader>()

  if (error && !customer) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
        <div className="mt-4">
          <Link to="/customers" className="text-sm text-brand-600 hover:underline">
            ← Back to Customers
          </Link>
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 text-center text-gray-500">
        Customer not found.
      </div>
    )
  }

  const fullName =
    [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '—'

  const location = [customer.city, customer.province, customer.country]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Back link */}
      <div className="mb-4">
        <Link to="/customers" className="text-sm text-brand-600 hover:underline">
          ← Back to Customers
        </Link>
      </div>

      {/* ── Merged-status notice ─────────────────────────────────── */}
      {customer.mergedIntoId && (
        <div
          className="mb-6 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3"
          style={{ borderLeft: '4px solid #d97706' }}
        >
          <p className="text-sm font-medium text-yellow-800">
            ⚠️ This profile has been merged into another profile.{' '}
            <Link
              to={`/customers/${customer.mergedIntoId}`}
              className="underline hover:text-yellow-900"
            >
              View canonical profile ({customer.mergedIntoId})
            </Link>
          </p>
        </div>
      )}

      {/* ── Section 1: Header ────────────────────────────────────── */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-gray-900">{fullName}</h1>
              {customer.isBlocked && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                  Blocked
                </span>
              )}
              {customer.mergedIntoId && (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800">
                  Merged
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-gray-500">
              {customer.email && <span>{customer.email}</span>}
              {customer.phone && <span>{customer.phone}</span>}
              {location && <span>{location}</span>}
              {customer.languagePreference && (
                <span>Lang: {customer.languagePreference}</span>
              )}
            </div>
            {/* Tags */}
            {customer.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="text-right text-xs text-gray-400">
              <p>Created {fmtDate(customer.createdAt)}</p>
              <p className="mt-0.5">Updated {fmtDate(customer.updatedAt)}</p>
            </div>
            {!customer.mergedIntoId && (
              <Link
                to={`/customers/${customer.id}/merge`}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Merge with another profile
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 2: Shopify Stats ──────────────────────────────── */}
      <section className="mb-8">
        <SectionHeading>Shopify Stats</SectionHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Orders" value={customer.totalOrders} />
          <StatCard label="Total Spent" value={fmtPkr(customer.totalSpent)} />
          <StatCard label="Avg Order Value" value={fmtPkr(customer.avgOrderValue)} />
          <StatCard
            label="First Order"
            value={
              <span className="text-base">{fmtDate(customer.firstOrderAt)}</span>
            }
          />
        </div>
      </section>

      {/* ── Section 3: Behavioral ────────────────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading>Behavioral Data</SectionHeading>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <InfoRow label="Last Seen" value={fmtDate(customer.lastSeenAt)} />
          <InfoRow label="Session Count" value={customer.sessionCount} />
          <InfoRow
            label="Page Views"
            value={customer.eventStats?.pageViewCount ?? 0}
          />
          <InfoRow
            label="Add to Carts"
            value={customer.eventStats?.addToCartCount ?? 0}
          />
          <InfoRow
            label="Checkout Started"
            value={customer.eventStats?.checkoutStartedCount ?? 0}
          />
          <InfoRow label="Last Order" value={fmtDate(customer.lastOrderAt)} />
        </div>
      </section>

      {/* ── Section 4: RFM Scores ────────────────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading>RFM Scores</SectionHeading>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <InfoRow
            label="RFM Segment"
            value={
              customer.rfmSegment ? (
                <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  {customer.rfmSegment}
                </span>
              ) : (
                '—'
              )
            }
          />
          <InfoRow
            label="Recency Score"
            value={<ScoreDot score={customer.rfmRecencyScore} />}
          />
          <InfoRow
            label="Frequency Score"
            value={<ScoreDot score={customer.rfmFrequencyScore} />}
          />
          <InfoRow
            label="Monetary Score"
            value={<ScoreDot score={customer.rfmMonetaryScore} />}
          />
          <InfoRow label="Scored At" value={fmtDate(customer.rfmScoredAt)} />
        </div>
      </section>

      {/* ── Section 5: AI Scores ─────────────────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading>AI Scores</SectionHeading>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <InfoRow
            label="Churn Score"
            value={
              customer.churnScore !== null
                ? `${(customer.churnScore * 100).toFixed(1)}%`
                : '—'
            }
          />
          <InfoRow
            label="Churn Risk"
            value={<ChurnRiskBadge label={customer.churnRiskLabel} />}
          />
          <InfoRow label="Churn Scored At" value={fmtDate(customer.churnScoredAt)} />
          <InfoRow label="LTV 90d" value={fmtPkr(customer.ltv90d)} />
          <InfoRow label="LTV 180d" value={fmtPkr(customer.ltv180d)} />
          <InfoRow label="LTV 365d" value={fmtPkr(customer.ltv365d)} />
          <InfoRow label="LTV Scored At" value={fmtDate(customer.ltvScoredAt)} />
        </div>
      </section>

      {/* ── Section 6: COD Profile ───────────────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading>COD Profile</SectionHeading>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <InfoRow label="COD Orders" value={customer.codOrderCount} />
          <InfoRow
            label="Acceptance Rate"
            value={fmtPct(customer.codAcceptanceRate)}
          />
          <InfoRow
            label="Rejection Rate"
            value={fmtPct(customer.codRejectionRate)}
          />
          <InfoRow
            label="Fake Order Score"
            value={
              customer.fakeOrderScore !== null
                ? customer.fakeOrderScore.toFixed(2)
                : '—'
            }
          />
          <InfoRow
            label="Verification Status"
            value={
              customer.isBlocked ? (
                <span className="text-red-600 font-medium">Blocked</span>
              ) : (
                <span className="text-green-600 font-medium">Active</span>
              )
            }
          />
        </div>
      </section>

      {/* ── Section 7: Channel Opt-ins ───────────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <SectionHeading>Channel Opt-ins</SectionHeading>
        <div className="flex flex-wrap gap-8">
          <div className="flex items-center gap-2">
            <OptinIcon value={customer.isSubscribedEmail} />
            <span className="text-sm text-gray-700">Email</span>
          </div>
          <div className="flex items-center gap-2">
            <OptinIcon value={customer.isSubscribedSms} />
            <span className="text-sm text-gray-700">SMS</span>
          </div>
          <div className="flex items-center gap-2">
            <OptinIcon value={customer.isSubscribedWhatsapp} />
            <span className="text-sm text-gray-700">WhatsApp</span>
          </div>
        </div>
      </section>

      {/* ── Section 8: Segment Memberships ──────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <SectionHeading>Segment Memberships</SectionHeading>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Segment
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Entered
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {customer.segmentMemberships.length === 0 ? (
              <EmptyTableRow colSpan={2} message="Not in any segments yet." />
            ) : (
              customer.segmentMemberships.map((seg) => (
                <tr key={seg.segmentId} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-gray-900">
                    {seg.segmentName}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    {fmtDate(seg.enteredAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* ── Section 9: Journey Enrollments ──────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <SectionHeading>Active Journey Enrollments</SectionHeading>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Journey
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Enrolled
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {customer.journeyEnrollments.length === 0 ? (
              <EmptyTableRow colSpan={3} message="Not enrolled in any journeys." />
            ) : (
              customer.journeyEnrollments.map((j) => (
                <tr key={j.journeyId} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-gray-900">
                    {j.journeyName}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        j.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : j.status === 'COMPLETED'
                          ? 'bg-blue-100 text-blue-800'
                          : j.status === 'EXITED'
                          ? 'bg-gray-100 text-gray-700'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    {fmtDate(j.enrolledAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* ── Section 10: Recent Orders ────────────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <SectionHeading>Recent Orders</SectionHeading>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Order #', 'Total', 'Payment', 'Fulfillment', 'COD', 'Date'].map(
                (col) => (
                  <th
                    key={col}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {col}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {customer.recentOrders.length === 0 ? (
              <EmptyTableRow colSpan={6} message="No orders yet." />
            ) : (
              customer.recentOrders.slice(0, 10).map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-gray-900">
                    {fmt(order.orderNumber)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-700">
                    {fmtPkr(order.totalPrice)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm">
                    {order.financialStatus ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          order.financialStatus === 'paid'
                            ? 'bg-green-100 text-green-800'
                            : order.financialStatus === 'pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : order.financialStatus === 'refunded'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {order.financialStatus}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm">
                    {order.fulfillmentStatus ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          order.fulfillmentStatus === 'fulfilled'
                            ? 'bg-green-100 text-green-800'
                            : order.fulfillmentStatus === 'partial'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {order.fulfillmentStatus}
                      </span>
                    ) : (
                      <span className="text-gray-400">Unfulfilled</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm">
                    {order.isCod ? (
                      <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800">
                        COD
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    {fmtDate(order.placedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* ── Section 11: Abandoned Checkouts ─────────────────────── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <SectionHeading>Abandoned Checkouts</SectionHeading>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Total', 'Status', 'Date'].map((col) => (
                <th
                  key={col}
                  className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {customer.recentAbandonedCheckouts.length === 0 ? (
              <EmptyTableRow colSpan={3} message="No abandoned checkouts." />
            ) : (
              customer.recentAbandonedCheckouts.slice(0, 5).map((checkout) => (
                <tr key={checkout.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-700">
                    {fmtPkr(checkout.totalPrice)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm">
                    {checkout.recoveredAt ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                        Recovered
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                        Abandoned
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    {fmtDate(checkout.abandonedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* ── Section 12: Cross-Store Presence ────────────────────── */}
      {groupMembers.length > 0 && (
        <section className="rounded border p-4">
          <h2 className="mb-3 font-semibold text-gray-700">
            Cross-Store Presence ({groupMembers.length} stores)
          </h2>
          <div className="space-y-3">
            {groupMembers.map((member) => (
              <div
                key={member.customerId}
                className="flex items-center justify-between rounded bg-gray-50 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{member.merchantName}</span>
                  {member.firstName && (
                    <span className="ml-2 text-gray-600">
                      {member.firstName} {member.lastName}
                    </span>
                  )}
                </div>
                <div className="flex gap-6 text-gray-600">
                  <span>{member.totalOrders} orders</span>
                  <span>PKR {member.totalSpent}</span>
                  {member.customerId !== customer.id && (
                    <a href={`/customers/${member.customerId}`} className="text-blue-600 hover:underline">
                      View profile →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
