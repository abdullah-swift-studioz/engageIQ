import { Form, Link, useLoaderData, useActionData } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import type { EnrichedCustomerProfile } from '@engageiq/shared'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardContent,
  Button,
  buttonVariants,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Icons,
} from '~/components/ui'

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
    <Card className="flex-1">
      <CardContent className="flex flex-col gap-1">
        <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
        <p className="text-base font-semibold text-neutral-950">{customerDisplayName(customer)}</p>
        <p className="text-sm text-neutral-500">{customer.email ?? '—'}</p>
        <p className="mb-2 text-sm text-neutral-500">{customer.phone ?? '—'}</p>
        <dl className="flex flex-col gap-1 text-sm">
          {[
            ['Total Orders', String(customer.totalOrders ?? 0)],
            ['Total Spent', fmtPkr(customer.totalSpent)],
            ['Created', fmtDate(customer.createdAt)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-neutral-500">{k}</dt>
              <dd className="font-medium text-neutral-950">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
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
      <div className="flex flex-col gap-4 p-6">
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error ?? 'Profile not found.'}
        </p>
        <Link to="/customers" className={buttonVariants({ variant: 'secondary' })}>
          Back to Customers
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
      <div className="flex flex-col gap-6 p-6">
        <Breadcrumb
          items={[
            { label: 'Customers', href: '/customers' },
            { label: customerDisplayName(baseCustomer), href: `/customers/${baseId}` },
            { label: 'Merge' },
          ]}
        />

        <PageHeader
          eyebrow="Customer"
          title="Confirm Profile Merge"
          description="Review both profiles below. The older profile (by creation date) will become the canonical record. All data from the secondary profile will be merged into it."
        />

        {/* Side-by-side preview */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <ProfileCard customer={baseCustomer} label={canonicalIsBase ? canonicalLabel : secondaryLabel} />
          <ProfileCard customer={selectedTarget} label={canonicalIsBase ? secondaryLabel : canonicalLabel} />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
          <Icons.AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm text-neutral-700">
            This action cannot be undone. The secondary profile will be marked as merged and all its
            identifiers, orders, and events will be attributed to the canonical profile.
          </p>
        </div>

        {/* Action error */}
        {actionData?.error && (
          <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
            <Icons.AlertCircle className="size-4" />
            {actionData.error}
          </p>
        )}

        <Form method="post" className="flex items-center gap-3">
          <input type="hidden" name="targetCustomerId" value={selectedTarget.id} />
          <Button type="submit" variant="destructive">
            Confirm merge
          </Button>
          <Link to={`/customers/${baseId}`} className={buttonVariants({ variant: 'ghost' })}>
            Cancel
          </Link>
        </Form>
      </div>
    )
  }

  // ── State 1: Search ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb
        items={[
          { label: 'Customers', href: '/customers' },
          { label: customerDisplayName(baseCustomer), href: `/customers/${baseId}` },
          { label: 'Merge' },
        ]}
      />

      <PageHeader
        eyebrow="Customer"
        title="Merge Profile"
        description={
          <>
            Search for another customer profile to merge with{' '}
            <strong className="font-semibold text-neutral-700">{customerDisplayName(baseCustomer)}</strong> (
            {baseCustomer.email ?? baseId}).
          </>
        }
      />

      {/* Loader error (non-fatal) */}
      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error}
        </p>
      )}

      {/* Search form — GET to same route */}
      <Form method="get" className="flex gap-2">
        <div className="flex-1">
          <Input
            type="text"
            name="search"
            placeholder="Search by name, email, or phone…"
            defaultValue={''}
            startIcon={<Icons.Search className="size-4" />}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </Form>

      {/* Search results */}
      {searchResults.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {searchResults.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{customerDisplayName(c)}</TableCell>
                    <TableCell className="text-neutral-600">{c.email ?? '—'}</TableCell>
                    <TableCell className="text-neutral-600">{c.phone ?? '—'}</TableCell>
                    <TableCell className="tabular text-neutral-600">{c.totalOrders ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/customers/${baseId}/merge?targetId=${c.id}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Select
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <p className="pt-2 text-center text-sm text-neutral-400">
          Search for a customer above to find a profile to merge.
        </p>
      )}
    </div>
  )
}
