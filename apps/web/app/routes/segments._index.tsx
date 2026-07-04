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

export const meta: MetaFunction = () => [{ title: 'Segments — EngageIQ' }]

interface SegmentListItem {
  id: string
  name: string
  description: string | null
  memberCount: number
  lastEvaluatedAt: string | null
  isDynamic: boolean
  createdAt: string
}

interface LoaderData {
  segments: SegmentListItem[]
  total: number
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? '1'

  try {
    const res = await fetch(
      `${apiUrl}/api/v1/segments?page=${page}&pageSize=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      return json<LoaderData>({ segments: [], total: 0, error: 'Failed to load segments' })
    }
    const body = await res.json() as { data: SegmentListItem[]; meta: { total: number } }
    return json<LoaderData>({ segments: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ segments: [], total: 0, error: 'Network error' })
  }
}

export default function SegmentsPage() {
  const { segments, total, error } = useLoaderData<LoaderData>()
  const dynamicCount = segments.filter((s) => s.isDynamic).length
  const staticCount = segments.filter((s) => !s.isDynamic).length

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Audience"
        title="Segments"
        description="Target the right customers with dynamic and static audiences."
        actions={
          <Link to="/segments/new" className={buttonVariants({ variant: 'primary' })}>
            <Icons.Plus className="size-4" />
            New segment
          </Link>
        }
      />

      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total segments" value={total} />
        <StatCard label="Dynamic" value={dynamicCount} />
        <StatCard label="Static" value={staticCount} />
      </div>

      <Card>
        <CardContent className="pt-6">
          {segments.length === 0 && !error ? (
            <EmptyState
              icon={<Icons.Filter className="size-6" />}
              title="No segments yet"
              description="Create your first segment to start targeting customers."
              action={
                <Link to="/segments/new" className={buttonVariants({ variant: 'primary' })}>
                  New segment
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Last Evaluated</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {segments.length === 0 ? (
                  <TableEmpty colSpan={4}>No segments.</TableEmpty>
                ) : (
                  segments.map((seg) => (
                    <TableRow key={seg.id}>
                      <TableCell>
                        <Link
                          to={`/segments/${seg.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {seg.name}
                        </Link>
                        {seg.description && (
                          <div className="mt-0.5 text-xs text-neutral-500">{seg.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="tabular">{seg.memberCount.toLocaleString()}</TableCell>
                      <TableCell className="text-neutral-600">
                        {seg.lastEvaluatedAt
                          ? new Date(seg.lastEvaluatedAt).toLocaleString()
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={seg.isDynamic ? 'solid' : 'subtle'} dot>
                          {seg.isDynamic ? 'Dynamic' : 'Static'}
                        </Badge>
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
