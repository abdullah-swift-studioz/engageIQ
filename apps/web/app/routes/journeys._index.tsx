import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  buttonVariants,
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

export const meta: MetaFunction = () => [{ title: 'Journeys — EngageIQ' }]

interface JourneyListItem {
  id: string
  name: string
  description: string | null
  triggerType: string
  status: string
  reEntryRule: string
  exitTrigger: string | null
  enrollmentCount: number
  completionCount: number
  createdAt: string
}

interface LoaderData {
  journeys: JourneyListItem[]
  total: number
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/journeys?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ journeys: [], total: 0, error: 'Failed to load journeys' })
    const body = await res.json() as { data: JourneyListItem[]; meta: { total: number } }
    return json<LoaderData>({ journeys: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ journeys: [], total: 0, error: 'Network error' })
  }
}

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  ACTIVE: 'solid',
  DRAFT: 'subtle',
  PAUSED: 'outline',
  ARCHIVED: 'subtle',
}

export default function JourneysPage() {
  const { journeys, total, error } = useLoaderData<LoaderData>()
  const active = journeys.filter((j) => j.status === 'ACTIVE').length
  const drafts = journeys.filter((j) => j.status === 'DRAFT').length

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Engage"
        title="Journeys"
        description="Automated, multi-step flows that enroll customers on a trigger and guide them to a goal."
        actions={
          <Link to="/journeys/new" className={buttonVariants({ variant: 'primary' })}>
            <Icons.Plus className="size-4" />
            New journey
          </Link>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
          <Icons.AlertCircle className="size-4 text-neutral-950" />
          <p className="text-sm font-medium text-neutral-950">{error}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total journeys" value={total} />
        <StatCard label="Active" value={active} />
        <StatCard label="Drafts" value={drafts} />
      </div>

      <Card>
        <CardContent className="pt-6">
          {journeys.length === 0 && !error ? (
            <EmptyState
              icon={<Icons.Route className="size-6" />}
              title="No journeys yet"
              description="Create one to start enrolling customers on a trigger."
              action={
                <Link to="/journeys/new" className={buttonVariants({ variant: 'primary' })}>
                  New journey
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journeys.length === 0 ? (
                  <TableEmpty colSpan={6}>No journeys.</TableEmpty>
                ) : (
                  journeys.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>
                        <Link to={`/journeys/${j.id}`} className="font-medium underline-offset-2 hover:underline">
                          {j.name}
                        </Link>
                        {j.description && <div className="text-xs text-neutral-500">{j.description}</div>}
                      </TableCell>
                      <TableCell className="text-neutral-600">{j.triggerType}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[j.status] ?? 'subtle'} dot>
                          {j.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular">{j.enrollmentCount}</TableCell>
                      <TableCell className="tabular">{j.completionCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Link to={`/journeys/${j.id}`} className="text-sm font-medium underline-offset-2 hover:underline">
                            Edit
                          </Link>
                          <Link
                            to={`/journeys/${j.id}/enrollments`}
                            className="text-sm text-neutral-500 underline-offset-2 hover:underline"
                          >
                            Enrollments
                          </Link>
                        </div>
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
