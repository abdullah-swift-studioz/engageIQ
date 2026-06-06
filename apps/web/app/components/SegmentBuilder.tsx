import { useState } from 'react'
import type { SegmentGroup, SegmentCondition, ConditionOperator } from '@engageiq/shared'

// ─── Field metadata for UI rendering ────────────────────────────────────────

const FIELD_OPTIONS: { value: string; label: string; type: string }[] = [
  { value: 'total_spent',            label: 'Total Spent (PKR)',     type: 'number' },
  { value: 'total_orders',           label: 'Total Orders',          type: 'number' },
  { value: 'average_order_value',    label: 'Avg Order Value',       type: 'number' },
  { value: 'rfm_segment',            label: 'RFM Segment',           type: 'enum' },
  { value: 'recency_score',          label: 'Recency Score',         type: 'number' },
  { value: 'frequency_score',        label: 'Frequency Score',       type: 'number' },
  { value: 'monetary_score',         label: 'Monetary Score',        type: 'number' },
  { value: 'churn_risk_score',       label: 'Churn Risk Score',      type: 'number' },
  { value: 'churn_risk_label',       label: 'Churn Risk Label',      type: 'enum' },
  { value: 'ltv_predicted_90d',      label: 'Predicted LTV 90d',     type: 'number' },
  { value: 'city',                   label: 'City',                  type: 'string' },
  { value: 'country',                label: 'Country',               type: 'string' },
  { value: 'accepts_marketing_email',label: 'Email Subscribed',      type: 'boolean' },
  { value: 'accepts_marketing_sms',  label: 'SMS Subscribed',        type: 'boolean' },
  { value: 'accepts_marketing_whatsapp', label: 'WhatsApp Subscribed', type: 'boolean' },
  { value: 'cod_acceptance_rate',    label: 'COD Acceptance Rate',   type: 'number' },
  { value: 'cod_fake_order_score',   label: 'Fake Order Score',      type: 'number' },
  { value: 'last_order_date',        label: 'Last Order Date',       type: 'date' },
  { value: 'last_seen_at',           label: 'Last Seen',             type: 'date' },
  { value: 'tags',                   label: 'Tags',                  type: 'array' },
]

