import type { Prisma } from '@engageiq/db'
import type { SegmentGroup, SegmentCondition, ConditionOperator, EnrichedCustomerProfile } from '@engageiq/shared'
import { FIELD_REGISTRY } from '../lib/segments/field-registry.js'

// ─── Type guards ──────────────────────────────────────────────────────────────

function isCondition(rule: SegmentGroup | SegmentCondition): rule is SegmentCondition {
  return 'field' in rule && !('rules' in rule)
}

// ─── SQL compiler (batch path) ────────────────────────────────────────────────

function conditionToWhere(condition: SegmentCondition): Prisma.CustomerWhereInput {
  const def = FIELD_REGISTRY[condition.field]!
  const col = def.column
  const val = condition.value
  const now = Date.now()

  switch (condition.operator as ConditionOperator) {
    case 'eq':
      return { [col]: val } as Prisma.CustomerWhereInput
    case 'neq':
      return { [col]: { not: val } } as Prisma.CustomerWhereInput
    case 'gt':
      return { [col]: { gt: val } } as Prisma.CustomerWhereInput
    case 'gte':
      return { [col]: { gte: val } } as Prisma.CustomerWhereInput
    case 'lt':
      return { [col]: { lt: val } } as Prisma.CustomerWhereInput
    case 'lte':
      return { [col]: { lte: val } } as Prisma.CustomerWhereInput
    case 'between': {
      const [min, max] = val as [unknown, unknown]
      return { [col]: { gte: min, lte: max } } as Prisma.CustomerWhereInput
    }
    case 'in':
      return { [col]: { in: val as unknown[] } } as Prisma.CustomerWhereInput
    case 'not_in':
      return { [col]: { notIn: val as unknown[] } } as Prisma.CustomerWhereInput
    case 'contains':
      return { [col]: { contains: val as string, mode: 'insensitive' } } as Prisma.CustomerWhereInput
    case 'not_contains':
      return { [col]: { not: { contains: val as string, mode: 'insensitive' } } } as Prisma.CustomerWhereInput
    case 'is_true':
      return { [col]: true } as Prisma.CustomerWhereInput
    case 'is_false':
      return { [col]: false } as Prisma.CustomerWhereInput
    case 'before':
      return { [col]: { lt: new Date(val as string) } } as Prisma.CustomerWhereInput
    case 'after':
      return { [col]: { gt: new Date(val as string) } } as Prisma.CustomerWhereInput
    case 'within_last_days':
      return { [col]: { gte: new Date(now - (val as number) * 86_400_000) } } as Prisma.CustomerWhereInput
    case 'more_than_days_ago':
      return { [col]: { lt: new Date(now - (val as number) * 86_400_000) } } as Prisma.CustomerWhereInput
    case 'is_set':
      return { [col]: { not: null } } as Prisma.CustomerWhereInput
    case 'is_not_set':
      return { [col]: null } as Prisma.CustomerWhereInput
    case 'includes_any':
      return { [col]: { hasSome: val as string[] } } as Prisma.CustomerWhereInput
    case 'includes_all':
      return { [col]: { hasEvery: val as string[] } } as Prisma.CustomerWhereInput
    case 'includes_none':
      return { NOT: { [col]: { hasSome: val as string[] } } } as Prisma.CustomerWhereInput
  }
}

function compileGroup(group: SegmentGroup): Prisma.CustomerWhereInput {
  const clauses = group.rules.map((rule) =>
    isCondition(rule) ? conditionToWhere(rule) : compileGroup(rule),
  )
  return group.match === 'all' ? { AND: clauses } : { OR: clauses }
}

export function compileToPrismaWhere(
  group: SegmentGroup,
  merchantId: string,
): Prisma.CustomerWhereInput {
  return {
    AND: [
      { merchantId },
      { mergedIntoId: null },
      compileGroup(group),
    ],
  }
}

// ─── In-memory evaluator ──────────────────────────────────────────────────────

function coerceToNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val)
  if (typeof val === 'object' && 'toNumber' in (val as object)) {
    return (val as { toNumber(): number }).toNumber()
  }
  return null
}

function coerceToDate(val: unknown): Date | null {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val
  if (typeof val === 'string') return new Date(val)
  return null
}

function evaluateCondition(
  condition: SegmentCondition,
  profile: EnrichedCustomerProfile,
): boolean {
  const def = FIELD_REGISTRY[condition.field]!
  const raw = (profile as Record<string, unknown>)[def.profileKey]
  const val = condition.value
  const now = Date.now()

  switch (condition.operator as ConditionOperator) {
    case 'eq': {
      if (def.type === 'number') {
        const n = coerceToNumber(raw)
        const v = coerceToNumber(val)
        return n !== null && v !== null && n === v
      }
      return raw === val
    }
    case 'neq': {
      if (def.type === 'number') {
        const n = coerceToNumber(raw)
        const v = coerceToNumber(val)
        return n === null || v === null || n !== v
      }
      return raw !== val
    }
    case 'gt': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n > v
    }
    case 'gte': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n >= v
    }
    case 'lt': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n < v
    }
    case 'lte': {
      const n = coerceToNumber(raw)
      const v = coerceToNumber(val)
      return n !== null && v !== null && n <= v
    }
    case 'between': {
      const [min, max] = val as [unknown, unknown]
      if (def.type === 'date') {
        const d = coerceToDate(raw)
        const dMin = coerceToDate(min)
        const dMax = coerceToDate(max)
        return d !== null && dMin !== null && dMax !== null && d >= dMin && d <= dMax
      }
      const n = coerceToNumber(raw)
      const mn = coerceToNumber(min)
      const mx = coerceToNumber(max)
      return n !== null && mn !== null && mx !== null && n >= mn && n <= mx
    }
    case 'in':
      return Array.isArray(val) && val.includes(raw)
    case 'not_in':
      return Array.isArray(val) && !(val as unknown[]).includes(raw)
    case 'contains':
      return typeof raw === 'string' && raw.toLowerCase().includes((val as string).toLowerCase())
    case 'not_contains':
      return typeof raw === 'string' && !raw.toLowerCase().includes((val as string).toLowerCase())
    case 'is_true':
      return raw === true
    case 'is_false':
      return raw === false
    case 'before': {
      const d = coerceToDate(raw)
      const v = coerceToDate(val)
      return d !== null && v !== null && d < v
    }
    case 'after': {
      const d = coerceToDate(raw)
      const v = coerceToDate(val)
      return d !== null && v !== null && d > v
    }
    case 'within_last_days': {
      const d = coerceToDate(raw)
      if (d === null) return false
      return d >= new Date(now - (val as number) * 86_400_000)
    }
    case 'more_than_days_ago': {
      const d = coerceToDate(raw)
      if (d === null) return false
      return d < new Date(now - (val as number) * 86_400_000)
    }
    case 'is_set':
      return raw !== null && raw !== undefined
    case 'is_not_set':
      return raw === null || raw === undefined
    case 'includes_any': {
      const arr = raw as unknown[]
      return Array.isArray(arr) && Array.isArray(val) && (val as unknown[]).some((v) => arr.includes(v))
    }
    case 'includes_all': {
      const arr = raw as unknown[]
      return Array.isArray(arr) && Array.isArray(val) && (val as unknown[]).every((v) => arr.includes(v))
    }
    case 'includes_none': {
      const arr = raw as unknown[]
      return Array.isArray(arr) && Array.isArray(val) && !(val as unknown[]).some((v) => arr.includes(v))
    }
  }
}

export function evaluateProfile(
  group: SegmentGroup,
  profile: EnrichedCustomerProfile,
): boolean {
  const results = group.rules.map((rule) =>
    isCondition(rule)
      ? evaluateCondition(rule, profile)
      : evaluateProfile(rule, profile),
  )
  return group.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}
