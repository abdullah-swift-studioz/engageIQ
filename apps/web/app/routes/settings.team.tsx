import * as React from 'react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useLoaderData, useActionData, useNavigation, useSubmit, Form } from '@remix-run/react'
import type { TeamMember, Role } from '@engageiq/shared'
import { apiFetch } from '~/lib/acting-merchant.server'
import {
  PageHeader,
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
  Button,
  Modal,
  Select,
  Input,
  FormField,
  Avatar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  useToast,
  Icons,
} from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Team & Roles — EngageIQ' }]

const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MARKETER: 'Marketer',
  ANALYST: 'Analyst',
  AGENCY_ADMIN: 'Agency Admin',
  AGENCY_MEMBER: 'Agency Member',
}
const ROLE_ORDER: Role[] = ['OWNER', 'ADMIN', 'MARKETER', 'ANALYST', 'AGENCY_ADMIN', 'AGENCY_MEMBER']

const ROLE_BLURB: Record<Role, string> = {
  OWNER: 'Full access, billing, API keys.',
  ADMIN: 'Everything except billing.',
  MARKETER: 'Campaigns, flows, segments, analytics. No API keys.',
  ANALYST: 'Read-only analytics and segments.',
  AGENCY_ADMIN: 'Manages all client accounts.',
  AGENCY_MEMBER: 'Access to assigned client accounts only.',
}

interface LoaderData {
  members: TeamMember[]
  error: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const res = await apiFetch(request, '/api/v1/settings/team')
    if (res.status === 403) {
      return json<LoaderData>({ members: [], error: 'You do not have permission to manage the team.' })
    }
    if (!res.ok) return json<LoaderData>({ members: [], error: 'Could not load team members.' })
    const body = (await res.json()) as { data: { members: TeamMember[] } }
    return json<LoaderData>({ members: body.data.members, error: null })
  } catch {
    return json<LoaderData>({ members: [], error: 'Could not reach the API.' })
  }
}

interface ActionResult {
  ok: boolean
  intent: string
  message: string
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body.error?.message ?? fallback
  } catch {
    return fallback
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  if (intent === 'invite') {
    const res = await apiFetch(request, '/api/v1/settings/team', {
      method: 'POST',
      body: JSON.stringify({
        email: String(form.get('email') ?? ''),
        firstName: String(form.get('firstName') ?? ''),
        lastName: String(form.get('lastName') ?? ''),
        role: String(form.get('role') ?? 'MARKETER'),
        password: String(form.get('password') ?? ''),
      }),
    })
    if (!res.ok) return json<ActionResult>({ ok: false, intent, message: await readError(res, 'Could not invite user') })
    return json<ActionResult>({ ok: true, intent, message: 'Teammate added.' })
  }

  if (intent === 'update-role') {
    const id = String(form.get('userId') ?? '')
    const res = await apiFetch(request, `/api/v1/settings/team/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: String(form.get('role') ?? '') }),
    })
    if (!res.ok) return json<ActionResult>({ ok: false, intent, message: await readError(res, 'Could not change role') })
    return json<ActionResult>({ ok: true, intent, message: 'Role updated.' })
  }

  if (intent === 'toggle-active') {
    const id = String(form.get('userId') ?? '')
    const isActive = String(form.get('isActive') ?? '') === 'true'
    const res = await apiFetch(request, `/api/v1/settings/team/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) return json<ActionResult>({ ok: false, intent, message: await readError(res, 'Could not update user') })
    return json<ActionResult>({ ok: true, intent, message: isActive ? 'User activated.' : 'User deactivated.' })
  }

  if (intent === 'delete') {
    const id = String(form.get('userId') ?? '')
    const res = await apiFetch(request, `/api/v1/settings/team/${id}`, { method: 'DELETE' })
    if (!res.ok) return json<ActionResult>({ ok: false, intent, message: await readError(res, 'Could not remove user') })
    return json<ActionResult>({ ok: true, intent, message: 'User removed.' })
  }

  return json<ActionResult>({ ok: false, intent, message: 'Unknown action' }, { status: 400 })
}

