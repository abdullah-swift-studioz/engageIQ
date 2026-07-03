import { json, redirect } from '@remix-run/node'
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { Form, Link, useActionData, useNavigation } from '@remix-run/react'
import { PageHeader, Card, CardContent, Button, Input, FormField, Breadcrumb } from '~/components/ui'
import { apiFetch } from '~/lib/email-api.server'

export const meta: MetaFunction = () => [{ title: 'New email template — EngageIQ' }]

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const name = String(form.get('name') ?? '').trim()
  const subject = String(form.get('subject') ?? '').trim()
  if (!name) return json({ error: 'Name is required' }, { status: 400 })

  const res = await apiFetch<{ id: string }>('/api/v1/email-templates', {
    method: 'POST',
    body: JSON.stringify({
      name,
      subject: subject || undefined,
      // Seed with a starter text block so the builder opens with something to edit.
      blocks: [{ id: 'b_intro', type: 'text', html: '<p>Hello {{customer.first_name|there}},</p>' }],
    }),
  })
  if (!res.ok || !res.data) return json({ error: res.error ?? 'Failed to create template' }, { status: 400 })
  return redirect(`/email-templates/${res.data.id}`)
}

export default function NewEmailTemplate() {
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()

  return (
    <div className="mx-auto max-w-[640px] px-6 py-6">
      <Breadcrumb items={[{ label: 'Email Templates', href: '/email-templates' }, { label: 'New' }]} />
      <PageHeader eyebrow="Email" title="New email template" description="Name it — you’ll design the content next." />
      <Card>
        <CardContent className="pt-6">
          <Form method="post" className="space-y-4">
            <FormField label="Template name" error={actionData?.error}>
              <Input name="name" placeholder="Weekly Picks" autoFocus />
            </FormField>
            <FormField label="Subject line" hint="Optional now — you can edit it in the builder.">
              <Input name="subject" placeholder="Your weekly picks are here" />
            </FormField>
            <div className="flex justify-end gap-2">
              <Link to="/email-templates">
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" isLoading={nav.state === 'submitting'}>
                Create &amp; design
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
