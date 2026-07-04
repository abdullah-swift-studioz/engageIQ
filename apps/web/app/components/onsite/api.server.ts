/**
 * Server-only helpers for the On-Site routes' loaders/actions. The Remix app has
 * no login page — it authenticates to the API with a DEV_TOKEN minted by
 * scripts/start-local.sh (same pattern as the campaigns lane).
 */
import type {
  OnSiteElementConfig,
  OnSiteDisplayRules,
  OnSiteElementTypeName,
  OnSiteElementStatusName,
  OnSiteVariant,
} from '@engageiq/shared'

export interface ElementListItem {
  id: string
  name: string
  type: OnSiteElementTypeName
  status: OnSiteElementStatusName
  segmentId: string | null
  priority: number | null
  displayRules: OnSiteDisplayRules
  createdAt: string
  updatedAt: string
}

export interface AbTestView {
  id: string
  name: string
  status: string
  winnerMetric: string
  winnerVariantId: string | null
  variants: OnSiteVariant[]
  startedAt: string | null
}

export interface ElementDetail {
  id: string
  name: string
  type: OnSiteElementTypeName
  status: OnSiteElementStatusName
  segmentId: string | null
  priority: number | null
  config: OnSiteElementConfig
  displayRules: OnSiteDisplayRules
  segment: { id: string; name: string } | null
  abTest: AbTestView | null
  createdAt: string
  updatedAt: string
}

export interface ElementStats {
  impressions: number
  conversions: number
  conversionRate: number
  variants: { variantId: string; impressions: number; conversions: number; conversionRate: number }[]
  available: boolean
}

export interface SegmentOption {
  id: string
  name: string
}

function apiBase(): string {
  return process.env['API_URL'] ?? 'http://localhost:3001'
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env['DEV_TOKEN'] ?? ''}`,
  }
}

/** GET a JSON envelope; returns `data` or null on any failure. */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: T }
    return body.data ?? null
  } catch {
    return null
  }
}

export interface SendResult {
  ok: boolean
  status: number
  error: string | null
  data: unknown
}

/** POST/PUT/DELETE with the standard envelope; surfaces the API error message. */
export async function apiSend(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<SendResult> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return { ok: true, status: 204, error: null, data: null }
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: unknown; error?: { message?: string } }
      | null
    if (!res.ok) {
      return { ok: false, status: res.status, error: json?.error?.message ?? 'Request failed', data: null }
    }
    return { ok: true, status: res.status, error: null, data: json?.data ?? null }
  } catch {
    return { ok: false, status: 0, error: 'Network error', data: null }
  }
}

export async function listSegmentOptions(): Promise<SegmentOption[]> {
  const data = await apiGet<SegmentOption[]>('/api/v1/segments?page=1&pageSize=100')
  return (data ?? []).map((s) => ({ id: s.id, name: s.name }))
}

export interface ElementBody {
  name: string
  type: OnSiteElementTypeName
  status: OnSiteElementStatusName
  segmentId: string | null
  priority: number | null
  config: OnSiteElementConfig
  displayRules: OnSiteDisplayRules
}

/** Assemble the nested create/update body from the flat ElementForm field names. */
export function parseElementForm(fd: FormData): ElementBody {
  const str = (k: string): string | undefined => {
    const v = fd.get(k)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
  }
  const num = (k: string): number | undefined => {
    const v = str(k)
    return v !== undefined ? Number(v) : undefined
  }

  const trigger = (str('trigger') ?? 'timed') as OnSiteDisplayRules['trigger']
  const displayRules: OnSiteDisplayRules = { trigger }
  if (trigger === 'timed') displayRules.timedDelaySeconds = num('timedDelaySeconds') ?? 5
  if (trigger === 'cart_value') displayRules.cartValueThreshold = num('cartValueThreshold') ?? 0
  const pagePattern = str('pagePattern')
  if (pagePattern) displayRules.pagePattern = pagePattern
  const frequency = str('frequency')
  if (frequency) displayRules.frequency = frequency as OnSiteDisplayRules['frequency']

  const config: OnSiteElementConfig = {
    dismissible: fd.get('cfg_dismissible') != null,
    captureEmail: fd.get('cfg_captureEmail') != null,
  }
  const headline = str('cfg_headline')
  if (headline) config.headline = headline
  const bodyText = str('cfg_body')
  if (bodyText) config.body = bodyText
  const ctaText = str('cfg_ctaText')
  if (ctaText) config.ctaText = ctaText
  const ctaUrl = str('cfg_ctaUrl')
  if (ctaUrl) config.ctaUrl = ctaUrl
  const incentiveCode = str('cfg_incentiveCode')
  if (incentiveCode) config.incentiveCode = incentiveCode
  const imageUrl = str('cfg_imageUrl')
  if (imageUrl) config.imageUrl = imageUrl
  const position = str('cfg_position')
  if (position) config.position = position as OnSiteElementConfig['position']
  const embedSelector = str('cfg_embedSelector')
  if (embedSelector) config.embedSelector = embedSelector

  return {
    name: str('name') ?? '',
    type: (str('type') ?? 'POPUP') as OnSiteElementTypeName,
    status: (str('status') ?? 'DRAFT') as OnSiteElementStatusName,
    segmentId: str('segmentId') ?? null,
    priority: num('priority') ?? null,
    config,
    displayRules,
  }
}
