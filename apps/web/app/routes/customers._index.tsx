import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { EnrichedCustomerProfile } from '@engageiq/shared'

export const meta: MetaFunction = () => [
  { title: 'Customers — EngageIQ' },
]

interface LoaderData {
  customers: EnrichedCustomerProfile[]
  total: number
  error: string | null
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  try {
    const res = await fetch(`${apiUrl}/api/v1/customers?page=1&pageSize=20`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return json<LoaderData>({
        customers: [],
        total: 0,
        error: `API error ${res.status}: ${text}`,
      })
    }

    const body = (await res.json()) as {
      success: boolean
      data: { customers: EnrichedCustomerProfile[]; total: number }
    }

    if (!body.success) {
      return json<LoaderData>({ customers: [], total: 0, error: 'API returned an error.' })
    }

    return json<LoaderData>({
      customers: body.data.customers ?? [],
      total: body.data.total ?? 0,
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json<LoaderData>({ customers: [], total: 0, error: `Failed to reach API: ${message}` })
  }
}

function formatPkr(value: string | null | undefined): string {
  if (!value) return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return '—'
  return `PKR ${num.toLocaleString('en-PK')}`
}

function formatDate(value: string | null | undefined): string {
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

function churnRiskBadge(label: string | null): React.ReactNode {
  if (!label) return <span className="text-gray-400">—</span>
  const colours: Record<string, string> = {
    LOW: 'bg-green-100 text-green-800',
    MEDIUM: 'bg-yellow-100 text-yellow-800',
    HIGH: 'bg-orange-100 text-orange-800',
    CRITICAL: 'bg-red-100 text-red-800',
  }
  const cls = colours[label.toUpperCase()] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

export default function CustomersIndex() {
  const { customers, total, error } = useLoaderData<typeof loader>()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>
          {total > 0 && (
            <p className="mt-1 text-sm text-gray-500">{total.toLocaleString()} total customers</p>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && customers.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white py-20 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
            />
          </svg>
          <p className="mt-4 text-sm font-medium text-gray-900">No customers found</p>
          <p className="mt-1 text-sm text-gray-500">
            Connect your Shopify store to start syncing.
          </p>
        </div>
      )}

      {/* Table */}
      {customers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  'Name',
                  'Email',
                  'Phone',
                  'Total Orders',
                  'Total Spent',
                  'RFM Segment',
                  'Churn Risk',
                  'Last Seen',
                ].map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {customers.map((c) => {
                const name =
                  [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        to={`/customers/${c.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {c.email ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {c.phone ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {c.totalOrders}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {formatPkr(c.totalSpent)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {c.rfmSegment ? (
                        <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                          {c.rfmSegment}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {churnRiskBadge(c.churnRiskLabel)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {formatDate(c.lastSeenAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
