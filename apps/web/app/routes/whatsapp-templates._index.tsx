import { Link, useLoaderData } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  buttonVariants,
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

export const meta: MetaFunction = () => [{ title: 'WhatsApp Templates — EngageIQ' }]

interface TemplateListItem {
  id: string
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING'
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
}

interface LoaderData {
  templates: TemplateListItem[]
  total: number
  error: string | null
}

const STATUS_VARIANT: Record<string, 'solid' | 'outline' | 'subtle'> = {
  DRAFT: 'subtle',
  PENDING: 'outline',
  APPROVED: 'solid',
  REJECTED: 'outline',
}

function statusIcon(status: string) {
  if (status === 'APPROVED') return <Icons.CheckCircle className="size-3.5" />
  if (status === 'REJECTED') return <Icons.AlertCircle className="size-3.5" />
  return null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const page = new URL(request.url).searchParams.get('page') ?? '1'

  try {
    const res = await fetch(`${apiUrl}/api/v1/whatsapp-templates?page=${page}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ templates: [], total: 0, error: 'Failed to load templates' })
    const body = (await res.json()) as { data: TemplateListItem[]; meta: { total: number } }
    return json<LoaderData>({ templates: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ templates: [], total: 0, error: 'Network error' })
  }
}

export default function WhatsAppTemplatesPage() {
  const { templates, total, error } = useLoaderData<LoaderData>()

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="Channels"
        title="WhatsApp Templates"
        description="Reusable message templates submitted to Meta for approval before sending."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/messages" className={buttonVariants({ variant: 'secondary' })}>
              Message log
              <Icons.ArrowRight className="size-4" />
            </Link>
            <Link to="/whatsapp-templates/new" className={buttonVariants({ variant: 'primary' })}>
              <Icons.Plus className="size-4" />
              New template
            </Link>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
          <Icons.AlertCircle className="size-4 text-neutral-950" />
          <p className="text-sm font-medium text-neutral-950">{error}</p>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {templates.length === 0 && !error ? (
            <EmptyState
              icon={<Icons.MessageCircle className="size-6" />}
              title="No templates yet"
              description="Create one and submit it to Meta for approval."
              action={
                <Link to="/whatsapp-templates/new" className={buttonVariants({ variant: 'primary' })}>
                  New template
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.length === 0 ? (
                  <TableEmpty colSpan={4}>No templates.</TableEmpty>
                ) : (
                  templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link
                          to={`/whatsapp-templates/${t.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-neutral-600">{t.language}</TableCell>
                      <TableCell className="text-neutral-600">{t.category}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[t.status] ?? 'subtle'} dot>
                          {statusIcon(t.status)}
                          {t.status}
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
