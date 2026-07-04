import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import type { EnrichedCustomerProfile } from '@engageiq/shared'
import {
  PageHeader,
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

// Churn risk mapped to monochrome emphasis — never hue.
// LOW → subtle, MEDIUM → outline, HIGH/CRITICAL → solid + AlertTriangle icon.
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

export default function CustomersIndex() {
  const { customers, total, error } = useLoaderData<typeof loader>()

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Audience"
        title="Customers"
        description="Unified profiles synced from your Shopify stores, enriched with RFM and AI scores."
      />

      {total > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total customers" value={total.toLocaleString()} />
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error}
        </p>
      )}

      {!error && customers.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<Icons.Users className="size-6" />}
              title="No customers found"
              description="Connect your Shopify store to start syncing."
            />
          </CardContent>
        </Card>
      ) : customers.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Total Orders</TableHead>
                  <TableHead>Total Spent</TableHead>
                  <TableHead>RFM Segment</TableHead>
                  <TableHead>Churn Risk</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.length === 0 ? (
                  <TableEmpty colSpan={8}>No customers.</TableEmpty>
                ) : (
                  customers.map((c) => {
                    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link
                            to={`/customers/${c.id}`}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-neutral-600">{c.email ?? '—'}</TableCell>
                        <TableCell className="text-neutral-600">{c.phone ?? '—'}</TableCell>
                        <TableCell className="tabular text-neutral-600">{c.totalOrders}</TableCell>
                        <TableCell className="tabular text-neutral-600">{formatPkr(c.totalSpent)}</TableCell>
                        <TableCell>
                          {c.rfmSegment ? (
                            <Badge variant="outline">{c.rfmSegment}</Badge>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ChurnRiskBadge label={c.churnRiskLabel} />
                        </TableCell>
                        <TableCell className="text-neutral-500">{formatDate(c.lastSeenAt)}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
