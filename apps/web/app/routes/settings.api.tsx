import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useLoaderData, useActionData, Form, useNavigation } from '@remix-run/react'
import {
  PageHeader,
  SectionHeader,
  Card,
  CardContent,
  Button,
  Input,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  Icons,
} from '~/components/ui'

const API_URL = () => process.env['API_URL'] ?? 'http://localhost:3001'
const TOKEN = () => process.env['DEV_TOKEN'] ?? ''

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}
interface Webhook {
  id: string
  url: string
  events: string[]
  isActive: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}
interface LoaderData {
  keys: ApiKey[]
  webhooks: Webhook[]
  scopes: string[]
  events: string[]
  error: string | null
}

export const meta: MetaFunction = () => [{ title: 'API & Webhooks — EngageIQ' }]

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL()}${path}`, { headers: { Authorization: `Bearer ${TOKEN()}` } })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  const body = (await res.json()) as { data: T }
  return body.data
}

export async function loader(_args: LoaderFunctionArgs) {
  try {
    const [keys, webhooks, meta] = await Promise.all([
      api<ApiKey[]>('/api/v1/settings/api-keys'),
      api<Webhook[]>('/api/v1/settings/webhooks'),
      api<{ scopes: string[]; events: string[] }>('/api/v1/settings/meta'),
    ])
    return json<LoaderData>({ keys, webhooks, scopes: meta.scopes, events: meta.events, error: null })
  } catch {
    return json<LoaderData>({ keys: [], webhooks: [], scopes: [], events: [], error: 'Failed to load settings' })
  }
}

interface ActionData {
  ok: boolean
  message?: string
  newKey?: { name: string; key: string }
  newSecret?: { url: string; secret: string }
}

async function post(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${API_URL()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = form.get('intent')

  try {
    if (intent === 'create-key') {
      const name = String(form.get('name') ?? '').trim()
      const scopes = form.getAll('scopes').map(String)
      if (!name) return json<ActionData>({ ok: false, message: 'Name is required' })
      if (scopes.length === 0) return json<ActionData>({ ok: false, message: 'Select at least one scope' })
      const res = await post('/api/v1/settings/api-keys', 'POST', { name, scopes })
      if (!res.ok) return json<ActionData>({ ok: false, message: 'Failed to create key' })
      const body = (await res.json()) as { data: { key: string; apiKey: ApiKey } }
      return json<ActionData>({ ok: true, newKey: { name, key: body.data.key } })
    }
    if (intent === 'revoke-key') {
      const id = String(form.get('id'))
      await post(`/api/v1/settings/api-keys/${id}`, 'DELETE')
      return json<ActionData>({ ok: true, message: 'API key revoked' })
    }
    if (intent === 'create-webhook') {
      const url = String(form.get('url') ?? '').trim()
      const events = form.getAll('events').map(String)
      const description = String(form.get('description') ?? '').trim()
      if (!url) return json<ActionData>({ ok: false, message: 'URL is required' })
      if (events.length === 0) return json<ActionData>({ ok: false, message: 'Select at least one event' })
      const res = await post('/api/v1/settings/webhooks', 'POST', {
        url,
        events,
        ...(description ? { description } : {}),
      })
      if (!res.ok) return json<ActionData>({ ok: false, message: 'Failed to create webhook' })
      const body = (await res.json()) as { data: { webhook: Webhook; secret: string } }
      return json<ActionData>({ ok: true, newSecret: { url, secret: body.data.secret } })
    }
    if (intent === 'delete-webhook') {
      const id = String(form.get('id'))
      await post(`/api/v1/settings/webhooks/${id}`, 'DELETE')
      return json<ActionData>({ ok: true, message: 'Webhook deleted' })
    }
    if (intent === 'test-webhook') {
      const id = String(form.get('id'))
      await post(`/api/v1/settings/webhooks/${id}/test`, 'POST')
      return json<ActionData>({ ok: true, message: 'Test event queued' })
    }
    return json<ActionData>({ ok: false, message: 'Unknown action' })
  } catch {
    return json<ActionData>({ ok: false, message: 'Request failed' })
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** One-time reveal box for a freshly created secret/key. */
function RevealBox({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="mb-6 rounded-lg border border-neutral-950 bg-neutral-50 p-4">
      <div className="flex items-start gap-3">
        <Icons.AlertCircle className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-950">{label}</p>
          <p className="mb-3 text-xs text-neutral-600">{hint}</p>
          <code className="block w-full overflow-x-auto rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-950">
            {value}
          </code>
        </div>
      </div>
    </div>
  )
}

export default function SettingsApiRoute() {
  const { keys, webhooks, scopes, events, error } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state === 'submitting'

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        eyebrow="Developers"
        title="API & Webhooks"
        description="Issue API keys for the public REST API and configure outbound webhooks that POST to your endpoints on key events."
      />

      {error ? (
        <div className="mb-6 rounded-lg border border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700">
          {error} — is the API running?
        </div>
      ) : null}

      {actionData?.newKey ? (
        <RevealBox
          label={`API key "${actionData.newKey.name}" created`}
          value={actionData.newKey.key}
          hint="Copy it now — for security it is shown only once and cannot be retrieved again."
        />
      ) : null}
      {actionData?.newSecret ? (
        <RevealBox
          label="Webhook signing secret"
          value={actionData.newSecret.secret}
          hint={`Use this to verify the X-EngageIQ-Signature header (HMAC-SHA256) on requests to ${actionData.newSecret.url}. Shown only once.`}
        />
      ) : null}
      {actionData && !actionData.ok && actionData.message ? (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-neutral-950 bg-neutral-50 p-3 text-sm font-medium text-neutral-950">
          <Icons.AlertTriangle className="size-4" />
          {actionData.message}
        </div>
      ) : null}
      {actionData?.ok && actionData.message ? (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          <Icons.CheckCircle className="size-4" />
          {actionData.message}
        </div>
      ) : null}

      {/* ─── API KEYS ─────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <SectionHeader title="API Keys" divider />
        <Card className="mb-4">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length === 0 ? (
                  <TableEmpty colSpan={5}>No API keys yet. Create one below.</TableEmpty>
                ) : (
                  keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">
                        {k.name}
                        {!k.isActive ? <Badge variant="subtle" className="ml-2">inactive</Badge> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <Badge key={s} variant="outline" size="sm">{s}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-neutral-500">{fmtDate(k.lastUsedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="revoke-key" />
                          <input type="hidden" name="id" value={k.id} />
                          <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                            Revoke
                          </Button>
                        </Form>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create-key" />
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-900" htmlFor="key-name">
                  Key name
                </label>
                <Input id="key-name" name="name" placeholder="e.g. Production integration" required />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-neutral-900">Scopes</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {scopes.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input type="checkbox" name="scopes" value={s} className="accent-neutral-950" />
                      <span className="font-mono text-xs">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Button type="submit" isLoading={busy} leftIcon={<Icons.Plus className="size-4" />}>
                Create API key
              </Button>
            </Form>
          </CardContent>
        </Card>
      </section>

      {/* ─── WEBHOOKS ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Outbound Webhooks" divider />
        <Card className="mb-4">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.length === 0 ? (
                  <TableEmpty colSpan={4}>No webhooks configured yet.</TableEmpty>
                ) : (
                  webhooks.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="max-w-xs truncate font-mono text-xs">{w.url}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {w.events.map((e) => (
                            <Badge key={e} variant="outline" size="sm">{e}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {w.isActive ? (
                          <Badge variant="solid" size="sm">active</Badge>
                        ) : (
                          <Badge variant="subtle" size="sm">paused</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Form method="post" className="inline">
                            <input type="hidden" name="intent" value="test-webhook" />
                            <input type="hidden" name="id" value={w.id} />
                            <Button type="submit" variant="ghost" size="sm" disabled={busy}>Send test</Button>
                          </Form>
                          <Form method="post" className="inline">
                            <input type="hidden" name="intent" value="delete-webhook" />
                            <input type="hidden" name="id" value={w.id} />
                            <Button type="submit" variant="ghost" size="sm" disabled={busy}>Delete</Button>
                          </Form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create-webhook" />
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-900" htmlFor="wh-url">
                  Endpoint URL
                </label>
                <Input id="wh-url" name="url" type="url" placeholder="https://your-app.com/webhooks/engageiq" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-900" htmlFor="wh-desc">
                  Description <span className="text-neutral-400">(optional)</span>
                </label>
                <Input id="wh-desc" name="description" placeholder="What this endpoint is for" />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-neutral-900">Events</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {events.map((e) => (
                    <label key={e} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input type="checkbox" name="events" value={e} className="accent-neutral-950" />
                      <span className="font-mono text-xs">{e}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Button type="submit" isLoading={busy} leftIcon={<Icons.Plus className="size-4" />}>
                Add webhook
              </Button>
            </Form>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
