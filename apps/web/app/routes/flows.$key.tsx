import { useLoaderData, useActionData, Form, Link, useNavigation } from '@remix-run/react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Button,
  Card,
  CardContent,
  Badge,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.template ? `${data.template.name} — Flow Library` : 'Flow Library — EngageIQ' },
]

type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'

interface FlowNode {
  tempId: string
  stepType: 'TRIGGER' | 'ACTION' | 'CONDITION' | 'DELAY' | 'AB_SPLIT'
  label: string | null
  config: Record<string, unknown>
  parentTempId: string | null
}

interface FlowTemplate {
  key: string
  name: string
  category: string
  description: string
  channels: Channel[]
  icon: string | null
  graph: {
    trigger: { triggerType: string; triggerConfig: Record<string, unknown>; exitTrigger: string | null }
    nodes: FlowNode[]
  }
}

interface LoaderData {
  template: FlowTemplate | null
  error: string | null
}

interface ActionData {
  error: string
}

export async function loader({ params }: LoaderFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiUrl}/api/v1/flow-library/${params['key']}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) return json<LoaderData>({ template: null, error: 'Flow not found' }, { status: 404 })
    if (!res.ok) return json<LoaderData>({ template: null, error: 'Failed to load flow' })
    const body = (await res.json()) as { data: FlowTemplate }
    return json<LoaderData>({ template: body.data, error: null })
  } catch {
    return json<LoaderData>({ template: null, error: 'Network error' })
  }
}

export async function action({ params, request: _request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  try {
    const res = await fetch(`${apiUrl}/api/v1/flow-library/${params['key']}/use`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      return json<ActionData>({ error: 'Could not create a journey from this flow.' }, { status: 400 })
    }
    const body = (await res.json()) as { data: { journeyId: string } }
    // Land the merchant straight in the visual builder to customize their new DRAFT journey.
    return redirect(`/journeys/builder/${body.data.journeyId}`)
  } catch {
    return json<ActionData>({ error: 'Network error creating the journey.' }, { status: 500 })
  }
}

const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  SMS: 'SMS',
  PUSH: 'Push',
}

const TRIGGER_LABEL: Record<string, string> = {
  order_placed: 'When an order is placed',
  segment_entered: 'When a customer enters a segment',
  custom_event: 'When a custom event fires',
  scheduled: 'On a schedule',
}

const OPERATOR_LABEL: Record<string, string> = {
  eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
  is_true: 'is yes', is_false: 'is no', in: 'in', not_in: 'not in',
  contains: 'contains', between: 'between',
}

function childrenOf(nodes: FlowNode[], parentId: string | null): FlowNode[] {
  return nodes.filter((n) => n.parentTempId === parentId)
}

function conditionText(config: Record<string, unknown>): string {
  const field = String(config['field'] ?? 'field').replace(/_/g, ' ')
  const op = OPERATOR_LABEL[String(config['operator'])] ?? String(config['operator'])
  const val = config['value']
  return `If ${field} ${op} ${val === undefined ? '' : JSON.stringify(val)}`.trim()
}

function StepChain({ nodes, node }: { nodes: FlowNode[]; node: FlowNode }) {
  const kids = childrenOf(nodes, node.tempId)

  if (node.stepType === 'CONDITION') {
    const trueHead = kids.find((k) => k.label === 'true')
    const falseHead = kids.find((k) => k.label === 'false')
    return (
      <>
        <StepRow node={node} />
        <div className="ml-4 grid grid-cols-1 gap-4 border-l border-neutral-200 pl-4 md:grid-cols-2">
          <BranchColumn nodes={nodes} label="If yes" head={trueHead} />
          <BranchColumn nodes={nodes} label="If no" head={falseHead} />
        </div>
      </>
    )
  }

  return (
    <>
      <StepRow node={node} />
      {kids.map((k) => (
        <StepChain key={k.tempId} nodes={nodes} node={k} />
      ))}
    </>
  )
}

function BranchColumn({ nodes, label, head }: { nodes: FlowNode[]; label: string; head?: FlowNode }) {
  return (
    <div>
      <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="space-y-3">
        {head ? <StepChain nodes={nodes} node={head} /> : <p className="text-sm text-neutral-400">— ends —</p>}
      </div>
    </div>
  )
}

