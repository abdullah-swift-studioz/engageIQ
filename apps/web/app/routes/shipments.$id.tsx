import { json, type LoaderFunctionArgs, type ActionFunctionArgs, type MetaFunction } from '@remix-run/node'
import { useLoaderData, Form, useNavigation } from '@remix-run/react'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  EmptyState,
  Icons,
} from '~/components/ui'
import { statusPresentation, courierLabel, formatPkr, formatDate } from '~/lib/courier-format'

export const meta: MetaFunction = () => [{ title: 'Shipment — EngageIQ' }]

interface CourierEvent {
  id: string
  status: string
  description: string | null
  externalId: string | null
  occurredAt: string
}
interface ShipmentDetail {
  id: string
  courier: string
  trackingNumber: string | null
  status: string
  codAmount: number | null
  codCollected: boolean
  codCollectedAt: string | null
  returnReason: string | null
  customerId: string | null
  orderId: string | null
  codOrderId: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
  returnedAt: string | null
  updatedAt: string
  createdAt: string
  events: CourierEvent[]
}

function apiBase(): string {
  return process.env['API_URL'] ?? 'http://localhost:3001'
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env['DEV_TOKEN'] ?? ''}` }
}

export async function loader({ params }: LoaderFunctionArgs) {
  const res = await fetch(`${apiBase()}/api/v1/couriers/shipments/${params['id']}`, { headers: authHeaders() })
  if (res.status === 404) throw new Response('Not found', { status: 404 })
  if (!res.ok) throw new Response('Failed to load shipment', { status: 502 })
  const body = (await res.json()) as { data: ShipmentDetail }
  return json({ shipment: body.data })
}

export async function action({ params }: ActionFunctionArgs) {
  const res = await fetch(`${apiBase()}/api/v1/couriers/shipments/${params['id']}/sync`, { method: 'POST', headers: authHeaders() })
  const body = (await res.json()) as { success: boolean; data?: { result: string } }
  return json({ ok: body.success, result: body.data?.result ?? 'unknown' })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-sm text-neutral-950">{children}</p>
    </div>
  )
}

export default function ShipmentDetailPage() {
  const { shipment } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const p = statusPresentation(shipment.status)
  const StatusIcon = p.icon

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Shipments', href: '/shipments' }, { label: shipment.trackingNumber ?? 'Detail' }]} />

      <PageHeader
        eyebrow={courierLabel(shipment.courier)}
        title={<span className="font-mono">{shipment.trackingNumber ?? 'No tracking number'}</span>}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge variant={p.variant} className="gap-1"><StatusIcon className="size-3.5" />{p.label}</Badge>
            <span className="text-neutral-500">Updated {formatDate(shipment.updatedAt)}</span>
          </span>
        }
        actions={
          <Form method="post">
            <Button type="submit" variant="secondary" leftIcon={<Icons.ArrowRight className="size-4" />} isLoading={navigation.state === 'submitting'}>
              Sync now
            </Button>
          </Form>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Courier">{courierLabel(shipment.courier)}</Field>
            <Field label="COD Amount">{shipment.codAmount != null ? formatPkr(shipment.codAmount) : '—'}</Field>
            <Field label="COD Collected">
              {shipment.codCollected ? (
                <span className="inline-flex items-center gap-1"><Icons.CheckCircle className="size-4" /> {formatDate(shipment.codCollectedAt)}</span>
              ) : ('No')}
            </Field>
            <Field label="Dispatched">{formatDate(shipment.dispatchedAt)}</Field>
            <Field label="Delivered">{formatDate(shipment.deliveredAt)}</Field>
            <Field label="Returned">{formatDate(shipment.returnedAt)}</Field>
            {shipment.returnReason && <Field label="Return Reason">{shipment.returnReason}</Field>}
            {shipment.customerId && <Field label="Customer">{shipment.customerId}</Field>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Tracking history</CardTitle></CardHeader>
          <CardContent>
            {shipment.events.length === 0 ? (
              <EmptyState icon={<Icons.Inbox />} title="No tracking events yet" description="Events appear as the courier reports checkpoints." />
            ) : (
              <ol className="relative space-y-5 border-l border-neutral-200 pl-6">
                {shipment.events.map((e) => {
                  const ep = statusPresentation(e.status)
                  const EIcon = ep.icon
                  return (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[31px] flex size-5 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950">
                        <EIcon className="size-3" />
                      </span>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-950">{ep.label}</p>
                        <p className="tabular text-xs text-neutral-500">{formatDate(e.occurredAt)}</p>
                      </div>
                      {e.description && e.description !== ep.label && (
                        <p className="mt-0.5 text-sm text-neutral-600">{e.description}</p>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
