// apps/api/src/lib/channels/template-variables.ts
//
// Substitution rule for WhatsApp template variables (spec §3.3). variableMap is an
// ordered array, one entry per {{n}}, each optionally carrying a `default`. For each
// entry we resolve `field` from the customer profile; if the resolved value is empty
// we fall back to `default`. If there is NO default and the field resolves empty, the
// send is a non-retryable local failure — Meta rejects the whole message when any
// variable is empty, so failing locally with a clear reason beats an opaque rejection.

export interface VariableMapEntry {
  index: number
  field: string
  default?: string
}

// Fields a template variable may reference on the customer profile. Kept explicit so
// a template can never read an arbitrary/sensitive column. Values are stringified.
const FIELD_ACCESSORS: Record<string, (c: Record<string, unknown>) => unknown> = {
  firstName: (c) => c.firstName,
  lastName: (c) => c.lastName,
  email: (c) => c.email,
  phone: (c) => c.phone,
  city: (c) => c.city,
  province: (c) => c.province,
  country: (c) => c.country,
  totalOrders: (c) => c.totalOrders,
  totalSpent: (c) => c.totalSpent,
  avgOrderValue: (c) => c.avgOrderValue,
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Prisma Decimal and other objects expose toString()
  if (typeof (value as { toString?: unknown }).toString === 'function') {
    return String(value)
  }
  return ''
}

function resolveField(customer: Record<string, unknown>, field: string): string {
  const accessor = FIELD_ACCESSORS[field]
  // Unknown fields resolve empty (treated like a missing value → default or FAILED).
  if (!accessor) return ''
  return stringifyValue(accessor(customer)).trim()
}

export type SubstitutionResult =
  | { ok: true; variables: string[] }
  | { ok: false; missingIndex: number }

// Returns the ordered variable strings for the Meta template body, or a failure
// pointing at the {{n}} that resolved empty with no default.
export function substituteVariables(
  variableMap: VariableMapEntry[],
  customer: Record<string, unknown>,
): SubstitutionResult {
  // Sort by index so the produced array matches {{1}}, {{2}}, … order regardless
  // of how the entries were stored.
  const ordered = [...variableMap].sort((a, b) => a.index - b.index)
  const variables: string[] = []

  for (const entry of ordered) {
    const resolved = resolveField(customer, entry.field)
    if (resolved !== '') {
      variables.push(resolved)
      continue
    }
    if (entry.default !== undefined && entry.default !== '') {
      variables.push(entry.default)
      continue
    }
    return { ok: false, missingIndex: entry.index }
  }

  return { ok: true, variables }
}
