import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import type { AgencyContext } from '@engageiq/shared'
import { apiFetch, actingMerchantCookie } from '~/lib/acting-merchant.server'

/**
 * Resource route backing the app-shell Agency switcher.
 *   GET  /api/agency  → the current agency context (accessible clients + active)
 *   POST /api/agency  → switch active client (validated by the API), set cookie, reload
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const res = await apiFetch(request, '/api/v1/agency/context')
    if (!res.ok) return json<{ context: AgencyContext | null }>({ context: null })
    const body = (await res.json()) as { data: AgencyContext }
    return json<{ context: AgencyContext | null }>({ context: body.data })
  } catch {
    return json<{ context: AgencyContext | null }>({ context: null })
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const merchantId = String(form.get('merchantId') ?? '')
  const redirectTo = String(form.get('redirectTo') ?? '/')

  // Switching back to the agency's own account clears the cookie.
  if (!merchantId || merchantId === '__home__') {
    return redirect(redirectTo, {
      headers: { 'Set-Cookie': await actingMerchantCookie.serialize('') },
    })
  }

  // Validate access before persisting the selection.
  const res = await apiFetch(request, '/api/v1/agency/switch', {
    method: 'POST',
    body: JSON.stringify({ merchantId }),
  })
  if (!res.ok) {
    return json({ error: 'You do not have access to that account' }, { status: res.status })
  }
  return redirect(redirectTo, {
    headers: { 'Set-Cookie': await actingMerchantCookie.serialize(merchantId) },
  })
}
