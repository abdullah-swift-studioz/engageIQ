import type { SegmentGroup, SegmentCondition, ConditionOperator } from '@engageiq/shared'
import { FIELD_REGISTRY, OPERATOR_VALUE_SHAPES } from './field-registry.js'

export type ValidationResult = { ok: true } | { ok: false; error: string }

function isCondition(rule: SegmentGroup | SegmentCondition): rule is SegmentCondition {
  return 'field' in rule && !('rules' in rule)
}

function validateValueShape(op: ConditionOperator, value: unknown): ValidationResult {
  const shape = OPERATOR_VALUE_SHAPES[op]
  switch (shape) {
    case 'none':
      return { ok: true }
    case 'tuple2':
      if (!Array.isArray(value) || value.length !== 2) {
        return { ok: false, error: `operator '${op}' requires a [min, max] tuple` }
      }
      return { ok: true }
    case 'positive_int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        return { ok: false, error: `operator '${op}' requires a positive integer` }
      }
      return { ok: true }
    case 'non_empty_array':
      if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, error: `operator '${op}' requires a non-empty array` }
      }
      return { ok: true }
    case 'scalar':
      if (value === undefined || value === null) {
        return { ok: false, error: `operator '${op}' requires a scalar value` }
      }
      return { ok: true }
  }
}

function validateCondition(condition: SegmentCondition): ValidationResult {
  const def = FIELD_REGISTRY[condition.field]
  if (!def) {
    return { ok: false, error: `Unknown field '${condition.field}'` }
  }
  if (!(def.operators as string[]).includes(condition.operator)) {
    return {
      ok: false,
      error: `Operator '${condition.operator}' is not valid for field '${condition.field}' (type: ${def.type})`,
    }
  }
  return validateValueShape(condition.operator, condition.value)
}

export function validateConditionTree(group: unknown, depth = 1): ValidationResult {
  if (
    typeof group !== 'object' ||
    group === null ||
    !('match' in group) ||
    !('rules' in group)
  ) {
    return { ok: false, error: 'Invalid group structure: must have match and rules' }
  }

  const g = group as SegmentGroup

  if (g.match !== 'all' && g.match !== 'any') {
    return { ok: false, error: `'match' must be 'all' or 'any', got '${String(g.match)}'` }
  }

  if (!Array.isArray(g.rules) || g.rules.length === 0) {
    return { ok: false, error: 'A group must have at least one rule' }
  }

  if (depth > 2) {
    return { ok: false, error: 'Condition tree exceeds maximum depth of 2' }
  }

  for (const rule of g.rules) {
    if (isCondition(rule)) {
      const result = validateCondition(rule)
      if (!result.ok) return result
    } else {
      if (depth >= 2) {
        return { ok: false, error: 'Condition tree exceeds maximum depth of 2' }
      }
      const result = validateConditionTree(rule, depth + 1)
      if (!result.ok) return result
    }
  }

  return { ok: true }
}
