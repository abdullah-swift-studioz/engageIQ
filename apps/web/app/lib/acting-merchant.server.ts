import { createCookie } from '@remix-run/node'

/**
 * Agency account-switching on the web side (guide §9.4).
 *
 * The selected client merchant is stored in a cookie. Every API call made by a
 * loader/action goes through `apiFetch`, which forwards it as the
 * `x-acting-merchant-id` header — the API's global preHandler then re-scopes the
 * request to that client (after verifying the agency user may access it).
 *
 * NOTE for other lanes: to make a page honour the active client, its loaders
 * should call `apiFetch(request, ...)` instead of a bare `fetch` with the raw
 * token. This file is the single seam for that.
 */

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001'
const DEV_TOKEN = process.env['DEV_TOKEN'] ?? ''

export const ACTING_MERCHANT_COOKIE = 'eiq_acting_merchant'

export const actingMerchantCookie = createCookie(ACTING_MERCHANT_COOKIE, {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 30,
})

export async function getActingMerchantId(request: Request): Promise<string | null> {
  const value = await actingMerchantCookie.parse(request.headers.get('Cookie'))
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Fetch the API with the dashboard token + the active client header (if any). */
export async function apiFetch(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const acting = await getActingMerchantId(request)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${DEV_TOKEN}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (acting) headers.set('x-acting-merchant-id', acting)
  return fetch(`${API_URL}${path}`, { ...init, headers })
}

export { API_URL, DEV_TOKEN }
