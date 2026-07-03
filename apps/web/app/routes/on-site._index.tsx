import { json } from '@remix-run/node'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { Link, useLoaderData } from '@remix-run/react'
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
import { apiGet, type ElementListItem } from '~/components/onsite/api.server'
import { TYPE_LABEL, describeTrigger } from '~/components/onsite/constants'

export const meta: MetaFunction = () => [{ title: 'On-Site — EngageIQ' }]

interface LoaderData {
  elements: ElementListItem[]
  total: number
}

export async function loader(_args: LoaderFunctionArgs) {
  const data = await apiGet<ElementListItem[]>('/api/v1/onsite?page=1&pageSize=100')
  const elements = data ?? []
  return json<LoaderData>({ elements, total: elements.length })
}

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  ACTIVE: 'solid',
  DRAFT: 'subtle',
  PAUSED: 'outline',
  ARCHIVED: 'subtle',
}

export default function OnSiteIndex() {
  const { elements, total } = useLoaderData<typeof loader>()
  const active = elements.filter((e) => e.status === 'ACTIVE').length
  const drafts = elements.filter((e) => e.status === 'DRAFT').length

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Configure"
        title="On-Site Personalization"
        description="Popups, sticky bars, and inline embeds shown to the right visitor on your storefront."
        actions={
          <Link to="/on-site/new" className={buttonVariants({ variant: 'primary' })}>
            <Icons.Plus className="size-4" />
            New element
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total elements" value={total} />
        <StatCard label="Active" value={active} />
        <StatCard label="Drafts" value={drafts} />
      </div>

      <Card>
        <CardContent className="pt-6">
          {elements.length === 0 ? (
            <EmptyState
              icon={<Icons.AppWindow className="size-6" />}
              title="No on-site elements yet"
              description="Create a welcome popup, a free-shipping bar, or a restock embed."
              action={
                <Link to="/on-site/new" className={buttonVariants({ variant: 'primary' })}>
                  New element
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {elements.length === 0 ? (
                  <TableEmpty colSpan={5}>No elements.</TableEmpty>
                ) : (
                  elements.map((el) => (
                    <TableRow key={el.id}>
                      <TableCell>
                        <Link to={`/on-site/${el.id}`} className="font-medium underline-offset-2 hover:underline">
                          {el.name}
                        </Link>
                      </TableCell>
                      <TableCell>{TYPE_LABEL[el.type] ?? el.type}</TableCell>
                      <TableCell className="text-neutral-600">{describeTrigger(el.displayRules)}</TableCell>
                      <TableCell className="text-neutral-600">{el.segmentId ? 'Segment' : 'All visitors'}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[el.status] ?? 'subtle'} dot>
                          {el.status}
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