export default function TeamSettings() {
  const { members, error } = useLoaderData<typeof loader>()
  const result = useActionData<typeof action>()
  const nav = useNavigation()
  const submit = useSubmit()
  const { toast } = useToast()

  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TeamMember | null>(null)
  const [removing, setRemoving] = React.useState<TeamMember | null>(null)

  const submitting = nav.state === 'submitting'

  // Surface action results as toasts and close dialogs on success.
  const lastResult = React.useRef<ActionResult | null>(null)
  React.useEffect(() => {
    if (!result || result === lastResult.current) return
    lastResult.current = result
    toast({ title: result.message, variant: result.ok ? 'success' : 'error' })
    if (result.ok) {
      setInviteOpen(false)
      setEditing(null)
      setRemoving(null)
    }
  }, [result, toast])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configure"
        title="Team & Roles"
        description="Invite teammates and control access by role. Analysts are read-only; only owners can manage billing and grant the Owner role."
        actions={
          !error && (
            <Button leftIcon={<Icons.Plus className="size-4" />} onClick={() => setInviteOpen(true)}>
              Invite user
            </Button>
          )
        }
      />

      {error ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-neutral-600">
            <Icons.AlertCircle className="size-5 text-neutral-500" />
            {error}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableEmpty colSpan={4}>No teammates yet. Invite your first user.</TableEmpty>
              ) : (
                members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={`${m.firstName} ${m.lastName}`} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-neutral-900">
                            {m.firstName} {m.lastName}
                          </p>
                          <p className="truncate text-xs text-neutral-500">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[m.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      {m.isActive ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
                          <Icons.CheckCircle className="size-4 text-neutral-500" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm text-neutral-400">
                          <Icons.XCircle className="size-4" /> Inactive
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                          aria-label={`Manage ${m.firstName}`}
                        >
                          <Icons.MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(m)}>Change role</DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              submit(
                                { intent: 'toggle-active', userId: m.id, isActive: m.isActive ? 'false' : 'true' },
                                { method: 'post' },
                              )
                            }
                          >
                            {m.isActive ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRemoving(m)}>Remove</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Role reference */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-3 py-5 sm:grid-cols-2">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="flex items-start gap-3">
              <Badge variant="subtle" className="mt-0.5 shrink-0">
                {ROLE_LABELS[r]}
              </Badge>
              <p className="text-sm text-neutral-600">{ROLE_BLURB[r]}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Invite modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a teammate">
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="invite" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="First name">
              <Input name="firstName" required autoComplete="off" />
            </FormField>
            <FormField label="Last name">
              <Input name="lastName" required autoComplete="off" />
            </FormField>
          </div>
          <FormField label="Email">
            <Input type="email" name="email" required autoComplete="off" />
          </FormField>
          <FormField label="Temporary password" hint="At least 8 characters. The user can change it later.">
            <Input type="text" name="password" minLength={8} required autoComplete="off" />
          </FormField>
          <FormField label="Role">
            <Select name="role" defaultValue="MARKETER">
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={submitting}>
              Send invite
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Change-role modal */}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Change role — ${editing.firstName}` : ''}>
        {editing && (
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="update-role" />
            <input type="hidden" name="userId" value={editing.id} />
            <FormField label="Role">
              <Select name="role" defaultValue={editing.role}>
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Save
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      {/* Remove confirm modal */}
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove teammate?"
        footer={
          removing ? (
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Form method="post">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="userId" value={removing.id} />
                <Button type="submit" variant="destructive" isLoading={submitting}>
                  Remove
                </Button>
              </Form>
            </>
          ) : null
        }
      >
        {removing && (
          <p className="text-sm text-neutral-600">
            {removing.firstName} {removing.lastName} ({removing.email}) will lose access immediately. This
            can’t be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
