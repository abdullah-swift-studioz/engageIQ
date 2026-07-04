// apps/web/app/lib/email-api.server.ts
//
// Server-side helper for the email lane's Remix loaders/actions. The dashboard talks to
// the API over HTTP using the server-held DEV_TOKEN (the UI has no login page in dev);
// the browser never sees the token, so all API calls proxy through Remix.

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001'
const TOKEN = process.env['DEV_TOKEN'] ?? ''

export interface ApiResult<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (res.status === 204) return { ok: true, status: 204 }
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } }
    if (!res.ok) {
      return { ok: false, status: res.status, error: body.error?.message ?? `Request failed (${res.status})` }
    }
    return { ok: true, status: res.status, data: body.data }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// List endpoints return { data, meta } — this variant surfaces meta.
export async function apiFetchList<T>(
  path: string,
): Promise<{ ok: boolean; data: T[]; total: number; error?: string }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const body = (await res.json().catch(() => ({}))) as {
      data?: T[]
      meta?: { total?: number }
      error?: { message?: string }
    }
    if (!res.ok) return { ok: false, data: [], total: 0, error: body.error?.message ?? 'Failed to load' }
    return { ok: true, data: body.data ?? [], total: body.meta?.total ?? (body.data?.length ?? 0) }
  } catch (err) {
    return { ok: false, data: [], total: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}
