import type { ConditionOperator } from '@engageiq/shared'

export interface FieldDef {
  column: string        // Prisma model field name (camelCase) — used by SQL compiler
  profileKey: string    // property name on EnrichedCustomerProfile — used by in-memory evaluator
  type: 'number' | 'string' | 'boolean' | 'date' | 'array' | 'enum'
  enumValues?: string[]
  operators: ConditionOperator[]
}

const NUMBER_OPS: ConditionOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']
const STRING_OPS: ConditionOperator[] = ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains']
const ENUM_OPS: ConditionOperator[] = ['eq', 'neq', 'in', 'not_in']
const BOOLEAN_OPS: ConditionOperator[] = ['is_true', 'is_false']
const DATE_OPS: ConditionOperator[] = [
  'before', 'after', 'between', 'within_last_days', 'more_than_days_ago', 'is_set', 'is_not_set',
]
const ARRAY_OPS: ConditionOperator[] = ['includes_any', 'includes_all', 'includes_none']

const RFM_SEGMENT_VALUES = [
  'Champions', 'LoyalCustomers', 'PotentialLoyalists', 'NewCustomers', 'Promising',
  'NeedAttention', 'AboutToSleep', 'AtRisk', 'CantLoseThem', 'Hibernating', 'Lost',
]

const CHURN_LABEL_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export const FIELD_REGISTRY: Record<string, FieldDef> = {
  total_spent:              { column: 'totalSpent',          profileKey: 'totalSpent',          type: 'number',  operators: NUMBER_OPS },
  total_orders:             { column: 'totalOrders',         profileKey: 'totalOrders',         type: 'number',  operators: NUMBER_OPS },
  average_order_value:      { column: 'avgOrderValue',       profileKey: 'avgOrderValue',       type: 'number',  operators: NUMBER_OPS },
  rfm_segment:              { column: 'rfmSegment',          profileKey: 'rfmSegment',          type: 'enum',    enumValues: RFM_SEGMENT_VALUES, operators: ENUM_OPS },
  recency_score:            { column: 'rfmRecencyScore',     profileKey: 'rfmRecencyScore',     type: 'number',  operators: NUMBER_OPS },
  frequency_score:          { column: 'rfmFrequencyScore',   profileKey: 'rfmFrequencyScore',   type: 'number',  operators: NUMBER_OPS },
  monetary_score:           { column: 'rfmMonetaryScore',    profileKey: 'rfmMonetaryScore',    type: 'number',  operators: NUMBER_OPS },
  churn_risk_score:         { column: 'churnScore',          profileKey: 'churnScore',          type: 'number',  operators: NUMBER_OPS },
  churn_risk_label:         { column: 'churnRiskLabel',      profileKey: 'churnRiskLabel',      type: 'enum',    enumValues: CHURN_LABEL_VALUES, operators: ENUM_OPS },
  ltv_predicted_90d:        { column: 'ltv90d',              profileKey: 'ltv90d',              type: 'number',  operators: NUMBER_OPS },
  city:                     { column: 'city',                profileKey: 'city',                type: 'string',  operators: STRING_OPS },
  country:                  { column: 'country',             profileKey: 'country',             type: 'string',  operators: STRING_OPS },
  accepts_marketing_email:  { column: 'isSubscribedEmail',   profileKey: 'isSubscribedEmail',   type: 'boolean', operators: BOOLEAN_OPS },
  accepts_marketing_sms:    { column: 'isSubscribedSms',     profileKey: 'isSubscribedSms',     type: 'boolean', operators: BOOLEAN_OPS },
  accepts_marketing_whatsapp: { column: 'isSubscribedWhatsapp', profileKey: 'isSubscribedWhatsapp', type: 'boolean', operators: BOOLEAN_OPS },
  cod_acceptance_rate:      { column: 'codAcceptanceRate',   profileKey: 'codAcceptanceRate',   type: 'number',  operators: NUMBER_OPS },
  cod_fake_order_score:     { column: 'fakeOrderScore',      profileKey: 'fakeOrderScore',      type: 'number',  operators: NUMBER_OPS },
  last_order_date:          { column: 'lastOrderAt',         profileKey: 'lastOrderAt',         type: 'date',    operators: DATE_OPS },
  last_seen_at:             { column: 'lastSeenAt',          profileKey: 'lastSeenAt',          type: 'date',    operators: DATE_OPS },
  tags:                     { column: 'tags',                profileKey: 'tags',                type: 'array',   operators: ARRAY_OPS },
}

// Value shape rules — co-located with registry for documentation and validation use.
export type ValueShape =
  | 'tuple2'          // [min, max] — for 'between'
  | 'positive_int'    // positive integer — for 'within_last_days', 'more_than_days_ago'
  | 'non_empty_array' // non-empty array — for 'in', 'not_in', 'includes_*'
  | 'none'            // no value — for 'is_true', 'is_false', 'is_set', 'is_not_set'
  | 'scalar'          // single value — all other operators

export const OPERATOR_VALUE_SHAPES: Record<ConditionOperator, ValueShape> = {
  between: 'tuple2',
  within_last_days: 'positive_int',
  more_than_days_ago: 'positive_int',
  in: 'non_empty_array',
  not_in: 'non_empty_array',
  includes_any: 'non_empty_array',
  includes_all: 'non_empty_array',
  includes_none: 'non_empty_array',
  is_true: 'none',
  is_false: 'none',
  is_set: 'none',
  is_not_set: 'none',
  eq: 'scalar',
  neq: 'scalar',
  gt: 'scalar',
  gte: 'scalar',
  lt: 'scalar',
  lte: 'scalar',
  contains: 'scalar',
  not_contains: 'scalar',
  before: 'scalar',
  after: 'scalar',
}
