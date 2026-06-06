import type { Prisma } from '@engageiq/db'
import type { SegmentGroup, SegmentCondition, ConditionOperator } from '@engageiq/shared'
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
