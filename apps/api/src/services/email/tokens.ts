// apps/api/src/services/email/tokens.ts
//
// Personalization token substitution for the email builder (guide 7.3):
//   {{customer.first_name}}  {{order.total}}  {{product.title}}  {{merchant.name}}
// and any profile attribute. Tokens are `{{namespace.field}}` where field is snake_case
// (matched against the camelCase profile record), with an optional `|fallback`:
//   {{customer.first_name|there}}  →  "there" when first_name resolves empty.
//
// Substituted values are HTML-escaped by the caller when injected into HTML context;
// this module only resolves the raw string.

import type { EmailRenderContext } from '@engageiq/shared'

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g

// snake_case token field → camelCase record key (first_name → firstName).
function toCamel(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Prisma Decimal / Date / other objects expose toString().
  if (typeof (value as { toString?: unknown }).toString === 'function') return String(value)
  return ''
}

// Resolve one `namespace.field` against the render context. Namespaces map to the
// loose record bags on the context; unknown namespaces/fields resolve to ''.
function resolve(ctx: EmailRenderContext, namespace: string, field: string): string {
  const key = toCamel(field)
  let bag: Record<string, unknown> | undefined
  switch (namespace) {
    case 'customer':
      bag = ctx.customer
      break
    case 'order':
      bag = ctx.order
      break
    case 'merchant':
      bag = ctx.merchant
      break
    default:
      bag = undefined
  }
  if (!bag) return ''
  // Try the camelCase key first, then the literal snake_case as a fallback.
  const raw = bag[key] !== undefined ? bag[key] : bag[field]
  return stringify(raw).trim()
}

/**
 * Replace every {{namespace.field|fallback}} token in `input` with its resolved value.
 * Empty resolutions use the fallback when present, otherwise the empty string.
 */
export function substituteTokens(input: string, ctx: EmailRenderContext): string {
  return input.replace(TOKEN_RE, (_match, namespace: string, field: string, fallback?: string) => {
    const value = resolve(ctx, namespace, field)
    if (value !== '') return value
    return fallback !== undefined ? fallback : ''
  })
}

// Distinct token strings referenced in a body — used by the spam-score/preview tooling
// to warn about tokens that will resolve empty for a sample recipient.
export function extractTokens(input: string): Array<{ namespace: string; field: string }> {
  const found = new Map<string, { namespace: string; field: string }>()
  for (const m of input.matchAll(TOKEN_RE)) {
    const namespace = m[1]
    const field = m[2]
    if (namespace && field) found.set(`${namespace}.${field}`, { namespace, field })
  }
  return [...found.values()]
}
