import { Form, Link, useActionData, useNavigation } from '@remix-run/react'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import {
  PageHeader,
  Breadcrumb,
  Card,
  CardContent,
  FormField,
  Input,
  Textarea,
  Select,
  Button,
  buttonVariants,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'New Journey — EngageIQ' }]

interface ActionData {
  error: string | null
}

export async function action({ request }: ActionFunctionArgs) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const token = process.env['DEV_TOKEN'] ?? ''
  const formData = await request.formData()

  const triggerType = formData.get('triggerType') as string
  const triggerConfigRaw = formData.get('triggerConfig') as string
  let triggerConfig: unknown = {}
  try {
    triggerConfig = triggerConfigRaw ? JSON.parse(triggerConfigRaw) : {}
  } catch {
    return json<ActionData>({ error: 'triggerConfig must be valid JSON' })
  }

  const body = {
    name: formData.get('name'),
    description: formData.get('description') || null,
    triggerType,
    triggerConfig,
    reEntryRule: formData.get('reEntryRule') || 'DISALLOW',
    exitTrigger: formData.get('exitTrigger') || null,
  }

  const res = await fetch(`${apiUrl}/api/v1/journeys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json() as { error: { message: string } }
    return json<ActionData>({ error: err.error?.message ?? 'Failed to create journey' })
  }

  const created = await res.json() as { data: { id: string } }
  return redirect(`/journeys/${created.data.id}`)
}

export default function NewJourneyPage() {
  const actionData = useActionData<ActionData>()
  const nav = useNavigation()

  return (
    <div className="mx-auto max-w-[640px] px-6 py-6">
      <Breadcrumb items={[{ label: 'Journeys', href: '/journeys' }, { label: 'New' }]} />
      <PageHeader
        eyebrow="Engage"
        title="New journey"
        description="Name it and pick a trigger — you'll design the steps next."
      />

      {actionData?.error && (
        <p className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-950">
          <Icons.AlertCircle className="size-4" />
          {actionData.error}
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <Form method="post" className="space-y-4">
            <FormField label="Name">
              <Input name="name" placeholder="Post-purchase welcome" required autoFocus />
            </FormField>

            <FormField label="Description">
              <Textarea name="description" rows={2} placeholder="Optional summary of what this journey does." />
            </FormField>

            <FormField label="Trigger type">
              <Select name="triggerType" defaultValue="order_placed" required>
                <option value="order_placed">order_placed</option>
                <option value="segment_entered">segment_entered</option>
                <option value="custom_event">custom_event</option>
                <option value="scheduled">scheduled</option>
              </Select>
            </FormField>

            <FormField label="Trigger config (JSON)">
              <Textarea name="triggerConfig" rows={3} placeholder="{}" className="font-mono" />
            </FormField>

            <FormField label="Re-entry rule">
              <Select name="reEntryRule" defaultValue="DISALLOW">
                <option value="DISALLOW">DISALLOW (once only)</option>
                <option value="ALLOW">ALLOW (re-enter any time)</option>
                <option value="RE_ENROLL_AFTER_EXIT">RE_ENROLL_AFTER_EXIT</option>
              </Select>
            </FormField>

            <FormField label="Exit trigger" hint="Optional — ends enrollment when this event fires.">
              <Select name="exitTrigger" defaultValue="">
                <option value="">None</option>
                <option value="order_placed">order_placed</option>
                <option value="segment_entered">segment_entered</option>
                <option value="custom_event">custom_event</option>
              </Select>
            </FormField>

            <div className="flex justify-end gap-2">
              <Link to="/journeys" className={buttonVariants({ variant: 'secondary' })}>
                Cancel
              </Link>
              <Button type="submit" isLoading={nav.state === 'submitting'}>
                Create journey
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
