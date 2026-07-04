import { useLoaderData, Link } from '@remix-run/react'
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import {
  PageHeader,
  SectionHeader,
  Card,
  CardContent,
  Badge,
  EmptyState,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Flow Library — EngageIQ' }]

type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'

interface FlowNode {
  stepType: 'TRIGGER' | 'ACTION' | 'CONDITION' | 'DELAY' | 'AB_SPLIT'
}

interface FlowTemplate {
  key: string
  name: string
  category: string
  description: string
  channels: Channel[]
  icon: string | null
  graph: { nodes: FlowNode[] }
}

interface LoaderData {
  templates: FlowTemplate[]
  total: number
  error: string | null
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiUrl}/api/v1/flow-library`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return json<LoaderData>({ templates: [], total: 0, error: 'Failed to load flow library' })
    const body = (await res.json()) as { data: FlowTemplate[]; meta: { total: number } }
    return json<LoaderData>({ templates: body.data, total: body.meta.total, error: null })
  } catch {
    return json<LoaderData>({ templates: [], total: 0, error: 'Network error' })
  }
}

// Ordered category metadata for the catalog. Any category missing here still renders (appended).
const CATEGORIES: { key: string; label: string; blurb: string }[] = [
  { key: 'abandoned_cart', label: 'Abandoned Cart', blurb: 'Recover carts and checkouts before the sale slips away.' },
  { key: 'welcome', label: 'Welcome Series', blurb: 'Greet new customers and earn that crucial first order.' },
  { key: 'post_purchase', label: 'Post-Purchase', blurb: 'Confirm, delight, cross-sell, and bring buyers back.' },
  { key: 'win_back', label: 'Win-Back', blurb: 'Re-engage lapsed and at-risk customers automatically.' },
  { key: 'loyalty_vip', label: 'Loyalty & VIP', blurb: 'Reward your best customers and grow lifetime value.' },
  { key: 'cod', label: 'COD-Specific', blurb: 'Verify, convert, and follow up on Cash-on-Delivery orders.' },
]

const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  SMS: 'SMS',
  PUSH: 'Push',
}

function stepSummary(nodes: FlowNode[]): string {
  const messages = nodes.filter((n) => n.stepType === 'ACTION').length
  const waits = nodes.filter((n) => n.stepType === 'DELAY').length
  const parts = [`${messages} message${messages === 1 ? '' : 's'}`]
  if (waits > 0) parts.push(`${waits} delay${waits === 1 ? '' : 's'}`)
  if (nodes.some((n) => n.stepType === 'CONDITION')) parts.push('branching')
  return parts.join(' · ')
}

function TemplateCard({ t }: { t: FlowTemplate }) {
  return (
    <Link to={`/flows/${t.key}`} className="group block focus-visible:outline-none">
      <Card className="h-full transition-shadow group-hover:shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-neutral-950 group-focus-visible:ring-offset-2">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium leading-tight tracking-tight text-neutral-950">{t.name}</h3>
            <Icons.ArrowRight className="mt-0.5 size-4 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-950" />
          </div>
          <p className="line-clamp-3 flex-1 text-sm text-neutral-600">{t.description}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {t.channels.map((c) => (
              <Badge key={c} variant="outline" size="sm">
                {CHANNEL_LABEL[c] ?? c}
              </Badge>
            ))}
          </div>
          <p className="text-2xs font-medium uppercase tracking-wide text-neutral-400">
            {stepSummary(t.graph.nodes)}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function FlowLibraryPage() {
  const { templates, total, error } = useLoaderData<LoaderData>()

  const byCategory = new Map<string, FlowTemplate[]>()
  for (const t of templates) {
    const list = byCategory.get(t.category) ?? []
    list.push(t)
    byCategory.set(t.category, list)
  }

  const orderedKeys = [
    ...CATEGORIES.map((c) => c.key).filter((k) => byCategory.has(k)),
    ...[...byCategory.keys()].filter((k) => !CATEGORIES.some((c) => c.key === k)),
  ]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        eyebrow="Automation"
        title="Flow Library"
        description={`${total} pre-built automation flows. Preview one, then activate it with a single click — it becomes an editable journey you can customize.`}
      />

      {error ? (
        <div className="mt-8">
          <EmptyState
            icon={<Icons.AlertTriangle />}
            title="Couldn't load the flow library"
            description={error}
          />
        </div>
      ) : templates.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Icons.Workflow />}
            title="No flows available yet"
            description="The pre-built flow library has not been seeded for this store."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {orderedKeys.map((key) => {
            const meta = CATEGORIES.find((c) => c.key === key)
            const list = byCategory.get(key) ?? []
            return (
              <section key={key}>
                <SectionHeader
                  title={`${meta?.label ?? key} (${list.length})`}
                  actions={meta ? <span className="text-sm text-neutral-500">{meta.blurb}</span> : undefined}
                  divider
                />
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => (
                    <TemplateCard key={t.key} t={t} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
