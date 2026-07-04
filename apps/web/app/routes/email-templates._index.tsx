import { json } from '@remix-run/node'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { Link, useLoaderData } from '@remix-run/react'
import {
  PageHeader,
  Button,
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
  Icons,
} from '~/components/ui'
import { apiFetchList } from '~/lib/email-api.server'

export const meta: MetaFunction = () => [{ title: 'Email Templates — EngageIQ' }]

interface TemplateRow {
  id: string
  name: string
  subject: string | null
  status: string
  isTransactional: boolean
  updatedAt: string
}

export async function loader(_args: LoaderFunctionArgs) {
  const res = await apiFetchList<TemplateRow>('/api/v1/email-templates?pageSize=100')
  return json({ templates: res.data, total: res.total, error: res.error ?? null })
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'ACTIVE' ? 'solid' : 'subtle'}>{status}</Badge>
}

export default function EmailTemplatesIndex() {
  const { templates, total, error } = useLoaderData<typeof loader>()

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <PageHeader
        eyebrow="Email"
        title="Email Templates"
        description="Drag-and-drop email campaigns with live products, personalization, and A/B testing."
        actions={
          <Link to="/email-templates/new">
            <Button leftIcon={<Icons.Plus className="size-4" />}>New template</Button>
          </Link>
        }
      />

      {error && <p className="mb-4 text-sm text-neutral-600">Couldn’t load templates: {error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.length === 0 ? (
                <TableEmpty colSpan={5}>No email templates yet. Create your first one.</TableEmpty>
              ) : (
                templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link to={`/email-templates/${t.id}`} className="font-medium text-neutral-950 hover:underline">
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-neutral-600">{t.subject ?? '—'}</TableCell>
                    <TableCell>{t.isTransactional ? 'Transactional' : 'Marketing'}</TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="tabular text-neutral-500">
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="mt-3 text-sm text-neutral-500">{total} template{total === 1 ? '' : 's'}</p>
    </div>
  )
}
