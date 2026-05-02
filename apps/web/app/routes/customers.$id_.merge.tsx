import { Form, Link, useLoaderData, useActionData } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import type { EnrichedCustomerProfile } from '@engageiq/shared'

// ─── Types ───────────────────────────────────────────────────────────────────

interface LoaderData {
  baseCustomer: EnrichedCustomerProfile | null
  searchResults: EnrichedCustomerProfile[]
  selectedTarget: EnrichedCustomerProfile | null
  error: string | null
}

interface ActionData {
  error: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function fmtPkr(value: string | null | undefined): string {
  if (!value) return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return '—'
  return `PKR ${num.toLocaleString('en-PK')}`
}

function customerDisplayName(c: EnrichedCustomerProfile): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '(No name)'
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  const url = new URL(request.url)
  const searchParam = url.searchParams.get('search') ?? ''
  const targetIdParam = url.searchParams.get('targetId') ?? ''

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  // Fetch base customer
  let baseCustomer: EnrichedCustomerProfile | null = null
  try {
    const res = await fetch(`${apiUrl}/api/v1/customers/${id}`, { headers })
    if (res.ok) {
      const body = (await res.json()) as { success: boolean; data: EnrichedCustomerProfile }
      if (body.success) baseCustomer = body.data
    }
  } catch {
    // handled below
  }

  if (!baseCustomer) {
    return json<LoaderData>({
      baseCustomer: null,
      searchResults: [],
      selectedTarget: null,
      error: 'Could not load base customer profile.',
    })
  }

  // Fetch search results if search query present
  let searchResults: EnrichedCustomerProfile[] = []
  if (searchParam) {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/customers?search=${encodeURIComponent(searchParam)}&pageSize=10`,
        { headers }
      )
      if (res.ok) {
        const body = (await res.json()) as {
          success: boolean
          data: EnrichedCustomerProfile[]
        }
        if (body.success) {
          // Exclude the base customer from results
          searchResults = body.data.filter((c) => c.id !== baseCustomer!.id)
        }
      }
    } catch {
      // non-fatal — show empty results
    }
  }

  // Fetch selected target if targetId param present
  let selectedTarget: EnrichedCustomerProfile | null = null
  if (targetIdParam && targetIdParam !== id) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/customers/${targetIdParam}`, { headers })
      if (res.ok) {
        const body = (await res.json()) as {
          success: boolean
          data: EnrichedCustomerProfile
        }
        if (body.success) selectedTarget = body.data
      }
    } catch {
      // non-fatal
    }
  }

  return json<LoaderData>({
    baseCustomer,
    searchResults,
    selectedTarget,
    error: null,
  })
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''

  const formData = await request.formData()
  const targetId = formData.get('targetCustomerId') as string

  if (!targetId) {
    return json<ActionData>({ error: 'No target customer selected.' })
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/customers/merge`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerId1: id, customerId2: targetId }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return json<ActionData>({ error: `Merge failed (${res.status}): ${text}` })
    }

    const body = (await res.json()) as {
      success: boolean
      data: { canonicalId: string; secondaryId: string; mergedAt: string; mergeReason: string }
      error?: { message: string }
    }

    if (!body.success) {
      return json<ActionData>({ error: body.error?.message ?? 'Merge failed.' })
    }

    return redirect(`/customers/${body.data.canonicalId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json<ActionData>({ error: `Failed to reach API: ${message}` })
  }
}

// ─── Profile summary card (used in confirm view) ─────────────────────────────

