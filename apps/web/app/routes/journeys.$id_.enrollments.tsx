import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardContent,
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

export const meta: MetaFunction = () => [{ title: 'Enrollments — EngageIQ' }]

interface Enrollment {
  id: string
  customerId: string
  status: string
  enrolledAt: string
  completedAt: string | null
  exitedAt: string | null
  lastStepAt: string | null
  currentStepId: string | null
}

interface LoaderData {
  journeyId: string
  enrollments: Enrollment[]
  total: number
  error: string | null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'
  const status = url.searchParams.get('status') ?? ''
  const journeyId = params['id'] ?? ''

  try {
    const qs = new URLSearchParams({ page, pageSize: '20' })
    if (status) qs.set('status', status)
    const res = await fetch(`${apiUrl}/api/v1/journeys/${journeyId}/enrollments?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journeyId, enrollments: [], total: 0, error: 'Failed to load enrollments' })
    const body = await res.json() as { data: Enrollment[]; meta: { total: number } }
    return json<LoaderData>({ journeyId, enrollments: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ journeyId, enrollments: [], total: 0, error: 'Network error' })
  }
}

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  ACTIVE: 'solid',
  COMPLETED: 'solid',
  EXITED: 'outline',
  FAILED: 'outline',
}

function statusIcon(status: string) {
  if (status === 'COMPLETED') return <Icons.CheckCircle className="size-3.5" />
  if (status === 'FAILED') return <Icons.AlertCircle className="size-3.5" />
  return null
}

export default function EnrollmentsPage() {
  const { journeyId, enrollments, total, error } = useLoaderData<LoaderData>()

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb
        items={[
          { label: 'Journeys', href: '/journeys' },
          { label: 'Journey', href: `/journeys/${journeyId}` },
          { label: 'Enrollments' },
        ]}
      />
      <PageHeader
        eyebrow="Journey"
        title="Enrollments"
        description={`${total} customer${total === 1 ? '' : 's'} enrolled in this journey.`}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
          <Icons.AlertCircle className="size-4 text-neutral-950" />
          <p className="text-sm font-medium text-neutral-950">{error}</p>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {enrollments.length === 0 && !error ? (
            <EmptyState
              icon={<Icons.Users className="size-6" />}
              title="No enrollments yet"
              description="Customers appear here once they match the journey trigger."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enrolled At</TableHead>
                  <TableHead>Last Step At</TableHead>
                  <TableHead>Completed / Exited</TableHead>
                  <TableHead>Current Step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.length === 0 ? (
                  <TableEmpty colSpan={6}>No enrollments.</TableEmpty>
                ) : (
                  enrollments.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link
                          to={`/customers/${e.customerId}`}
                          className="font-mono text-sm underline-offset-2 hover:underline"
                        >
                          {e.customerId.slice(0, 12)}…
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[e.status] ?? 'subtle'} dot>
                          {statusIcon(e.status)}
                          {e.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-neutral-600">{new Date(e.enrolledAt).toLocaleString()}</TableCell>
                      <TableCell className="text-neutral-600">
                        {e.lastStepAt ? new Date(e.lastStepAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-neutral-600">
                        {e.completedAt
                          ? new Date(e.completedAt).toLocaleString()
                          : e.exitedAt
                            ? new Date(e.exitedAt).toLocaleString()
                            : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-neutral-500">
                        {e.currentStepId ? e.currentStepId.slice(0, 12) + '…' : '—'}
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