const OPERATORS_BY_TYPE: Record<string, { value: ConditionOperator; label: string }[]> = {
  number: [
    { value: 'eq', label: '=' }, { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' }, { value: 'gte', label: '>=' },
    { value: 'lt', label: '<' }, { value: 'lte', label: '<=' },
    { value: 'between', label: 'between' },
  ],
  string: [
    { value: 'eq', label: 'equals' }, { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' }, { value: 'not_contains', label: 'not contains' },
    { value: 'in', label: 'in list' }, { value: 'not_in', label: 'not in list' },
  ],
  enum: [
    { value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' },
    { value: 'in', label: 'in' }, { value: 'not_in', label: 'not in' },
  ],
  boolean: [
    { value: 'is_true', label: 'is true' }, { value: 'is_false', label: 'is false' },
  ],
  date: [
    { value: 'before', label: 'before' }, { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
    { value: 'within_last_days', label: 'within last N days' },
    { value: 'more_than_days_ago', label: 'more than N days ago' },
    { value: 'is_set', label: 'is set' }, { value: 'is_not_set', label: 'is not set' },
  ],
  array: [
    { value: 'includes_any', label: 'includes any of' },
    { value: 'includes_all', label: 'includes all of' },
    { value: 'includes_none', label: 'includes none of' },
  ],
}

const ENUM_VALUES: Record<string, string[]> = {
  rfm_segment: ['Champions', 'LoyalCustomers', 'PotentialLoyalists', 'NewCustomers', 'Promising', 'NeedAttention', 'AboutToSleep', 'AtRisk', 'CantLoseThem', 'Hibernating', 'Lost'],
  churn_risk_label: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
}

// ─── Value input component ────────────────────────────────────────────────────

function ValueInput({
  field,
  fieldType,
  operator,
  value,
  onChange,
}: {
  field: string
  fieldType: string
  operator: ConditionOperator
  value: unknown
  onChange: (v: unknown) => void
}) {
  const noValue: ConditionOperator[] = ['is_true', 'is_false', 'is_set', 'is_not_set']
  if (noValue.includes(operator)) return null

  if (operator === 'between') {
    const arr = Array.isArray(value) ? value : ['', '']
    return (
      <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
        <input type={fieldType === 'date' ? 'date' : 'number'} value={String(arr[0] ?? '')} style={{ width: '100px', padding: '4px' }}
          onChange={(e) => onChange([e.target.value, arr[1]])} />
        <span>and</span>
        <input type={fieldType === 'date' ? 'date' : 'number'} value={String(arr[1] ?? '')} style={{ width: '100px', padding: '4px' }}
          onChange={(e) => onChange([arr[0], e.target.value])} />
      </span>
    )
  }

  if (operator === 'within_last_days' || operator === 'more_than_days_ago') {
    return (
      <input type="number" min="1" value={typeof value === 'number' ? value : ''} style={{ width: '80px', padding: '4px' }}
        onChange={(e) => onChange(parseInt(e.target.value, 10))} />
    )
  }

  if (operator === 'in' || operator === 'not_in' || operator === 'includes_any' || operator === 'includes_all' || operator === 'includes_none') {
    if (fieldType === 'enum' && ENUM_VALUES[field]) {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <select multiple value={selected} size={4} style={{ width: '160px', padding: '4px' }}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}>
          {ENUM_VALUES[field]!.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )
    }
    const str = Array.isArray(value) ? (value as string[]).join(', ') : ''
    return (
      <input type="text" placeholder="comma-separated values" value={str} style={{ width: '200px', padding: '4px' }}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
    )
  }

  if (fieldType === 'enum' && ENUM_VALUES[field]) {
    return (
      <select value={typeof value === 'string' ? value : ''} style={{ padding: '4px' }}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">Select...</option>
        {ENUM_VALUES[field]!.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    )
  }

  if (fieldType === 'date') {
    return (
      <input type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} style={{ padding: '4px' }}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')} />
    )
  }

  return (
    <input
      type={fieldType === 'number' ? 'number' : 'text'}
      value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
      style={{ width: '160px', padding: '4px' }}
      onChange={(e) => onChange(fieldType === 'number' ? parseFloat(e.target.value) : e.target.value)}
    />
  )
}

// ─── Condition row ────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition
  onChange: (c: SegmentCondition) => void
  onRemove: () => void
}) {
  const fieldMeta = FIELD_OPTIONS.find((f) => f.value === condition.field)
  const fieldType = fieldMeta?.type ?? 'string'
  const operators = OPERATORS_BY_TYPE[fieldType] ?? []

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
      <select value={condition.field} style={{ padding: '4px' }}
        onChange={(e) => {
          const newField = e.target.value
          const newType = FIELD_OPTIONS.find((f) => f.value === newField)?.type ?? 'string'
          const firstOp = (OPERATORS_BY_TYPE[newType]?.[0]?.value ?? 'eq') as ConditionOperator
          onChange({ field: newField, operator: firstOp, value: null })
        }}>
        {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      <select value={condition.operator} style={{ padding: '4px' }}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator, value: null })}>
        {operators.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>

      <ValueInput
        field={condition.field}
        fieldType={fieldType}
        operator={condition.operator}
        value={condition.value}
        onChange={(v) => onChange({ ...condition, value: v })}
      />

      <button onClick={onRemove} style={{ padding: '4px 8px', cursor: 'pointer', color: 'red' }}>×</button>
    </div>
  )
}

// ─── Group component ──────────────────────────────────────────────────────────

