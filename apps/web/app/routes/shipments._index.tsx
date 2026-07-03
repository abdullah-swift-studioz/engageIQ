import { json, type LoaderFunctionArgs, type ActionFunctionArgs, type MetaFunction } from '@remix-run/node'
import { Link, useLoaderData, Form, useSearchParams, useNavigation } from '@remix-run/react'
import {
  PageHeader,
  StatCard,
  Card,
  CardContent,
  Button,
  Badge,
  Select,
  Input,
  Pagination,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  Icons,
} from '~/components/ui'
import { statusPresentation, courierLabel, formatPkr, formatDate } from '~/lib/courier-format'

export const meta: MetaFunction = () => [{ title: 'Shipments — EngageIQ' }]

interface ShipmentRow {
  id: string
  courier: string
  trackingNumber: string | null
  status: string
  codAmount: number | null
  codCollected: boolean
  deliveredAt: string | null
  returnedAt: string | null
  updatedAt: string
}
interface Stats {
  total: number
  active: number
  delivered: number
  returned: number
  codCollected: number
}
interface LoaderData {
  shipments: ShipmentRow[]
  stats: Stats
  page: number
  pageSize: number
  total: number
  error: string | null
}

const STATUS_OPTIONS = [
  'CREATED', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPTED',
  'DELIVERED', 'RETURN_IN_TRANSIT', 'RETURNED', 'UNDELIVERABLE', 'CANCELLED',
]
const COURIER_OPTIONS = ['POSTEX', 'LEOPARDS', 'TCS', 'MP', 'OTHER']

function apiBase(): string {
  return process.env['API_URL'] ?? 'http://localhost:3001'
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env['DEV_TOKEN'] ?? ''}` }
}

export async function loader({ request }: LoaderFunctionArgs): Promise<ReturnType<typeof json<LoaderData>>> {
  const url = new URL(request.url)
  const qs = new URLSearchParams()
  qs.set('page', url.searchParams.get('page') ?? '1')
  for (const key of ['status', 'courier', 'q']) {
    const v = url.searchParams.get(key)
    if (v) qs.set(key, v)
  }

  const empty: Stats = { total: 0, active: 0, delivered: 0, returned: 0, codCollected: 0 }
  try {
    const res = await fetch(`${apiBase()}/api/v1/couriers/shipments?${qs.toString()}`, { headers: authHeaders() })
    if (!res.ok) {
      return json<LoaderData>({ shipments: [], stats: empty, page: 1, pageSize: 20, total: 0, error: `Failed to load shipments (HTTP ${res.status})` })
    }
    const body = (await res.json()) as { data: ShipmentRow[]; meta: { page: number; pageSize: number; total: number; stats: Stats } }
    return json<LoaderData>({
      shipments: body.data,
      stats: body.meta.stats ?? empty,
      page: body.meta.page,
      pageSize: body.meta.pageSize,
      total: body.meta.total,
      error: null,
    })
  } catch {
    return json<LoaderData>({ shipments: [], stats: empty, page: 1, pageSize: 20, total: 0, error: 'Could not reach the API.' })
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // "Sync all" — enqueue a merchant-wide poll sweep.
  await request.formData()
  try {
    const res = await fetch(`${apiBase()}/api/v1/couriers/sync`, { method: 'POST', headers: authHeaders() })
    const body = (await res.json()) as { success: boolean; data?: { enqueued: number } }
    return json({ ok: body.success, enqueued: body.data?.enqueued ?? 0 })
  } catch {
    return json({ ok: false, enqueued: 0 })
  }
}

function StatusBadge({ status }: { status: string }) {
  const p = statusPresentation(status)
  const Icon = p.icon
  return (
    <Badge variant={p.variant} className="gap-1">
      <Icon className="size-3.5" />
      {p.label}
    </Badge>
  )
}

export default function ShipmentsIndex() {
  const { shipments, stats, page, pageSize, total, error } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigation = useNavigation()
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fulfillment"
        title="Shipments"
        description="Delivery status, COD collection, and returns pulled from PostEx, Leopards, TCS, and M&P."
        actions={
          <Form method="post">
            <Button type="submit" variant="secondary" leftIcon={<Icons.ArrowRight className="size-4" />} isLoading={navigation.state === 'submitting'}>
              Sync all
            </Button>
          </Form>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total" value={stats.total.toLocaleString()} />
        <StatCard label="Active" value={stats.active.toLocaleString()} sub="in transit" />
        <StatCard label="Delivered" value={stats.delivered.toLocaleString()} />
        <StatCard label="Returned" value={stats.returned.toLocaleString()} />
        <StatCard label="COD Collected" value={stats.codCollected.toLocaleString()} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Input name="q" placeholder="Search tracking number" defaultValue={searchParams.get('q') ?? ''} startIcon={<Icons.Search className="size-4" />} />
            </div>
            <Select name="status" defaultValue={searchParams.get('status') ?? ''} className="w-44">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{statusPresentation(s).label}</option>
              ))}
            </Select>
            <Select name="courier" defaultValue={searchParams.get('courier') ?? ''} className="w-40">
              <option value="">All couriers</option>
              {COURIER_OPTIONS.map((c) => (
                <option key={c} value={c}>{courierLabel(c)}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">Filter</Button>
          </Form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState icon={<Icons.AlertTriangle />} title="Couldn’t load shipments" description={error} />
      ) : shipments.length === 0 && total === 0 ? (
        <EmptyState
          icon={<Icons.Inbox />}
          title="No shipments yet"
          description="Shipments appear here once orders are booked with a courier and tracking starts."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tracking #</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">COD</TableHead>
                <TableHead>Collected</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.length === 0 ? (
                <TableEmpty colSpan={6}>No shipments match these filters.</TableEmpty>
              ) : (
                shipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link to={`/shipments/${s.id}`} className="underline-offset-2 hover:underline">
                        {s.trackingNumber ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell>{courierLabel(s.courier)}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="tabular text-right">{s.codAmount != null ? formatPkr(s.codAmount) : '—'}</TableCell>
                    <TableCell>
                      {s.codCollected ? (
                        <span className="inline-flex items-center gap-1 text-neutral-950"><Icons.CheckCircle className="size-4" /> Yes</span>
                      ) : (
                        <span className="text-neutral-400">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-neutral-500">{formatDate(s.updatedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPageChange={goToPage} />}
    </div>
  )
}