function StepRow({ node }: { node: FlowNode }) {
  if (node.stepType === 'TRIGGER') return null // trigger rendered separately at the top

  if (node.stepType === 'DELAY') {
    return (
      <div className="flex items-center gap-2 py-1 pl-1">
        <span className="inline-block h-4 w-px bg-neutral-200" aria-hidden />
        <Badge variant="subtle" size="sm">
          {node.label ?? 'Wait'}
        </Badge>
      </div>
    )
  }

  if (node.stepType === 'CONDITION') {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-3">
          <Icons.Filter className="mt-0.5 size-4 shrink-0 text-neutral-500" />
          <div>
            <p className="text-2xs font-medium uppercase tracking-wide text-neutral-400">Condition</p>
            <p className="text-sm text-neutral-950">{conditionText(node.config)}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ACTION (message) — a two-way "wait for reply" action would also land here in future flows.
  const channel = String(node.config['channel'] ?? '') as Channel
  const content = (node.config['content'] ?? {}) as { body?: string; subject?: string }
  const Icon = channel === 'EMAIL' ? Icons.Mail : channel === 'WHATSAPP' ? Icons.MessageCircle : Icons.Inbox
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-neutral-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-2xs font-medium uppercase tracking-wide text-neutral-400">Send</p>
            <Badge variant="outline" size="sm">
              {CHANNEL_LABEL[channel] ?? channel}
            </Badge>
          </div>
          {content.subject ? (
            <p className="mt-1 text-sm font-medium text-neutral-950">{content.subject}</p>
          ) : null}
          <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600">{content.body}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function FlowPreviewPage() {
  const { template, error } = useLoaderData<LoaderData>()
  const actionData = useActionData<typeof action>() as ActionData | undefined
  const nav = useNavigation()
  const submitting = nav.state === 'submitting'

  if (!template) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Breadcrumb items={[{ label: 'Flows', href: '/flows' }, { label: 'Not found' }]} />
        <div className="mt-8 rounded-lg border border-neutral-200 p-8 text-center">
          <Icons.AlertTriangle className="mx-auto size-6 text-neutral-500" />
          <p className="mt-2 text-neutral-950">{error ?? 'Flow not found'}</p>
          <Link to="/flows" className="mt-4 inline-block text-sm text-neutral-600 underline">
            Back to Flow Library
          </Link>
        </div>
      </div>
    )
  }

  const roots = childrenOf(template.graph.nodes, null)
  const trigger = roots.find((n) => n.stepType === 'TRIGGER') ?? roots[0]

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Breadcrumb items={[{ label: 'Flows', href: '/flows' }, { label: template.name }]} />

      <div className="mt-4">
        <PageHeader
          eyebrow="Flow preview"
          title={template.name}
          description={template.description}
          actions={
            <Form method="post">
              <Button type="submit" isLoading={submitting} leftIcon={<Icons.Plus />}>
                Use this flow
              </Button>
            </Form>
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {template.channels.map((c) => (
          <Badge key={c} variant="outline" size="sm">
            {CHANNEL_LABEL[c] ?? c}
          </Badge>
        ))}
      </div>

      {actionData?.error ? (
        <div className="mt-4 flex items-center gap-2 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-950">
          <Icons.AlertCircle className="size-4 shrink-0" />
          {actionData.error}
        </div>
      ) : null}

      <p className="mt-6 text-sm text-neutral-500">
        Using this flow creates a new <span className="font-medium text-neutral-950">draft journey</span> in your
        account with these steps copied in. You can edit everything in the visual builder before activating it.
      </p>

      <div className="mt-6 space-y-3">
        {/* Trigger header */}
        <Card>
          <CardContent className="flex items-start gap-3 p-3">
            <Icons.Route className="mt-0.5 size-4 shrink-0 text-neutral-950" />
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-neutral-400">Trigger</p>
              <p className="text-sm text-neutral-950">
                {TRIGGER_LABEL[template.graph.trigger.triggerType] ?? template.graph.trigger.triggerType}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Step chain(s) under the trigger */}
        {trigger
          ? childrenOf(template.graph.nodes, trigger.tempId).map((n) => (
              <StepChain key={n.tempId} nodes={template.graph.nodes} node={n} />
            ))
          : null}
      </div>
    </div>
  )
}