function GroupEditor({
  group,
  depth,
  onChange,
  onRemove,
}: {
  group: SegmentGroup
  depth: number
  onChange: (g: SegmentGroup) => void
  onRemove?: () => void
}) {
  function addCondition() {
    const first = FIELD_OPTIONS[0]!
    const firstOp = OPERATORS_BY_TYPE[first.type]?.[0]?.value as ConditionOperator
    onChange({
      ...group,
      rules: [...group.rules, { field: first.value, operator: firstOp, value: null }],
    })
  }

  function addSubGroup() {
    const first = FIELD_OPTIONS[0]!
    const firstOp = OPERATORS_BY_TYPE[first.type]?.[0]?.value as ConditionOperator
    const sub: SegmentGroup = {
      match: 'any',
      rules: [{ field: first.value, operator: firstOp, value: null }],
    }
    onChange({ ...group, rules: [...group.rules, sub] })
  }

  return (
    <div style={{
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '8px',
      background: depth === 1 ? '#fff' : '#f9fafb',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '0.875rem', color: '#374151' }}>Match</span>
        <select value={group.match} style={{ padding: '4px' }}
          onChange={(e) => onChange({ ...group, match: e.target.value as 'all' | 'any' })}>
          <option value="all">ALL conditions</option>
          <option value="any">ANY condition</option>
        </select>
        {onRemove && (
          <button onClick={onRemove} style={{ marginLeft: 'auto', padding: '4px 8px', cursor: 'pointer', color: 'red' }}>
            Remove group
          </button>
        )}
      </div>

      {group.rules.map((rule, idx) => {
        if ('field' in rule && !('rules' in rule)) {
          return (
            <ConditionRow
              key={idx}
              condition={rule as SegmentCondition}
              onChange={(c) => {
                const rules = [...group.rules]
                rules[idx] = c
                onChange({ ...group, rules })
              }}
              onRemove={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== idx) })}
            />
          )
        }
        return (
          <GroupEditor
            key={idx}
            group={rule as SegmentGroup}
            depth={depth + 1}
            onChange={(g) => {
              const rules = [...group.rules]
              rules[idx] = g
              onChange({ ...group, rules })
            }}
            onRemove={() => onChange({ ...group, rules: group.rules.filter((_, i) => i !== idx) })}
          />
        )
      })}

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button onClick={addCondition} style={{ padding: '4px 12px', cursor: 'pointer' }}>
          + Add condition
        </button>
        {depth === 1 && (
          <button onClick={addSubGroup} style={{ padding: '4px 12px', cursor: 'pointer' }}>
            + Add group
          </button>
        )}
      </div>
    </div>
  )
}

// ─── SegmentBuilder (exported) ────────────────────────────────────────────────

interface SegmentBuilderProps {
  initialName?: string
  initialDescription?: string
  initialConditions?: SegmentGroup
  onSave: (name: string, description: string, conditions: SegmentGroup) => Promise<void>
}

export function SegmentBuilder({
  initialName = '',
  initialDescription = '',
  initialConditions,
  onSave,
}: SegmentBuilderProps) {
  const defaultGroup: SegmentGroup = {
    match: 'all',
    rules: [{ field: 'total_orders', operator: 'gt', value: 0 }],
  }

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [group, setGroup] = useState<SegmentGroup>(initialConditions ?? defaultGroup)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setSaveError('Segment name is required'); return }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(name.trim(), description.trim(), group)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e) }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Segment name *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '400px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
          placeholder="e.g. High-Value Lahore Customers"
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ width: '400px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
          placeholder="Optional description"
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Conditions
        </label>
        <GroupEditor group={group} depth={1} onChange={setGroup} />
      </div>

      {saveError && (
        <div style={{ color: 'red', marginBottom: '1rem' }}>{saveError}</div>
      )}

      <button
        type="submit"
        disabled={saving}
        style={{
          background: '#2563eb',
          color: '#fff',
          padding: '0.625rem 1.5rem',
          border: 'none',
          borderRadius: '4px',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving...' : 'Save Segment'}
      </button>
    </form>
  )
}
