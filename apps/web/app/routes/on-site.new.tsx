import { json, redirect } from '@remix-run/node'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node'
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import { PageHeader, Button, buttonVariants, Icons } from '~/components/ui'
import { ElementForm } from '~/components/onsite/ElementForm'
import {
  apiSend,
  parseElementForm,
  listSegmentOptions,
  type SegmentOption,
} from '~/components/onsite/api.server'

export const meta: MetaFunction = () => [{ title: 'New On-Site Element — EngageIQ' }]

export async function loader(_args: LoaderFunctionArgs) {
  const segments = await listSegmentOptions()
  return json<{ segments: SegmentOption[] }>({ segments })
}

export async function action({ request }: ActionFunctionArgs) {
  const body = parseElementForm(await request.formData())
  const result = await apiSend('/api/v1/onsite', 'POST', body)
  if (!result.ok) {
    return json({ error: result.error ?? 'Could not create element' }, { status: 400 })
  }
  const created = result.data as { id?: string } | null
  return redirect(created?.id ? `/on-site/${created.id}` : '/on-site')
}

export default function NewOnSiteElement() {
  const { segments } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const saving = nav.state === 'submitting'

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        eyebrow="On-Site"
        title="New element"
        description="Design a popup, sticky bar, or inline embed and choose who sees it."
      />
      <Form method="post" className="flex flex-col gap-6">
        {actionData?.error && (
          <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
            <Icons.AlertCircle className="size-4" />
            {actionData.error}
          </p>
        )}
        <ElementForm segments={segments} />
        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={saving}>
            Create element
          </Button>
          <Link to="/on-site" className={buttonVariants({ variant: 'secondary' })}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