function ProfileCard({
  customer,
  label,
}: {
  customer: EnrichedCustomerProfile
  label: string
}) {
  return (
    <div
      style={{
        flex: 1,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '1rem',
        background: '#fff',
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#6b7280',
          marginBottom: 8,
        }}
      >
        {label}
      </p>
      <p style={{ fontWeight: 600, fontSize: 16, color: '#111827', marginBottom: 4 }}>
        {customerDisplayName(customer)}
      </p>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>{customer.email ?? '—'}</p>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{customer.phone ?? '—'}</p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['Total Orders', String(customer.totalOrders ?? 0)],
            ['Total Spent', fmtPkr(customer.totalSpent)],
            ['Created', fmtDate(customer.createdAt)],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: '#6b7280', paddingRight: 8, paddingBottom: 4 }}>{k}</td>
              <td style={{ fontWeight: 500, color: '#111827', paddingBottom: 4 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function CustomerMergePage() {
  const { baseCustomer, searchResults, selectedTarget, error } =
    useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>() as ActionData | undefined

  // ── Error: could not load base customer ──────────────────────────────────
  if (!baseCustomer) {
    return (
      <div style={{ maxWidth: 720, margin: '3rem auto', padding: '0 1rem' }}>
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
          }}
        >
          <p style={{ color: '#b91c1c', fontSize: 14 }}>{error ?? 'Profile not found.'}</p>
        </div>
        <Link
          to="/customers"
          style={{ fontSize: 13, color: '#2563eb', textDecoration: 'underline' }}
        >
          ← Back to Customers
        </Link>
      </div>
    )
  }

  const baseId = baseCustomer.id

  // ── State 2: Confirm merge ───────────────────────────────────────────────
  if (selectedTarget) {
    // Determine canonical: older profile by createdAt
    const baseDate = baseCustomer.createdAt ? new Date(baseCustomer.createdAt).getTime() : 0
    const targetDate = selectedTarget.createdAt ? new Date(selectedTarget.createdAt).getTime() : 0
    const canonicalIsBase = baseDate <= targetDate
    const canonicalLabel = canonicalIsBase ? 'Canonical (older — will be kept)' : 'Secondary (will be merged)'
    const secondaryLabel = canonicalIsBase ? 'Secondary (will be merged)' : 'Canonical (older — will be kept)'

    return (
      <div style={{ maxWidth: 800, margin: '3rem auto', padding: '0 1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <Link
            to={`/customers/${baseId}`}
            style={{ fontSize: 13, color: '#2563eb', textDecoration: 'underline' }}
          >
            ← Back to customer
          </Link>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
          Confirm Profile Merge
        </h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
          Review both profiles below. The older profile (by creation date) will become the
          canonical record. All data from the secondary profile will be merged into it.
        </p>

        {/* Side-by-side preview */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: 24 }}>
          <ProfileCard customer={baseCustomer} label={canonicalIsBase ? canonicalLabel : secondaryLabel} />
          <ProfileCard customer={selectedTarget} label={canonicalIsBase ? secondaryLabel : canonicalLabel} />
        </div>

        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            padding: '0.75rem 1rem',
            marginBottom: 20,
            fontSize: 13,
            color: '#92400e',
          }}
        >
          ⚠️ This action cannot be undone. The secondary profile will be marked as merged and
          all its identifiers, orders, and events will be attributed to the canonical profile.
        </div>

        {/* Action error */}
        {actionData?.error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '0.75rem 1rem',
              marginBottom: 16,
            }}
          >
            <p style={{ color: '#b91c1c', fontSize: 14 }}>{actionData.error}</p>
          </div>
        )}

        <Form method="post" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="hidden" name="targetCustomerId" value={selectedTarget.id} />
          <button
            type="submit"
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '0.5rem 1.25rem',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Confirm merge
          </button>
          <Link
            to={`/customers/${baseId}`}
            style={{ fontSize: 13, color: '#6b7280', textDecoration: 'underline' }}
          >
            Cancel
          </Link>
        </Form>
      </div>
    )
  }

  // ── State 1: Search ──────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 720, margin: '3rem auto', padding: '0 1rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link
          to={`/customers/${baseId}`}
          style={{ fontSize: 13, color: '#2563eb', textDecoration: 'underline' }}
        >
          ← Back to customer
        </Link>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
        Merge Profile
      </h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
        Search for another customer profile to merge with{' '}
        <strong>{customerDisplayName(baseCustomer)}</strong> ({baseCustomer.email ?? baseId}).
      </p>

      {/* Loader error (non-fatal) */}
      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            padding: '0.75rem 1rem',
            marginBottom: 16,
          }}
        >
          <p style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p>
        </div>
      )}

      {/* Search form — GET to same route */}
      <Form method="get" style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          name="search"
          placeholder="Search by name, email, or phone…"
          defaultValue={''}
          style={{
            flex: 1,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            fontSize: 14,
            color: '#111827',
          }}
        />
        <button
          type="submit"
          style={{
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.5rem 1rem',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </Form>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Name', 'Email', 'Phone', 'Orders', ''].map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '0.5rem 0.75rem',
                      textAlign: 'left',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: '#6b7280',
                      borderBottom: '1px solid #e5e7eb',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {searchResults.map((c) => (
                <tr
                  key={c.id}
                  style={{ borderBottom: '1px solid #f3f4f6' }}
                >
                  <td style={{ padding: '0.625rem 0.75rem', color: '#111827', fontWeight: 500 }}>
                    {customerDisplayName(c)}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: '#6b7280' }}>
                    {c.email ?? '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: '#6b7280' }}>
                    {c.phone ?? '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: '#6b7280' }}>
                    {c.totalOrders ?? 0}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>
                    <Link
                      to={`/customers/${baseId}/merge?targetId=${c.id}`}
                      style={{
                        background: '#f3f4f6',
                        color: '#374151',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        padding: '0.25rem 0.625rem',
                        fontSize: 12,
                        fontWeight: 500,
                        textDecoration: 'none',
                      }}
                    >
                      Select
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No results message */}
      {searchResults.length === 0 && (
        <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingTop: 8 }}>
          {/* Only show message after a search has been attempted — check for search param in URL */}
          Search for a customer above to find a profile to merge.
        </p>
      )}
    </div>
  )
}
