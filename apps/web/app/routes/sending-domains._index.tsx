import { json } from '@remix-run/node'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { Form, useLoaderData, useNavigation } from '@remix-run/react'
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  FormField,
  Badge,
  Icons,
  EmptyState,
} from '~/components/ui'
import { apiFetch, apiFetchList } from '~/lib/email-api.server'

export const meta: MetaFunction = () => [{ title: 'Sending Domains — EngageIQ' }]

interface DnsRecord {
  kind: string
  type: string
  name: string
  value: string
  note?: string
}
interface SendingDomain {
  id: string
  domain: string
  status: string
  dkimVerified: boolean
  spfVerified: boolean
  dmarcVerified: boolean
  dnsRecords: DnsRecord[] | null
}

export async function loader(_args: LoaderFunctionArgs) {
  const res = await apiFetchList<SendingDomain>('/api/v1/sending-domains')
  return json({ domains: res.data, error: res.error ?? null })
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'add') {
    const domain = String(form.get('domain') ?? '').trim()
    const res = await apiFetch('/api/v1/sending-domains', { method: 'POST', body: JSON.stringify({ domain }) })
    return json({ error: res.ok ? null : res.error })
  }
  if (intent === 'verify') {
    const id = String(form.get('id') ?? '')
    await apiFetch(`/api/v1/sending-domains/${id}/verify`, { method: 'POST' })
    return json({ error: null })
  }
  if (intent === 'delete') {
    const id = String(form.get('id') ?? '')
    await apiFetch(`/api/v1/sending-domains/${id}`, { method: 'DELETE' })
    return json({ error: null })
  }
  return json({ error: 'Unknown action' }, { status: 400 })
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      {ok ? <Icons.CheckCircle className="size-4 text-neutral-900" /> : <Icons.XCircle className="size-4 text-neutral-400" />}
      <span className={ok ? 'text-neutral-900' : 'text-neutral-500'}>{label}</span>
    </span>
  )
}

export default function SendingDomainsPage() {
  const { domains, error } = useLoaderData<typeof loader>()
  const nav = useNavigation()

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <PageHeader
        eyebrow="Email"
        title="Sending Domains"
        description="Authenticate your domain with DKIM, SPF, and DMARC for inbox delivery."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a domain</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex items-end gap-2">
            <input type="hidden" name="intent" value="add" />
            <div className="flex-1">
              <FormField label="Domain" hint="A subdomain like mail.yourstore.com is recommended." error={error ?? undefined}>
                <Input name="domain" placeholder="mail.yourstore.com" />
              </FormField>
            </div>
            <Button type="submit" isLoading={nav.state === 'submitting'} leftIcon={<Icons.Plus className="size-4" />}>
              Add
            </Button>
          </Form>
        </CardContent>
      </Card>

      {domains.length === 0 ? (
        <EmptyState
          icon={<Icons.Inbox />}
          title="No sending domains yet"
          description="Add your store’s domain to start authenticating your email."
        />
      ) : (
        <div className="space-y-4">
          {domains.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{d.domain}</CardTitle>
                  <Badge variant={d.status === 'VERIFIED' ? 'solid' : 'outline'}>{d.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <Check ok={d.dkimVerified} label="DKIM" />
                  <Check ok={d.spfVerified} label="SPF" />
                  <Check ok={d.dmarcVerified} label="DMARC" />
                </div>

                {d.dnsRecords && d.dnsRecords.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-neutral-50 text-2xs uppercase tracking-wide text-neutral-500">
                        <tr>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Value</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-xs">
                        {d.dnsRecords.map((r, i) => (
                          <tr key={i} className="border-t border-neutral-200">
                            <td className="px-3 py-2 align-top">{r.type}</td>
                            <td className="px-3 py-2 align-top break-all">{r.name}</td>
                            <td className="px-3 py-2 align-top break-all">{r.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="verify" />
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="secondary">
                      Verify DNS
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="ghost">
                      Remove
                    </Button>
                  </Form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
